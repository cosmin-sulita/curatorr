import {
  RESTRICTION_CERTS,
  allowedFor,
  eligibleMovies,
  isSurprise,
  onServer,
  qualityScore,
  rankMovies,
  rankSimilar,
  sagaState,
  surpriseOrder,
  tasteEvents,
  tasteProfile,
  wizardOptions,
  type Criteria,
  type FeedbackEvent,
  type LikeSeed,
  type MediaServer,
  type Movie,
  type MovieDTO,
  type ProfileContext,
  type RankOptions,
  type RankedMovie,
  type RecommendationsResponse,
  type WantedBy,
  type WizardOptionsResponse,
  type WizardStep,
} from '@curatorr/shared';
import { HttpError, UpstreamError } from '../http.js';
import { jellyfinLink } from '../integrations/jellyfin.js';
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
  /** For chips that say whose a pick is, when several watch together. */
  name: string;
  restriction: string | null;
  movies: Movie[];
  /** What the profile watched in Plex, and when. */
  watched: { movieId: number; viewedAt: number | null }[];
  feedback: FeedbackEvent[];
  /** The profile's Plex Watchlist. */
  watchlist: Set<number>;
  /** Library movies this profile requested in Seerr. */
  requested: Set<number>;
  /** The media server Curatorr uses. */
  server: MediaServer | null;
  /** The movies this profile can open there (Jellyfin: its library access and parental controls); null when all can. */
  available: Set<number> | null;
  includeWatched: boolean;
  boostRequests: boolean;
}

