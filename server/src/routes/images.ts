import { allowedFor } from '@curatorr/shared';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError, UpstreamError } from '../http.js';
import { demoArt } from '../demo.js';
import { JellyfinClient } from '../integrations/jellyfin.js';
import { RadarrClient } from '../integrations/radarr.js';
import { limitsFor } from '../services/recommend.js';
import { requireProfile } from '../session.js';

const WEEK_S = 7 * 24 * 60 * 60;

/** Only images go through: anything else Radarr or Jellyfin sends is served as a JPEG, never as a page. */
function imageType(res: Response) {
  const type = res.headers.get('content-type') ?? '';
  return /^image\/(jpeg|png|webp|gif|avif)\b/i.test(type) ? type : 'image/jpeg';
}

/** Anyone can ask for an image, so a failure doesn't say where Radarr or Jellyfin is; the log does. */
function unavailable(log: FastifyBaseLogger) {
  return (err: unknown): never => {
    if (!(err instanceof UpstreamError)) throw err;
    log.warn({ err: err.message }, 'image unavailable');
    throw new HttpError(502, 'Image unavailable');
  };
}

export const imageRoutes: RouteModule = (app, { store }) => {
  /**
   * Proxies Radarr's MediaCover images so the API key never reaches the browser. Only for the profile picked
   * on this device, and only of movies it may see; so only this browser keeps them.
   */
  app.get('/api/image/:id/:kind', async (req, reply) => {
    const profile = requireProfile(req, store);
    const { id, kind } = parse(z.object({ id: z.coerce.number().int(), kind: z.enum(['poster', 'fanart']) }), req.params);
    const movie = store.movie(id);
    const path = kind === 'poster' ? movie?.posterPath : movie?.fanartPath;
    const radarr = store.get('radarr');
    const allowed = movie && allowedFor(movie, limitsFor(store, [profile]));
    if (!allowed || !path || !radarr) throw new HttpError(404, 'No image');

    const res = await new RadarrClient(radarr.url, radarr.apiKey).image(path).catch(unavailable(req.log));
    return reply
      .header('content-type', imageType(res))
      .header('cache-control', `private, max-age=${WEEK_S}`)
      .send(Buffer.from(await res.arrayBuffer()));
  });

  /** Proxies Jellyfin users' pictures: people's phones may not reach Jellyfin's address. */
  app.get('/api/avatar/:userId', async (req, reply) => {
    const { userId } = parse(z.object({ userId: z.string().regex(/^[0-9a-f]{32}$/i) }), req.params);
    const { tag } = parse(z.object({ tag: z.string().max(100).optional() }), req.query);
    const jellyfin = store.get('jellyfin');
    if (!jellyfin || !store.jellyfinProfile(userId)) throw new HttpError(404, 'No image');

    const res = await JellyfinClient.connected(jellyfin)
      .userImage(userId, tag)
      .catch((err) => {
        // The picture was taken off since the profiles were read: the browser draws a blobatar.
        if (err instanceof UpstreamError && err.status === 404) throw new HttpError(404, 'No image');
        return unavailable(req.log)(err);
      });
    return reply
      .header('content-type', imageType(res))
      .header('cache-control', `public, max-age=${WEEK_S}`)
      .send(Buffer.from(await res.arrayBuffer()));
  });

  if (store.demo) {
    app.get('/api/demo/art/:id/:file', async (req, reply) => {
      const { id, file } = parse(
        z.object({ id: z.coerce.number().int(), file: z.enum(['poster.svg', 'fanart.svg']) }),
        req.params,
      );
      const svg = demoArt(id, file === 'poster.svg' ? 'poster' : 'fanart');
      if (!svg) throw new HttpError(404, 'No image');
      return reply.header('content-type', 'image/svg+xml').header('cache-control', `public, max-age=${WEEK_S}`).send(svg);
    });
  }
};
