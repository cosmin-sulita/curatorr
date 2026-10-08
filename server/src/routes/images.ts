import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { demoArt } from '../demo.js';
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
