import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError, UpstreamError } from '../http.js';
import { demoArt } from '../demo.js';
import { JellyfinClient } from '../integrations/jellyfin.js';
import { RadarrClient } from '../integrations/radarr.js';

const WEEK_S = 7 * 24 * 60 * 60;

export const imageRoutes: RouteModule = (app, { store }) => {
  /** Proxies Radarr's MediaCover images so the API key never reaches the browser. */
  app.get('/api/image/:id/:kind', async (req, reply) => {
    const { id, kind } = parse(z.object({ id: z.coerce.number().int(), kind: z.enum(['poster', 'fanart']) }), req.params);
    const movie = store.movie(id);
    const path = kind === 'poster' ? movie?.posterPath : movie?.fanartPath;
    const radarr = store.get('radarr');
    if (!path || !radarr) throw new HttpError(404, 'No image');

    const res = await new RadarrClient(radarr.url, radarr.apiKey).image(path);
    return reply
      .header('content-type', res.headers.get('content-type') ?? 'image/jpeg')
      .header('cache-control', `public, max-age=${WEEK_S}`)
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
        throw err instanceof UpstreamError && err.status === 404 ? new HttpError(404, 'No image') : err;
      });
    return reply
      .header('content-type', res.headers.get('content-type') ?? 'image/jpeg')
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
