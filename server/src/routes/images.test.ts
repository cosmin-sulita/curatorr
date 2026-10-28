import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listen, storedMovieMaker, tempApp, type App } from '../testing.js';

/** What the fake Radarr answers for a MediaCover image: its content type and body. */
const covers: Record<string, { type: string; body: string }> = {
  '/MediaCover/1/poster.jpg': { type: 'image/jpeg', body: 'JPEG' },
  '/MediaCover/2/poster.jpg': { type: 'text/html', body: '<script>alert(document.domain)</script>' },
  '/MediaCover/3/poster.jpg': { type: 'image/jpeg', body: 'R-RATED' },
};

const stored = storedMovieMaker();
const movie = (id: number, certification = 'PG') =>
  stored({ id, certification, posterUrl: `/api/image/${id}/poster`, posterPath: `/MediaCover/${id}/poster.jpg` });

describe("Radarr's images, through Curatorr", () => {
  let radarr: Server;
  let base = '';
  let close: () => Promise<void>;
  let app: App;
  let ctx: Awaited<ReturnType<typeof tempApp>>['ctx'];
  /** Profiles picked on a device: one without limits, and a younger kid's. */
  let viewer = '';
  let kid = '';

  beforeAll(async () => {
    radarr = createServer((req, res) => {
      const cover = covers[new URL(req.url!, 'http://x').pathname];
      res.writeHead(cover ? 200 : 404, { 'content-type': cover?.type ?? 'application/json' });
      res.end(cover?.body ?? '{}');
    });
    base = await listen(radarr);
    ({ app, ctx, close } = await tempApp('images', { demo: false }));
    ctx.store.set('radarr', { url: base, apiKey: 'radarr-key' });
    ctx.store.replaceMovies([movie(1), movie(2), movie(3, 'R')], Date.now());
    const picked = (id: number) => `curatorr_profile=${encodeURIComponent(app.signCookie(String(id)))}`;
    viewer = picked(ctx.store.createLocalProfile('Viewer', false));
    kid = picked(ctx.store.createLocalProfile('Kid', false, 'little_kid'));
  });

  afterAll(async () => {
    await close();
    radarr.close();
  });

  const image = (id: number, cookie = viewer) =>
    app.inject({ method: 'GET', url: `/api/image/${id}/poster`, headers: { cookie } });

  it('passes a poster through, for this browser alone to keep', async () => {
    const res = await image(1);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=604800');
    expect(res.body).toBe('JPEG');
  });

  it('only shows a picture to a profile picked on this device', async () => {
    const res = await image(1, '');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ needProfile: true });
  });

  it("doesn't show a movie's picture to a profile its parental limits keep the movie from", async () => {
    const res = await image(3, kid);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No image' });
    expect((await image(3)).body).toBe('R-RATED');
  });

  it('serves whatever Radarr sends as an image, so a page from it never runs on Curatorr', async () => {
    const res = await image(2);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it("doesn't tell visitors where Radarr is when it can't be reached", async () => {
    ctx.store.set('radarr', { url: 'http://127.0.0.1:9', apiKey: 'radarr-key' });
    const res = await image(1);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Image unavailable' });
    ctx.store.set('radarr', { url: base, apiKey: 'radarr-key' });
  });
});
