import {
  STEP_ORDER,
  allowedFor,
  dayStart,
  shelfById,
  type Criteria,
  type FeedbackResponse,
  type HiddenMovie,
  type ListedMovie,
  type UndoResponse,
  type WatchlistRemoval,
} from '@curatorr/shared';
import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { applyMark, isServerMark, revertMark, type ServerSyncResult } from '../services/mediaServer.js';
import {
  likeSeeds,
  limitsFor,
  onWatchlistOf,
  optionsFor,
  recommendFor,
  similarFor,
} from '../services/recommend.js';
import { requireGroup, requireProfile } from '../session.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v !== 'any' ? v : null));

/** A shortcut from the first question: one Curatorr knows, or none. */
const shelf = z
  .string()
  .optional()
  .refine((v) => !v || shelfById.has(v), 'unknown shortcut')
  .transform((v) => v || null);

const criteriaSchema = z.object({ genre: optional, theme: optional, mood: optional, time: optional, shelf });

/** What happened on the media server for a mark made for several people: the worst news first. */
function overall(results: ServerSyncResult[]): ServerSyncResult {
  for (const r of ['failed', 'synced', 'already'] as const) if (results.includes(r)) return r;
  return 'skipped';
}

/** Whom a personal mark is for: those `profileIds` names among the people watching, or the device's profile. */
function markedFor(group: ProfileRow[], profileIds?: number[]): ProfileRow[] {
  const wanted = [...new Set(profileIds ?? [group[0]!.id])];
  const targets = wanted.flatMap((id) => group.find((r) => r.id === id) ?? []);
  if (!targets.length || targets.length < wanted.length) throw new HttpError(400, 'Mark it for someone watching');
  return targets;
}

/**
 * Nobody marks or lists a movie their parental limits keep from them, or that their Jellyfin account can't
 * open: it would show on their lists, and on their media server. Each person is checked alone, so a grown-up
 * watching with a kid still marks for themselves.
 */
function allowedForEach(store: Store, movie: StoredMovie, rows: ProfileRow[]) {
  if (!rows.every((row) => allowedFor(movie, limitsFor(store, [row])))) throw new HttpError(404, 'Movie not found');
}

/** "Something like…": the movie the picks should resemble. */
const likeSchema = z.object({ like: z.coerce.number().int().positive().optional() });

