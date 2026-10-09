import {
  RESTRICTION_CERTS,
  certAllowed,
  eligibleMovies,
  qualityScore,
  rankMovies,
  rankSimilar,
  sagaState,
  tasteEvents,
  tasteProfile,
  wizardOptions,
  type Criteria,
  type FeedbackEvent,
  type LikeSeed,
  type Movie,
  type MovieDTO,
  type ProfileContext,
  type RankOptions,
  type RankedMovie,
  type RecommendationsResponse,
  type WizardOptionsResponse,
  type WizardStep,
} from '@curatorr/shared';
import { HttpError, UpstreamError } from '../http.js';
import { plexLinks, PlexServerClient } from '../integrations/plex.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';

/** Id lookups happen while the picks load, so keep them short. */
const ID_LOOKUP_MS = 2_500;
/** After the Plex server couldn't be reached, picks skip the lookups for this long. */
const LOOKUP_PAUSE_MS = 60_000;
const lookupsPausedUntil = new WeakMap<Store, number>();
/** "Something like…" lists this many recently watched movies, or search results. */
const LIKE_RECENT = 60;
const LIKE_SEARCH = 30;

function allowedCerts(restriction: string | null): Set<string> | null {
  const certs = restriction ? RESTRICTION_CERTS[restriction as keyof typeof RESTRICTION_CERTS] : undefined;
  return certs ? new Set(certs) : null;
}

/** Everything ranking needs to know about a profile. `npm run eval` builds it for earlier moments too. */
export interface ProfileData {
  profileId: number;
  restriction: string | null;
  movies: Movie[];
  /** What the profile watched in Plex, and when. */
  watched: { movieId: number; viewedAt: number | null }[];
  feedback: FeedbackEvent[];
  /** The profile's Plex Watchlist. */
  watchlist: Set<number>;
  /** Library movies this profile requested in Seerr. */
  requested: Set<number>;
  /** Library movies other profiles requested in Seerr. */
  requestedByOthers: Set<number>;
  plexConfigured: boolean;
  includeWatched: boolean;
  boostRequests: boolean;
}

export function profileData(store: Store, row: ProfileRow): ProfileData {
  const app = store.get('app');
  return {
    profileId: row.id,
    restriction: row.restriction_profile,
    movies: store.movies(),
    watched: store.watchHistory(row.id),
    feedback: store.feedback(row.id),
    watchlist: store.watchlistIds(row.id),
    requested: store.requestedIds(row.id),
    requestedByOthers: store.requestedByOthers(row.id),
    plexConfigured: store.plexConfigured(),
    includeWatched: app.includeWatched,
    boostRequests: app.boostRequests,
  };
}

/** A profile's context for ranking at `now`: what it may be offered, and the options to rank it with. */
export interface Picking {
  ctx: ProfileContext;
  eligible: Movie[];
  opts: RankOptions;
}

/** `taste` also works out the profile's taste, which only ranking the picks needs. */
export function picking(d: ProfileData, now: number, { taste = false } = {}): Picking {
  // Only insist on a Plex match when matching is actually working.
  const requirePlex = d.plexConfigured && d.movies.some((m) => m.plexRatingKey);
  const watched = new Set(d.watched.map((w) => w.movieId));
  const certs = allowedCerts(d.restriction);
  // For sagas, "watched" also covers "Seen it", and only parts this profile can play and may see
  // count: a part held back by its restrictions mustn't hold back the sequels it may watch.
  const seen = new Set([...watched, ...d.feedback.filter((e) => e.kind === 'seen').map((e) => e.movieId)]);
  const playable = d.movies.filter((m) => (!requirePlex || m.plexRatingKey) && certAllowed(m, certs));
  // Only requests still waiting to be watched get the boost and the label.
  const requested = new Set(d.boostRequests ? [...d.requested].filter((id) => !seen.has(id)) : []);
  // A movie someone else asked for isn't news to this profile when it arrives.
  const othersRequested = new Set([...d.requestedByOthers].filter((id) => !d.requested.has(id)));
  const ctx: ProfileContext = {
    watched,
    feedback: d.feedback,
    sagas: sagaState(playable, seen),
    allowedCerts: certs,
    requirePlex,
    includeWatched: d.includeWatched,
    watchlist: d.watchlist,
    requested,
  };
  return {
    ctx,
    eligible: eligibleMovies(d.movies, ctx),
    opts: {
      now,
      seed: String(d.profileId),
      watchlist: d.watchlist,
      requested,
      othersRequested,
      sagas: ctx.sagas,
      taste: taste ? tasteProfile(d.movies, tasteEvents(d.watched, d.feedback), now) : undefined,
    },
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
  if (!store.plexConfigured() || Date.now() < (lookupsPausedUntil.get(store) ?? 0)) return;
  const missing = movies.filter((m) => m.plexRatingKey && (m.plexSlug == null || m.plexGuid == null));
  if (!missing.length) return;

  const plex = store.get('plex');
  const client = new PlexServerClient(plex.serverUrl!, plex.clientId, plex.adminToken!);
  await Promise.all(
    missing.map(async (m) => {
      try {
        const item = await client.item(m.plexRatingKey!, ID_LOOKUP_MS);
        store.setPlexIds(m.id, { slug: item?.slug ?? m.plexSlug ?? '', guid: item?.plexGuid ?? m.plexGuid ?? '' });
      } catch (err) {
        // Item gone or server unreachable: keep it unknown and try again later. An unreachable
        // server would make every list of picks wait for the lookups, so stop asking for a while.
        if (!(err instanceof UpstreamError && err.status)) lookupsPausedUntil.set(store, Date.now() + LOOKUP_PAUSE_MS);
      }
    }),
  );
}

export function optionsFor(store: Store, row: ProfileRow, step: WizardStep, criteria: Criteria): WizardOptionsResponse {
  const { ctx, eligible } = picking(profileData(store, row), Date.now());
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
  const { ctx, eligible, opts } = picking(profileData(store, row), Date.now(), { taste: true });
  return toResponse(store, rankMovies(eligible, criteria, ctx.feedback, opts));
}

/** "Something like…": the eligible movies that share the most with one the profile loved. */
export async function similarFor(store: Store, row: ProfileRow, likedId: number): Promise<RecommendationsResponse> {
  const { ctx, eligible, opts } = picking(profileData(store, row), Date.now());
  const liked = store.movie(likedId);
  if (!liked || !certAllowed(liked, ctx.allowedCerts)) throw new HttpError(404, 'Movie not found');
  const ranked = rankSimilar(eligible, liked, store.movies(), ctx.feedback, opts);
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
  const certs = allowedCerts(row.restriction_profile);
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
