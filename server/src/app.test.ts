import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { AppStatus, LikeSeed, Profile, RecommendationsResponse, WizardOptionsResponse } from '@curatorr/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { config } from './config.js';
import { cookieOf, tempApp } from './testing.js';

describe('API (demo data)', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let ctx: Awaited<ReturnType<typeof buildApp>>['ctx'];
  /** Alex's profile, picked on this device. */
  let cookie = '';

  // Each test starts from the demo as it's seeded, with Alex picked, so it runs the same on its own.
  beforeEach(async () => {
    ({ app, ctx, close } = await tempApp('test'));
    cookie = await cookieFor('Alex');
  });

  afterEach(async () => {
    await close();
  });

  const get = async <T>(url: string, as = cookie) => {
    const res = await app.inject({ method: 'GET', url, headers: { cookie: as } });
    return { status: res.statusCode, body: res.json() as T };
  };

  it('reports status', async () => {
    const { body } = await get<AppStatus>('/api/status', '');
    expect(body.setupComplete).toBe(true);
    expect(body.demo).toBe(true);
    expect(body.server).toBeNull();
    expect(body.library.movies).toBeGreaterThan(50);
    expect(body.profile).toBeNull();
  });

  it('requires a profile for the wizard', async () => {
    const { status } = await get('/api/wizard/genre', '');
    expect(status).toBe(401);
  });

  it('selects a profile and remembers it', async () => {
    const { body: profiles } = await get<Profile[]>('/api/profiles');
    expect(profiles.map((p) => p.name)).toEqual(['Alex', 'Kids', 'Sam']);
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${profiles[0]!.id}/select` });
    expect(res.statusCode).toBe(200);
    const { body } = await get<AppStatus>('/api/status', cookieOf(res));
    expect(body.profile?.name).toBe('Alex');
  });

  it('walks the wizard without dead ends', async () => {
    const genres = await get<WizardOptionsResponse>('/api/wizard/genre');
    expect(genres.body.options.length).toBeGreaterThan(5);
    const genre = genres.body.options.find((o) => o.id === 'Horror')!;
    expect(genre.count).toBeGreaterThanOrEqual(3);

    const themes = await get<WizardOptionsResponse>(`/api/wizard/theme?genre=Horror`);
    expect(themes.body.total).toBe(genre.count);
    for (const o of themes.body.options) expect(o.count).toBeGreaterThanOrEqual(3);

    const theme = themes.body.options[0]!;
    const moods = await get<WizardOptionsResponse>(`/api/wizard/mood?genre=Horror&theme=${theme.id}`);
    expect(moods.body.total).toBe(theme.count);
  });

  it('recommends the best rated match first and hides watched movies', async () => {
    const { body } = await get<RecommendationsResponse>('/api/recommendations?genre=Action');
    expect(body.picks.length).toBeGreaterThan(3);
    const titles = body.picks.map((p) => p.movie.title);
    expect(titles).not.toContain('The Dark Knight'); // Alex has watched it
    const scores = body.picks.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(body.picks[0]!.reasons.some((r) => r.kind === 'genre')).toBe(true);
  });

  it('stops suggesting a movie marked as seen, and can undo it', async () => {
    const first = (await get<RecommendationsResponse>('/api/recommendations?genre=Comedy')).body.picks[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie },
      payload: { movieId: first.movie.id, kind: 'seen' },
    });
    const { id } = res.json() as { id: number };
    const after = (await get<RecommendationsResponse>('/api/recommendations?genre=Comedy')).body.picks;
    expect(after.map((p) => p.movie.id)).not.toContain(first.movie.id);

    await app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie } });
    const restored = (await get<RecommendationsResponse>('/api/recommendations?genre=Comedy')).body.picks;
    expect(restored.map((p) => p.movie.id)).toContain(first.movie.id);
  });

  it('undoes a skip, so the pick is back on top', async () => {
    const first = (await get<RecommendationsResponse>('/api/recommendations?genre=Family')).body.picks[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie },
      payload: { movieId: first.movie.id, kind: 'skipped' },
    });
    const { id } = res.json() as { id: number };
    const after = (await get<RecommendationsResponse>('/api/recommendations?genre=Family')).body.picks;
    expect(after[0]!.movie.id).not.toBe(first.movie.id);

    await app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie } });
    const restored = (await get<RecommendationsResponse>('/api/recommendations?genre=Family')).body.picks;
    expect(restored[0]!.movie.id).toBe(first.movie.id);
  });

  it('saves for later without Plex and favours the movie next time', async () => {
    const last = (await get<RecommendationsResponse>('/api/recommendations?genre=Drama')).body.picks.at(-1)!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie },
      payload: { movieId: last.movie.id, kind: 'later' },
    });
    expect(res.json()).toMatchObject({ server: 'skipped' });
    const again = (await get<RecommendationsResponse>('/api/recommendations?genre=Drama')).body.picks;
    const saved = again.find((p) => p.movie.id === last.movie.id)!;
    expect(saved.reasons[0]?.kind).toBe('watchlist');
    expect(again.indexOf(saved)).toBeLessThan(again.length - 1);
  });

  it("lists the profile's movies with what its lists show of each: the title, year and poster", async () => {
    const movieId = (await get<RecommendationsResponse>('/api/recommendations?genre=Drama')).body.picks[0]!.movie.id;
    await app.inject({ method: 'POST', url: '/api/feedback', headers: { cookie }, payload: { movieId, kind: 'later' } });
    const listed = (await get<{ kind: string; movie: { id: number } }[]>('/api/hidden')).body;
    expect(listed.map((h) => h.kind)).toContain('later');
    for (const { movie } of listed) {
      const m = ctx.store.movie(movie.id)!;
      expect(movie).toEqual({ id: m.id, title: m.title, year: m.year, posterUrl: m.posterUrl });
    }
  });

  it('takes a movie off the watchlist, and its pick no longer says it is on there', async () => {
    const me = (await get<AppStatus>('/api/status')).body.profile!.id;
    const drama = async () => (await get<RecommendationsResponse>('/api/recommendations?genre=Drama')).body.picks;
    const movieId = (await drama())[0]!.movie.id;
    await app.inject({ method: 'POST', url: '/api/feedback', headers: { cookie }, payload: { movieId, kind: 'later' } });
    expect((await drama()).find((p) => p.movie.id === movieId)?.onWatchlistOf).toEqual([me]);

    const res = await app.inject({ method: 'DELETE', url: `/api/watchlist/${movieId}`, headers: { cookie } });
    expect(res.json()).toEqual({ server: 'skipped', onWatchlistOf: [] });
    const after = (await drama()).find((p) => p.movie.id === movieId);
    expect(after?.onWatchlistOf).toEqual([]);
    expect(after?.reasons.map((r) => r.kind)).not.toContain('watchlist');

    const unknown = await app.inject({ method: 'DELETE', url: '/api/watchlist/999999', headers: { cookie } });
    expect(unknown.statusCode).toBe(404);
  });

  const cookieFor = async (name: string) => {
    const { body: profiles } = await get<Profile[]>('/api/profiles');
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${profiles.find((p) => p.name === name)!.id}/select` });
    return cookieOf(res);
  };
  const picksFor = async (who: string, query: string) =>
    (await app.inject({ method: 'GET', url: `/api/recommendations?${query}`, headers: { cookie: who } })).json() as RecommendationsResponse;

  it('keeps sagas in order: part 1 before its sequels', async () => {
    const sam = await cookieFor('Sam'); // hasn't seen any Back to the Future
    const picks = (await picksFor(sam, 'theme=time-travel')).picks;
    const titles = picks.map((p) => p.movie.title);
    expect(titles).not.toContain('Back to the Future Part II');
    expect(titles).not.toContain('Back to the Future Part III');
    const part1 = picks.find((p) => p.movie.title === 'Back to the Future')!;
    expect(part1.reasons.map((r) => r.label)).toContain('Start of Back to the Future');
    expect(part1.movie.saga).toEqual({ title: 'Back to the Future', part: 1, parts: 3 });
  });

  it('moves on to the next part once the first is watched', async () => {
    const alex = await cookieFor('Alex'); // watched part 1
    const titles = (await picksFor(alex, 'theme=time-travel')).picks;
    const part2 = titles.find((p) => p.movie.title === 'Back to the Future Part II')!;
    expect(part2.reasons[0]).toEqual({ kind: 'saga', label: 'Next in Back to the Future' });
    expect(titles.map((p) => p.movie.title)).not.toContain('Back to the Future Part III');
  });

  it('"Start a saga" offers first parts of sagas not started yet', async () => {
    const sam = await cookieFor('Sam');
    const titles = (await picksFor(sam, 'time=saga')).picks.map((p) => p.movie.title).sort();
    expect(titles).toEqual(['Back to the Future', 'John Wick', 'The Lord of the Rings: The Fellowship of the Ring']);
    const options = (await app.inject({ method: 'GET', url: '/api/wizard/time', headers: { cookie: sam } })).json() as WizardOptionsResponse;
    expect(options.options.find((o) => o.id === 'saga')?.count).toBe(3);
  });

  it('applies Plex parental restrictions', async () => {
    const { body: profiles } = await get<Profile[]>('/api/profiles');
    const kids = profiles.find((p) => p.name === 'Kids')!;
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${kids.id}/select` });
    const kidCookie = cookieOf(res);
    const recs = await app.inject({ method: 'GET', url: '/api/recommendations', headers: { cookie: kidCookie } });
    const certs = new Set((recs.json() as RecommendationsResponse).picks.map((p) => p.movie.certification));
    expect([...certs].every((c) => c === 'G' || c === 'PG')).toBe(true);
  });

  const likeFor = async (who: string, q = '') =>
    (await app.inject({ method: 'GET', url: `/api/like?q=${encodeURIComponent(q)}`, headers: { cookie: who } })).json() as LikeSeed[];

  it('lists watched movies to start "Something like…" from, and searches the library', async () => {
    const alex = await cookieFor('Alex');
    const recent = await likeFor(alex);
    expect(recent.map((m) => m.title).sort()).toEqual(['Back to the Future', 'Inception', 'The Dark Knight', 'The Godfather']);
    expect(recent.every((m) => m.watched)).toBe(true);
    const found = await likeFor(alex, 'MATRIX');
    expect(found.map((m) => [m.title, m.watched])).toEqual([['The Matrix', false]]);
  });

  it('suggests unwatched movies like one you loved', async () => {
    const alex = await cookieFor('Alex');
    const inception = (await likeFor(alex, 'inception'))[0]!;
    const res = await picksFor(alex, `like=${inception.id}`);
    expect(res.like).toEqual({ id: inception.id, title: 'Inception' });
    const titles = res.picks.map((p) => p.movie.title);
    expect(titles).toContain('The Matrix');
    expect(titles).not.toContain('Inception');
    expect(titles).not.toContain('The Dark Knight'); // watched
    expect(res.picks[0]!.reasons.some((r) => r.kind === 'theme' || r.kind === 'keyword')).toBe(true);
  });

  it('favours Seerr requests for whoever made them, and labels them', async () => {
    const dune = (res: RecommendationsResponse) => res.picks.find((p) => p.movie.title === 'Dune: Part Two')!;
    // Few enough space movies that Dune is always among the picks, whatever the daily shuffle.
    const space = 'genre=Science%20Fiction&theme=space';
    const alex = await cookieFor('Alex');
    const sam = await cookieFor('Sam');
    expect(dune(await picksFor(alex, space)).reasons[0]).toEqual({
      kind: 'requested',
      label: 'You requested this',
    });
    expect(dune(await picksFor(sam, space)).reasons.some((r) => r.kind === 'requested')).toBe(false);

    const setBoost = (boostRequests: boolean) =>
      app.inject({ method: 'PUT', url: '/api/settings/app', headers: { cookie: alex }, payload: { boostRequests } });
    await setBoost(false);
    try {
      const off = dune(await picksFor(alex, space));
      expect(off.reasons.some((r) => r.kind === 'requested')).toBe(false);
    } finally {
      await setBoost(true);
    }
  });

  it('drops the request label once the movie is watched', async () => {
    const { store } = ctx;
    const alex = await cookieFor('Alex');
    const alexId = store.profileRows().find((p) => p.name === 'Alex')!.id;
    const dune = store.movies().find((m) => m.title === 'Dune: Part Two')!;
    const history = store.watchHistory(alexId);
    const setIncludeWatched = (includeWatched: boolean) =>
      app.inject({ method: 'PUT', url: '/api/settings/app', headers: { cookie: alex }, payload: { includeWatched } });

    // Watched in Plex, and still offered because watched movies are included.
    await setIncludeWatched(true);
    store.addWatched(alexId, dune.id);
    try {
      const picks = (await picksFor(alex, 'genre=Science%20Fiction&theme=space')).picks;
      const pick = picks.find((p) => p.movie.id === dune.id);
      expect(pick).toBeDefined();
      expect(pick!.reasons.some((r) => r.kind === 'requested')).toBe(false);
    } finally {
      store.replaceWatched(alexId, history, Date.now());
      await setIncludeWatched(false);
    }
  });

  it('goes straight to a pick from what just arrived, from a tile on the first question', async () => {
    const sam = await cookieFor('Sam');
    const genres = (await app.inject({ method: 'GET', url: '/api/wizard/genre', headers: { cookie: sam } })).json() as WizardOptionsResponse;
    expect(genres.shelves?.map((s) => [s.id, s.count])).toContainEqual(['new', 4]);
    const titles = (await picksFor(sam, 'shelf=new')).picks.map((p) => p.movie.title).sort();
    expect(titles).toEqual(['Dune: Part Two', 'Everything Everywhere All at Once', 'The Martian', 'Top Gun: Maverick']);
  });

  it("refuses a shortcut it doesn't know", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations?shelf=nope', headers: { cookie: await cookieFor('Sam') } });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an answer it doesn't offer, and takes no preference as none", async () => {
    for (const query of ['genre=Westerns', 'theme=nope', 'mood=nope', 'time=nope']) {
      expect((await get(`/api/recommendations?${query}`)).status, query).toBe(400);
      expect((await get(`/api/wizard/genre?${query}`)).status, query).toBe(400);
    }
    expect((await get('/api/recommendations?genre=any&theme=any&mood=any&time=any')).status).toBe(200);
  });

  it("leaves the liked movie's saga out", async () => {
    const alex = await cookieFor('Alex');
    const bttf = (await likeFor(alex, 'back to the future')).find((m) => m.title === 'Back to the Future')!;
    const titles = (await picksFor(alex, `like=${bttf.id}`)).picks.map((p) => p.movie.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.filter((t) => t.startsWith('Back to the Future'))).toEqual([]);
  });

  it('only starts from movies the profile may see', async () => {
    const godfather = (await likeFor(await cookieFor('Alex'), 'godfather'))[0]!;
    const kids = await cookieFor('Kids');
    expect(await likeFor(kids)).toEqual([]);
    expect(await likeFor(kids, 'godfather')).toEqual([]);
    const restricted = await app.inject({ method: 'GET', url: `/api/recommendations?like=${godfather.id}`, headers: { cookie: kids } });
    expect(restricted.statusCode).toBe(404);
    const unknown = await app.inject({ method: 'GET', url: '/api/recommendations?like=99999', headers: { cookie: kids } });
    expect(unknown.statusCode).toBe(404);
  });

  it('serves generated demo art', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/demo/art/1/poster.svg' });
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('KNIGHT');
  });
});

describe("a profile's parental limits in its marks and lists (demo data)", () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let ctx: Awaited<ReturnType<typeof buildApp>>['ctx'];
  const ids: Record<string, number> = {};
  const cookies: Record<string, string> = {};

  beforeEach(async () => {
    ({ app, ctx, close } = await tempApp('limits'));
    for (const p of (await app.inject({ method: 'GET', url: '/api/profiles' })).json() as Profile[]) {
      ids[p.name] = p.id;
      const res = await app.inject({ method: 'POST', url: `/api/profiles/${p.id}/select` });
      cookies[p.name] = cookieOf(res);
    }
  });

  afterEach(async () => {
    await close();
  });

  const movieId = (title: string) => ctx.store.movies().find((m) => m.title === title)!.id;
  const lists = async (name: string) => {
    const res = await app.inject({ method: 'GET', url: '/api/hidden', headers: { cookie: cookies[name]! } });
    return (res.json() as { kind: string; movie: { title: string } }[]).map((h) => `${h.kind} ${h.movie.title}`).sort();
  };

  it("won't mark a movie outside the profile's parental limits", async () => {
    // Kids may see G and PG; The Godfather is R.
    const godfather = movieId('The Godfather');
    for (const kind of ['shown', 'skipped', 'seen', 'never', 'accepted', 'later']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: cookies.Kids! },
        payload: { movieId: godfather, kind },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Movie not found');
    }
    expect(ctx.store.feedback(ids.Kids!).filter((e) => e.movieId === godfather)).toEqual([]);
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: cookies.Kids! },
      payload: { movieId: movieId('Finding Nemo'), kind: 'later' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('leaves movies outside its limits out of its lists, and its watchlist alone', async () => {
    // Marks and a media server watchlist from before the limit applied.
    ctx.store.addFeedback(ids.Kids!, movieId('Finding Nemo'), 'later');
    ctx.store.addFeedback(ids.Kids!, movieId('The Godfather'), 'never');
    ctx.store.addFeedback(ids.Kids!, movieId('Up'), 'seen');
    ctx.store.addToWatchlist(ids.Kids!, movieId('Alien'));
    ctx.store.addFeedback(ids.Alex!, movieId('The Godfather'), 'never');
    expect(await lists('Kids')).toEqual(['later Finding Nemo', 'seen Up']);
    expect(await lists('Alex')).toEqual(['never The Godfather']);

    const alien = movieId('Alien');
    const res = await app.inject({ method: 'DELETE', url: `/api/watchlist/${alien}`, headers: { cookie: cookies.Kids! } });
    expect(res.statusCode).toBe(404);
    expect(ctx.store.watchlistIds(ids.Kids!).has(alien)).toBe(true);
  });
});

describe('the web app', () => {
  let web: string;
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  const webDist = config.webDist;

  beforeAll(async () => {
    // A build in miniature: text files with brotli and gzip copies beside them, the service worker without.
    web = mkdtempSync(path.join(tmpdir(), 'curatorr-web-'));
    mkdirSync(path.join(web, 'assets'));
    const files: Record<string, string> = {
      'index.html': '<!doctype html><title>Curatorr</title>',
      'assets/index-abc.js': 'console.log("Curatorr")',
      'sw.js': 'self.skipWaiting()',
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(web, name), text);
    for (const name of ['index.html', 'assets/index-abc.js']) {
      writeFileSync(path.join(web, `${name}.br`), brotliCompressSync(files[name]!));
      writeFileSync(path.join(web, `${name}.gz`), gzipSync(files[name]!));
    }
    config.webDist = web;
    ({ app, close } = await tempApp('test'));
  });

  afterAll(async () => {
    config.webDist = webDist;
    await close();
    rmSync(web, { recursive: true, force: true });
  });

  const get = (url: string, encoding?: string) =>
    app.inject({ method: 'GET', url, headers: encoding ? { 'accept-encoding': encoding } : {} });

  it('sends the compressed copy a browser accepts, and says the answer depends on it', async () => {
    for (const [encoding, sent] of [['gzip, deflate, br', 'br'], ['gzip, deflate', 'gzip'], [undefined, undefined]]) {
      const res = await get('/assets/index-abc.js', encoding);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe(sent);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers.vary).toMatch(/accept-encoding/);
    }
  });

  it('keeps the page itself uncached, compressed or not, at any address in the app', async () => {
    for (const url of ['/', '/pick?genre=Drama']) {
      for (const [encoding, sent] of [['br', 'br'], [undefined, undefined]]) {
        const res = await get(url, encoding);
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-encoding']).toBe(sent);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.headers['cache-control']).toBe('no-cache');
      }
    }
  });

  it("lets only the app's own scripts run on its pages, and dashboards still frame them", async () => {
    for (const url of ['/', '/index.html', '/pick?genre=Drama']) {
      for (const encoding of ['br', undefined]) {
        const header = (await get(url, encoding)).headers['content-security-policy'];
        expect(header, url).toBeTypeOf('string');
        const policy = new Map(
          String(header)
            .split(';')
            .map((d) => d.trim().split(/\s+/))
            .map(([name, ...values]) => [name, values.join(' ')]),
        );
        expect(policy.get('script-src')).toBe("'self'");
        expect(policy.get('object-src')).toBe("'none'");
        expect(policy.get('base-uri')).toBe("'none'");
        expect(policy.get('connect-src')).toBe("'self'");
        // TMDB's pictures, and Plex's avatars.
        expect(policy.get('img-src')).toContain('https:');
        // Organizr and the like show Curatorr in a frame.
        expect(policy.has('frame-ancestors')).toBe(false);
      }
    }
    // Scripts and the service worker aren't pages.
    expect((await get('/sw.js')).headers['content-security-policy']).toBeUndefined();
    expect((await get('/assets/index-abc.js')).headers['content-security-policy']).toBeUndefined();
  });

  it('sends a file as it is when it has no compressed copy', async () => {
    const res = await get('/sw.js', 'gzip, deflate, br');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe('self.skipWaiting()');
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});