export function profileData(store: Store, row: ProfileRow): ProfileData {
  const app = store.get('app');
  return {
    profileId: row.id,
    name: row.name,
    restriction: row.restriction_profile,
    movies: store.movies(),
    watched: store.watchHistory(row.id),
    feedback: store.feedback(row.id),
    watchlist: store.watchlistIds(row.id),
    requested: store.requestedIds(row.id),
    server: store.mediaServer(),
    available: store.availableMovies(row),
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

const union = <T>(sets: Iterable<T>[]) => new Set(sets.flatMap((s) => [...s]));

/** The movies a profile wants to watch: on its media server's watchlist, or saved with "Watchlist" in Curatorr. */
const wantedIds = (d: { watchlist: Set<number>; feedback: FeedbackEvent[] }) =>
  union([d.watchlist, d.feedback.filter((e) => e.kind === 'later').map((e) => e.movieId)]);

/** What every non-null set holds; null when none limits anything. */
function intersection<T>(sets: (Set<T> | null)[]): Set<T> | null {
  const limits = sets.filter((s): s is Set<T> => s != null);
  if (!limits.length) return null;
  return new Set([...limits[0]!].filter((x) => limits.every((s) => s.has(x))));
}

/** Members' marks of the same moment (a group's skip is saved for each of them) count once. */
function dedupe(events: FeedbackEvent[]): FeedbackEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.movieId}|${e.kind}|${e.createdAt}`;
    return !seen.has(key) && Boolean(seen.add(key));
  });
}

/**
 * The context and options for ranking at `now`, for one profile or several watching together.
 * Together, a movie is out if anyone watched it or marked it Seen it or Never; everyone's limits apply;
 * a saga goes on from where everyone has got to; anyone's watchlist and requests count; and tastes blend
 * (see `tastePoints`). One profile is a group of one. `taste` also works out tastes, which only ranking
 * the picks needs.
 */
export function picking(group: ProfileData | ProfileData[], now: number, { taste = false } = {}): Picking {
  const members = Array.isArray(group) ? group : [group];
  // The library and the app's settings are the same for every member.
  const d = members[0]!;
  // Only insist on a server match when matching is actually working.
  const server = d.server;
  const requireServer = server && d.movies.some((m) => onServer(m, server)) ? server : null;
  const views = members.map((m) => {
    const watched = new Set(m.watched.map((w) => w.movieId));
    // For sagas, "watched" also covers "Seen it".
    const seen = new Set([...watched, ...m.feedback.filter((e) => e.kind === 'seen').map((e) => e.movieId)]);
    // Only requests still waiting to be watched get the boost and the label.
    const requested = new Set(d.boostRequests ? [...m.requested].filter((id) => !seen.has(id)) : []);
    return { m, watched, seen, requested, wanted: wantedIds(m) };
  });
  const watched = union(views.map((v) => v.watched));
  const certs = intersection(members.map((m) => allowedCerts(m.restriction)));
  // What each member can open is known by TMDB and IMDb id, so it holds even while matching isn't working.
  const available = intersection(members.map((m) => m.available));
  const limits = { allowedCerts: certs, available };
  const seenByAll = intersection(views.map((v) => v.seen))!;
  // Only parts everyone can play and may see count: a part held back by limits mustn't hold back the sequels.
  const playable = d.movies.filter((m) => (!requireServer || onServer(m, requireServer)) && allowedFor(m, limits));
  const requested = union(views.map((v) => v.requested));
  const watchlist = union(members.map((m) => m.watchlist));
  const ctx: ProfileContext = {
    watched,
    feedback: members.length > 1 ? dedupe(members.flatMap((m) => m.feedback)) : d.feedback,
    sagas: sagaState(playable, seenByAll),
    allowedCerts: certs,
    requireServer,
    available,
    includeWatched: d.includeWatched,
    watchlist,
    requested,
  };
  return {
    ctx,
    eligible: eligibleMovies(d.movies, ctx),
    opts: {
      now,
      seed: members
        .map((m) => m.profileId)
        .sort((a, b) => a - b)
        .join('+'),
      watchlist,
      requested,
      sagas: ctx.sagas,
      wantedBy: members.length > 1 ? wantedBy(views) : undefined,
      taste: !taste
        ? undefined
        : members.length > 1
          ? members.map((m) => ({ ...tasteProfile(d.movies, tasteEvents(m.watched, m.feedback), now), name: m.name }))
          : tasteProfile(d.movies, tasteEvents(d.watched, d.feedback), now),
    },
  };
}

/** Whose request, and whose watchlist, each movie someone in the group wants is. */
function wantedBy(views: { m: ProfileData; requested: Set<number>; wanted: Set<number> }[]): Map<number, WantedBy> {
  const out = new Map<number, WantedBy>();
  const entry = (id: number) => out.get(id) ?? out.set(id, { requested: [], watchlist: [] }).get(id)!;
  for (const { m, requested, wanted } of views) {
    for (const id of requested) entry(id).requested.push(m.name);
    for (const id of wanted) entry(id).watchlist.push(m.name);
  }
  return out;
}

/** Who among `rows` has the movie on their watchlist, in their order. */
export function onWatchlistOf(store: Store, rows: ProfileRow[], movieId: number): number[] {
  return rows.flatMap((row) =>
    wantedIds({ watchlist: store.watchlistIds(row.id), feedback: store.feedback(row.id) }).has(movieId) ? [row.id] : [],
  );
}

/** Links that open a movie on the media server: `web` in a browser, `app` in its phone apps. */
function watchLinks(store: Store, m: StoredMovie): { web: string; app: string | null } | null {
  const jellyfin = store.get('jellyfin');
  if (jellyfin) {
    // Jellyfin's apps don't open links, so phones get its web app too.
    if (!m.jellyfinId) return null;
    return { web: jellyfinLink(jellyfin.publicUrl ?? jellyfin.url, jellyfin.serverId, m.jellyfinId), app: null };
  }
  const plex = store.get('plex');
  return m.plexRatingKey && plex.machineId ? plexLinks(plex.machineId, m.plexRatingKey, m.plexSlug) : null;
}

export function toDTO(store: Store, m: StoredMovie): MovieDTO {
  const links = watchLinks(store, m);
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
    watchUrl: links?.web ?? null,
    watchAppUrl: links?.app ?? null,
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

/** The profiles picking: one, or several watching together. */
const groupData = (store: Store, rows: ProfileRow[]) => rows.map((row) => profileData(store, row));

export function optionsFor(store: Store, rows: ProfileRow[], step: WizardStep, criteria: Criteria): WizardOptionsResponse {
  const now = Date.now();
  const { ctx, eligible } = picking(groupData(store, rows), now);
  return wizardOptions(eligible, step, criteria, {
    image: (m, kind) => (kind === 'fanart' ? (m.fanartUrl ?? m.posterUrl) : (m.posterUrl ?? m.fanartUrl)),
    sagaStarters: ctx.sagas?.starters,
    now,
  });
}

async function toResponse(store: Store, group: ProfileData[], ranked: RankedMovie[]): Promise<RecommendationsResponse> {
  await ensurePlexIds(store, ranked.map((r) => r.movie as StoredMovie));
  const wanted = group.map((d) => ({ profileId: d.profileId, movies: wantedIds(d) }));
  return {
    total: ranked.filter((r) => r.tier === 0).length,
    picks: ranked.map((r) => ({
      movie: toDTO(store, r.movie as StoredMovie),
      score: r.score,
      closeMatch: r.tier > 0,
      reasons: r.reasons,
      onWatchlistOf: wanted.flatMap((w) => (w.movies.has(r.movie.id) ? [w.profileId] : [])),
    })),
  };
}

export async function recommendFor(store: Store, rows: ProfileRow[], criteria: Criteria): Promise<RecommendationsResponse> {
  const group = groupData(store, rows);
  const { ctx, eligible, opts } = picking(group, Date.now(), { taste: true });
  const ranked = rankMovies(eligible, criteria, ctx.feedback, opts);
  return toResponse(store, group, isSurprise(criteria) ? surpriseOrder(ranked, opts) : ranked);
}

/** "Something like…": the eligible movies that share the most with one the profile loved. */
export async function similarFor(store: Store, rows: ProfileRow[], likedId: number): Promise<RecommendationsResponse> {
  const group = groupData(store, rows);
  const { ctx, eligible, opts } = picking(group, Date.now());
  const liked = store.movie(likedId);
  if (!liked || !allowedFor(liked, ctx)) throw new HttpError(404, 'Movie not found');
  const ranked = rankSimilar(eligible, liked, store.movies(), ctx.feedback, opts);
  return { ...(await toResponse(store, group, ranked)), like: { id: liked.id, title: liked.title } };
}

/** Lowercase without accents, so "amelie" finds "Amélie". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Movies to start "Something like…" from: without a query, what the profile (or anyone watching
 * together) watched in Plex or marked "Seen it", most recent first; with one, matching titles in the
 * library, watched first. Only movies everyone may see.
 */
export function likeSeeds(store: Store, rows: ProfileRow[], q = ''): LikeSeed[] {
  const watchedAt = new Map<number, number>();
  const latest = (id: number, at: number) => watchedAt.set(id, Math.max(watchedAt.get(id) ?? 0, at));
  for (const row of rows) {
    for (const w of store.watchHistory(row.id)) latest(w.movieId, w.viewedAt ?? 0);
    for (const e of store.feedback(row.id)) if (e.kind === 'seen') latest(e.movieId, e.createdAt);
  }
  const { ctx } = picking(groupData(store, rows), Date.now());
  const movies = store.movies().filter((m) => allowedFor(m, ctx));
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
      return [{ m, watched: watchedAt.has(m.id), prefix: title.startsWith(query), quality: qualityScore(m.ratings) }];
    })
    .sort(
      (a, b) =>
        Number(b.watched) - Number(a.watched) || Number(b.prefix) - Number(a.prefix) || b.quality - a.quality,
    )
    .slice(0, LIKE_SEARCH)
    .map(({ m }) => toSeed(m));
}
