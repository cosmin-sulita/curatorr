import { STEP_ORDER, type Criteria } from '@curatorr/shared';
import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { applyToPlex, isPlexMark, revertInPlex } from '../services/plexSync.js';
import { likeSeeds, optionsFor, recommendFor, similarFor, toDTO } from '../services/recommend.js';
import { requireProfile } from '../session.js';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v !== 'any' ? v : null));

const criteriaSchema = z.object({ genre: optional, theme: optional, mood: optional, time: optional });
/** "Something like…": the movie the picks should resemble. */
const likeSchema = z.object({ like: z.coerce.number().int().positive().optional() });

export const pickRoutes: RouteModule = (app, { store }) => {
  const ready = () => {
    if (!store.get('setupComplete')) throw new HttpError(409, 'Setup is not complete', { needSetup: true });
  };

  app.get('/api/wizard/:step', async (req) => {
    ready();
    const profile = requireProfile(req, store);
    const { step } = parse(z.object({ step: z.enum(STEP_ORDER) }), req.params);
    const criteria: Criteria = parse(criteriaSchema, req.query);
    return optionsFor(store, profile, step, criteria);
  });

  app.get('/api/recommendations', async (req) => {
    ready();
    const profile = requireProfile(req, store);
    const { like } = parse(likeSchema, req.query);
    if (like) return similarFor(store, profile, like);
    const criteria: Criteria = parse(criteriaSchema, req.query);
    return recommendFor(store, profile, criteria);
  });

  /** Movies to start "Something like…" from: recently watched, or a title search. */
  app.get('/api/like', async (req) => {
    ready();
    const profile = requireProfile(req, store);
    const { q } = parse(z.object({ q: z.string().max(100).optional() }), req.query);
    return likeSeeds(store, profile, q);
  });

  app.post('/api/feedback', async (req) => {
    const profile = requireProfile(req, store);
    const body = parse(
      z.object({
        movieId: z.number().int(),
        kind: z.enum(['shown', 'skipped', 'seen', 'never', 'accepted', 'later']),
      }),
      req.body,
    );
    const movie = store.movie(body.movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    const id = store.addFeedback(profile.id, movie.id, body.kind);

    // "Seen it" → watched in Plex, "Later" → Plex Watchlist, for this profile.
    if (!isPlexMark(body.kind)) return { id };
    const plex = await applyToPlex(store, profile, movie, body.kind, req.log);
    if (plex === 'synced') store.setFeedbackSynced(id);
    return { id, plex };
  });

  /** Undo / restore. Plex is only changed back when Curatorr changed it in the first place. */
  app.delete('/api/feedback/:id', async (req) => {
    const profile = requireProfile(req, store);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const entry = store.feedbackEntry(profile.id, id);
    if (!entry) throw new HttpError(404, 'Not found');

    if (entry.kind !== 'seen' && entry.kind !== 'never' && entry.kind !== 'later') {
      store.deleteFeedback(profile.id, id);
      return { ok: true };
    }
    const { plexSynced } = store.deleteMarks(profile.id, entry.movieId, entry.kind);
    const movie = store.movie(entry.movieId);
    const plex =
      plexSynced && movie && isPlexMark(entry.kind)
        ? await revertInPlex(store, profile, movie, entry.kind, req.log)
        : 'skipped';
    return { ok: true, plex };
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
