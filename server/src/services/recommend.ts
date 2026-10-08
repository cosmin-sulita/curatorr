import {
  RESTRICTION_CERTS,
  certAllowed,
  eligibleMovies,
  qualityScore,
  rankMovies,
  rankSimilar,
  sagaState,
  wizardOptions,
  type Criteria,
  type LikeSeed,
  type MovieDTO,
  type ProfileContext,
  type RankedMovie,
  type RecommendationsResponse,
  type WizardOptionsResponse,
  type WizardStep,
} from '@curatorr/shared';
import { HttpError } from '../http.js';
import { plexLinks, PlexServerClient } from '../integrations/plex.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';

/** Id lookups happen while the picks load, so keep them short. */
const ID_LOOKUP_MS = 2_500;
/** "Something like…" lists this many recently watched movies, or search results. */
const LIKE_RECENT = 60;
const LIKE_SEARCH = 30;

function allowedCerts(row: ProfileRow): Set<string> | null {
  const restriction = row.restriction_profile as keyof typeof RESTRICTION_CERTS | null;
  return restriction && RESTRICTION_CERTS[restriction] ? new Set(RESTRICTION_CERTS[restriction]) : null;
}

export function profileContext(store: Store, row: ProfileRow): ProfileContext {
  const movies = store.movies();
  // Only insist on a Plex match when matching is actually working.
  const requirePlex = store.plexConfigured() && movies.some((m) => m.plexRatingKey);
  const watched = store.watchedIds(row.id);
  const feedback = store.feedback(row.id);
  // For sagas, "watched" also covers "Seen it", and only parts that can be played count.
  const seen = new Set([...watched, ...feedback.filter((e) => e.kind === 'seen').map((e) => e.movieId)]);
  const playable = requirePlex ? movies.filter((m) => m.plexRatingKey) : movies;
  const app = store.get('app');
  // Only requests still waiting to be watched get the boost and the label.
  const requested = app.boostRequests ? [...store.requestedIds(row.id)].filter((id) => !seen.has(id)) : [];
  return {
    watched,
    feedback,
    sagas: sagaState(playable, seen),
    allowedCerts: allowedCerts(row),
    requirePlex,
    includeWatched: app.includeWatched,
    watchlist: store.watchlistIds(row.id),
    requested: new Set(requested),
  };
}

export function toDTO(store: Store, m: StoredMovie): MovieDTO {
  const plex = store.get('plex');
  const links = m.plexRatingKey && plex.machineId ? plexLinks(plex.machineId, m.plexRatingKey, m.plexSlug) : null;
  return {
    id: m.id,
    title: m.title,
    year: m.year,
    overview: m.overview,
    runtime: m.runtime,
    certification: m.certification,
    genres: m.genres,
    ratings: m.ratings,
    posterUrl: m.posterUrl,
    fanartUrl: m.fanartUrl,
    trailerId: m.trailerId,
    plexUrl: links?.web ?? null,
    plexAppUrl: links?.app ?? null,
    saga: m.saga ? { title: m.saga.title, part: m.saga.part, parts: m.saga.parts } : null,
    imdbId: m.imdbId,
    tmdbId: m.tmdbId,
  };
}

/**
 * Fills in the watch.plex.tv slug and Plex guid id when the library listing didn't include
 * them, asking the Plex server for each item's full metadata. Results are stored ('' = Plex
 * has none, e.g. legacy agents), so each movie is looked up at most once; failures are
 * retried next time.
 */
export async function ensurePlexIds(store: Store, movies: StoredMovie[]) {
  if (!store.plexConfigured()) return;
  const missing = movies.filter((m) => m.plexRatingKey && (m.plexSlug == null || m.plexGuid == null));
  if (!missing.length) return;

  const plex = store.get('plex');
  const client = new PlexServerClient(plex.serverUrl!, plex.clientId, plex.adminToken!);
  await Promise.all(
    missing.map(async (m) => {
      try {
        const item = await client.item(m.plexRatingKey!, ID_LOOKUP_MS);
        store.setPlexIds(m.id, { slug: item?.slug ?? m.plexSlug ?? '', guid: item?.plexGuid ?? m.plexGuid ?? '' });
      } catch {
        // Server unreachable or item gone: keep it unknown and try again later.
      }
    }),
  );
}

