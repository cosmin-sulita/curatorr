import { STEP_ORDER, shelfById, type Criteria } from '@curatorr/shared';
import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { applyMark, isServerMark, revertMark, type ServerSyncResult } from '../services/mediaServer.js';
import { likeSeeds, optionsFor, recommendFor, similarFor, toDTO } from '../services/recommend.js';
import { requireGroup, requireProfile } from '../session.js';

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
  app.post('/api/feedback', async (req) => {
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
    const wanted = personal ? [...new Set(body.profileIds ?? [group[0]!.id])] : group.map((r) => r.id);
    const targets = wanted.flatMap((id) => group.find((r) => r.id === id) ?? []);
    if (!targets.length || targets.length < wanted.length) throw new HttpError(400, 'Mark it for someone watching');
    const at = Date.now();
    const ids = targets.map((row) => store.addFeedback(row.id, movie.id, body.kind, at));
    // Played on one account, so the others get it marked watched once that account shows it (together.ts).
    if (body.kind === 'accepted' && group.length > 1) store.recordTogether(movie.id, targets.map((r) => r.id), at);

    // "Seen it" → watched on the media server, "Watchlist" → its watchlist, for each of them.
    if (!isServerMark(body.kind)) return { id: ids[0], ids };
    const kind = body.kind;
    const results = await Promise.all(
      targets.map(async (row, i) => {
        const result = await applyMark(store, row, movie, kind, req.log);
        if (result === 'synced') store.setFeedbackSynced(ids[i]!);
        return result;
      }),
    );
    return { id: ids[0], ids, server: overall(results) };
  });

  /** Undo / restore. The media server is only changed back when Curatorr changed it in the first place. */
  app.delete('/api/feedback/:id', async (req) => {
    // Undo after a mark made for someone else in the group, too.
    const group = requireGroup(req, store);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const entry = store.feedbackEntryOf(group.map((r) => r.id), id);
    if (!entry) throw new HttpError(404, 'Not found');
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

  /** Movies this profile marked "seen", "never" or saved for "later", so they can be restored. */
  app.get('/api/hidden', async (req) => {
    const profile = requireProfile(req, store);
    return store.markedMovies(profile.id).flatMap((h) => {
      const movie = store.movie(h.movieId);
      return movie ? [{ id: h.id, kind: h.kind, createdAt: h.createdAt, movie: toDTO(store, movie) }] : [];
    });
  });
};
