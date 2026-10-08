import { STEP_ORDER, type Criteria } from '@curatorr/shared';
import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { optionsFor, recommendFor, toDTO } from '../services/recommend.js';
import { requireProfile } from '../session.js';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v !== 'any' ? v : null));

const criteriaSchema = z.object({ genre: optional, theme: optional, mood: optional, time: optional });

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
    const criteria: Criteria = parse(criteriaSchema, req.query);
    return recommendFor(store, profile, criteria);
  });

  app.post('/api/feedback', async (req) => {
    const profile = requireProfile(req, store);
    const body = parse(
      z.object({
        movieId: z.number().int(),
        kind: z.enum(['shown', 'skipped', 'seen', 'never', 'accepted']),
      }),
      req.body,
    );
    if (!store.movie(body.movieId)) throw new HttpError(404, 'Movie not found');
    return { id: store.addFeedback(profile.id, body.movieId, body.kind) };
  });

  app.delete('/api/feedback/:id', async (req) => {
    const profile = requireProfile(req, store);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    if (!store.deleteFeedback(profile.id, id)) throw new HttpError(404, 'Not found');
    return { ok: true };
  });

  /** Movies this profile marked "seen" or "never", so they can be restored. */
  app.get('/api/hidden', async (req) => {
    const profile = requireProfile(req, store);
    return store.hiddenMovies(profile.id).flatMap((h) => {
      const movie = store.movie(h.movieId);
      return movie ? [{ id: h.id, kind: h.kind, createdAt: h.createdAt, movie: toDTO(store, movie) }] : [];
    });
  });
};