export function optionsFor(store: Store, row: ProfileRow, step: WizardStep, criteria: Criteria): WizardOptionsResponse {
  const ctx = profileContext(store, row);
  const eligible = eligibleMovies(store.movies(), ctx);
  return wizardOptions(eligible, step, criteria, {
    image: (m, kind) => (kind === 'fanart' ? (m.fanartUrl ?? m.posterUrl) : (m.posterUrl ?? m.fanartUrl)),
    sagaStarters: ctx.sagas?.starters,
  });
}

async function toResponse(store: Store, ranked: RankedMovie[]): Promise<RecommendationsResponse> {
  await ensurePlexIds(store, ranked.map((r) => r.movie as StoredMovie));
  return {
    total: ranked.filter((r) => r.tier === 0).length,
    picks: ranked.map((r) => ({
      movie: toDTO(store, r.movie as StoredMovie),
      score: r.score,
      closeMatch: r.tier > 0,
      reasons: r.reasons,
    })),
  };
}

export async function recommendFor(store: Store, row: ProfileRow, criteria: Criteria): Promise<RecommendationsResponse> {
  const ctx = profileContext(store, row);
  const eligible = eligibleMovies(store.movies(), ctx);
  const ranked = rankMovies(eligible, criteria, ctx.feedback, {
    now: Date.now(),
    seed: String(row.id),
    watchlist: ctx.watchlist,
    requested: ctx.requested,
    sagas: ctx.sagas,
  });
  return toResponse(store, ranked);
}

/** "Something like…": the eligible movies that share the most with one the profile loved. */
export async function similarFor(store: Store, row: ProfileRow, likedId: number): Promise<RecommendationsResponse> {
  const ctx = profileContext(store, row);
  const liked = store.movie(likedId);
  if (!liked || !certAllowed(liked, ctx.allowedCerts)) throw new HttpError(404, 'Movie not found');
  const eligible = eligibleMovies(store.movies(), ctx);
  const ranked = rankSimilar(eligible, liked, store.movies(), ctx.feedback, {
    now: Date.now(),
    seed: String(row.id),
    watchlist: ctx.watchlist,
    requested: ctx.requested,
    sagas: ctx.sagas,
  });
  return { ...(await toResponse(store, ranked)), like: { id: liked.id, title: liked.title } };
}

/** Lowercase without accents, so "amelie" finds "Amélie". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Movies to start "Something like…" from: without a query, what the profile watched in Plex or
 * marked "Seen it", most recent first; with one, matching titles in the library, watched first.
 */
export function likeSeeds(store: Store, row: ProfileRow, q = ''): LikeSeed[] {
  const watchedAt = new Map<number, number>();
  for (const w of store.watchHistory(row.id)) watchedAt.set(w.movieId, w.viewedAt ?? 0);
  for (const e of store.feedback(row.id)) {
    if (e.kind === 'seen') watchedAt.set(e.movieId, Math.max(watchedAt.get(e.movieId) ?? 0, e.createdAt));
  }
  const certs = allowedCerts(row);
  const movies = store.movies().filter((m) => certAllowed(m, certs));
  const toSeed = (m: StoredMovie): LikeSeed => ({
    id: m.id,
    title: m.title,
    year: m.year,
    posterUrl: m.posterUrl,
    watched: watchedAt.has(m.id),
  });

  const query = fold(q.trim());
  if (!query) {
    return movies
      .filter((m) => watchedAt.has(m.id))
      .sort((a, b) => watchedAt.get(b.id)! - watchedAt.get(a.id)! || a.title.localeCompare(b.title))
      .slice(0, LIKE_RECENT)
      .map(toSeed);
  }
  return movies
    .flatMap((m) => {
      const title = fold(m.title);
      if (!title.includes(query)) return [];
      return [{ m, watched: watchedAt.has(m.id), prefix: title.startsWith(query), quality: qualityScore(m.ratings).value }];
    })
    .sort(
      (a, b) =>
        Number(b.watched) - Number(a.watched) || Number(b.prefix) - Number(a.prefix) || b.quality - a.quality,
    )
    .slice(0, LIKE_SEARCH)
    .map(({ m }) => toSeed(m));
}