export const pickRoutes: RouteModule = (app, { store }) => {
  const ready = () => {
    if (!store.get('setupComplete')) throw new HttpError(409, 'Setup is not complete', { needSetup: true });
  };

  app.get('/api/wizard/:step', async (req) => {
    ready();
    // Picks are for the device's profile and anyone watching with it.
    const group = requireGroup(req, store);
    const { step } = parse(z.object({ step: z.enum(STEP_ORDER) }), req.params);
    const criteria: Criteria = parse(criteriaSchema, req.query);
    return optionsFor(store, group, step, criteria);
  });

  app.get('/api/recommendations', async (req) => {
    ready();
    const group = requireGroup(req, store);
    const { like } = parse(likeSchema, req.query);
    if (like) return similarFor(store, group, like);
    const criteria: Criteria = parse(criteriaSchema, req.query);
    return recommendFor(store, group, criteria);
  });

  /** Movies to start "Something like…" from: recently watched, or a title search. */
  app.get('/api/like', async (req) => {
    ready();
    const group = requireGroup(req, store);
    const { q } = parse(z.object({ q: z.string().max(100).optional() }), req.query);
    return likeSeeds(store, group, q);
  });

  /**
   * Shown, skipped and played picks count for everyone watching; Seen it, Never and Watchlist for whoever
   * `profileIds` names among them (the device's profile when it's on its own). Every row is saved at the
   * same moment, so ranking for the group counts a shared one once.
   */
  app.post('/api/feedback', async (req): Promise<FeedbackResponse> => {
    const group = requireGroup(req, store);
    const body = parse(
      z.object({
        movieId: z.number().int(),
        kind: z.enum(['shown', 'skipped', 'seen', 'never', 'accepted', 'later']),
        profileIds: z.array(z.number().int()).max(20).optional(),
      }),
      req.body,
    );
    const movie = store.movie(body.movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    const personal = body.kind === 'seen' || body.kind === 'never' || body.kind === 'later';
    const targets = personal ? markedFor(group, body.profileIds) : group;
    allowedForEach(store, movie, targets);
    const at = Date.now();
    const ids = targets.map((row) => store.addFeedback(row.id, movie.id, body.kind, at));
    // Played on one account, so the others get it marked watched once that account shows it (together.ts).
    if (body.kind === 'accepted' && group.length > 1) store.recordTogether(movie.id, targets.map((r) => r.id), at);

    // "Seen it" → watched on the media server, "Watchlist" → its watchlist, for each of them.
    if (!isServerMark(body.kind)) return { id: ids[0]!, ids };
    const kind = body.kind;
    const results = await Promise.all(
      targets.map(async (row, i) => {
        const result = await applyMark(store, row, movie, kind, req.log);
        if (result === 'synced') store.setFeedbackSynced(ids[i]!);
        return result;
      }),
    );
    return { id: ids[0]!, ids, server: overall(results) };
  });

  /** Undo / restore. The media server is only changed back when Curatorr changed it in the first place. */
  app.delete('/api/feedback/:id', async (req): Promise<UndoResponse> => {
    // Undo after a mark made for someone else in the group, too.
    const group = requireGroup(req, store);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const entry = store.feedbackEntryOf(group.map((r) => r.id), id);
    // Someone else's marks only from tonight: the ones made while watching together.
    const othersOlder = entry && entry.profileId !== group[0]!.id && entry.createdAt < dayStart(Date.now());
    if (!entry || othersOlder) throw new HttpError(404, 'Not found');
    const profile = group.find((r) => r.id === entry.profileId)!;

    if (entry.kind !== 'seen' && entry.kind !== 'never' && entry.kind !== 'later') {
      store.deleteFeedback(profile.id, id);
      return { ok: true };
    }
    const { serverSynced } = store.deleteMarks(profile.id, entry.movieId, entry.kind);
    const movie = store.movie(entry.movieId);
    const server =
      serverSynced && movie && isServerMark(entry.kind)
        ? await revertMark(store, profile, movie, entry.kind, req.log)
        : 'skipped';
    return { ok: true, server };
  });

  /**
   * Takes a movie off the watchlist of those `profileIds` names (the device's profile when it's on its own):
   * their "Watchlist" marks, and the media server's watchlist. Curatorr takes back what it put there itself, but
   * an entry made in Plex or Jellyfin only while the owner lets marks update the server. Answers who among those
   * watching still has it there, e.g. when the server couldn't be reached.
   */
  app.delete('/api/watchlist/:movieId', async (req): Promise<WatchlistRemoval> => {
    const group = requireGroup(req, store);
    const { movieId } = parse(z.object({ movieId: z.coerce.number().int() }), req.params);
    const body = parse(z.object({ profileIds: z.array(z.number().int()).max(20).optional() }), req.body ?? {});
    const movie = store.movie(movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    const targets = markedFor(group, body.profileIds);
    allowedForEach(store, movie, targets);
    const results = await Promise.all(
      targets.map(async (row): Promise<ServerSyncResult> => {
        const { serverSynced } = store.deleteMarks(row.id, movie.id, 'later');
        const onServer = store.watchlistIds(row.id).has(movie.id);
        if (!onServer || !(serverSynced || store.get('app').syncToServer)) return 'skipped';
        return revertMark(store, row, movie, 'later', req.log);
      }),
    );
    return { server: overall(results), onWatchlistOf: onWatchlistOf(store, group, movie.id) };
  });

  /**
   * Settings' lists, newest first: movies this profile marked "seen" or "never", and its watchlist. The watchlist is
   * what it saved with "Watchlist" in Curatorr plus what's on its media server's (the Plex Watchlist, Jellyfin
   * favourites), as for picks. A movie only the server has on it has no mark, so no `id`.
   */
  app.get('/api/hidden', async (req): Promise<HiddenMovie[]> => {
    const profile = requireProfile(req, store);
    const marks = store.markedMovies(profile.id);
    const saved = new Set(marks.flatMap((m) => (m.kind === 'later' ? [m.movieId] : [])));
    const onServer = store
      .watchlistEntries(profile.id)
      .filter((w) => !saved.has(w.movieId))
      .map((w) => ({ id: null, movieId: w.movieId, kind: 'later' as const, createdAt: w.addedAt }));
    // Stable, so the server's order breaks ties. Entries saved before Curatorr dated them go last.
    const newestFirst = [...marks, ...onServer].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    // Not what the profile's limits keep from it, also when it was listed before they applied.
    const limits = limitsFor(store, [profile]);
    return newestFirst.flatMap(({ movieId, ...entry }): HiddenMovie[] => {
      const movie = store.movie(movieId);
      if (!movie || !allowedFor(movie, limits)) return [];
      // Only what the lists show: a long watchlist is hundreds of movies.
      const listed: ListedMovie = { id: movie.id, title: movie.title, year: movie.year, posterUrl: movie.posterUrl };
      return [{ ...entry, movie: listed }];
    });
  });
};
