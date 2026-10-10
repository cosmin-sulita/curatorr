import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RecommendationsResponse } from '@curatorr/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { PLEX_HOSTS } from '../integrations/plex.js';
import type { RadarrMovie } from '../integrations/radarr.js';
import type { Store } from '../store.js';

const RADARR_KEY = 'radarr-key';
const OWNER = 'owner-token';
const MEMBER = 'member-token';
const KID = 'kid-token'; // a managed user without a Watchlist

const radarrMovies: RadarrMovie[] = [
  { id: 1, title: 'The Matrix', tmdbId: 603, hasFile: true, genres: ['Action'], ratings: { rottenTomatoes: { value: 83 } } },
  { id: 2, title: 'Heat', tmdbId: 949, hasFile: true, genres: ['Crime'], ratings: { rottenTomatoes: { value: 88 } } },
  { id: 3, title: 'Alien', tmdbId: 348, imdbId: 'tt0078748', hasFile: true, genres: ['Horror'] },
];

/** Library items; `viewedBy` lists the tokens whose user has watched it. */
const library = [
  { ratingKey: '101', title: 'The Matrix', guid: 'plex://movie/aaa111', Guid: [{ id: 'tmdb://603' }], viewedBy: [] as string[] },
  { ratingKey: '102', title: 'Heat', guid: 'plex://movie/bbb222', Guid: [{ id: 'tmdb://949' }], viewedBy: [OWNER] },
  { ratingKey: '103', title: 'Alien', guid: 'com.plexapp.agents.imdb://tt0078748?lang=en', viewedBy: [KID] },
];

interface Call {
  action: string;
  key: string | null;
  token: string | undefined;
}

describe('two-way Plex sync over the API', () => {
  let server: Server;
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let store: Store;
  const calls: Call[] = [];
  const watchlists = new Map<string, string[]>();
  const originalDiscover = PLEX_HOSTS.discover;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const token = req.headers['x-plex-token'] as string | undefined;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/api/v3/movie') return json(200, radarrMovies);

      // Plex Media Server
      if (url.pathname === '/library/sections/1/all') {
        return json(200, {
          MediaContainer: {
            Metadata: library.map(({ viewedBy, ...m }) => ({ ...m, viewCount: viewedBy.includes(token!) ? 1 : 0 })),
          },
        });
      }
      if (url.pathname === '/:/scrobble' || url.pathname === '/:/unscrobble') {
        calls.push({ action: url.pathname.slice(3), key: url.searchParams.get('key'), token });
        return json(200, {});
      }

      // Plex Discover (Watchlist)
      if (url.pathname.startsWith('/actions/') && req.method === 'PUT') {
        const action = url.pathname.slice('/actions/'.length);
        const key = url.searchParams.get('ratingKey')!;
        calls.push({ action, key, token });
        const list = watchlists.get(token!) ?? [];
        watchlists.set(token!, action === 'addToWatchlist' ? [...list, key] : list.filter((k) => k !== key));
        return json(200, {});
      }
      if (url.pathname === '/library/sections/watchlist/all') {
        if (token === KID) return json(403, { error: 'not allowed' });
        const all = watchlists.get(token!) ?? [];
        const start = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0);
        const size = Number(url.searchParams.get('X-Plex-Container-Size') ?? 20);
        const page = all.slice(start, start + size).map((id) => ({ guid: `plex://movie/${id}`, ratingKey: id }));
        return json(200, { MediaContainer: { totalSize: all.length, size: page.length, Metadata: page } });
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    PLEX_HOSTS.discover = base;

    dir = mkdtempSync(path.join(tmpdir(), 'curatorr-plexsync-'));
    const built = await buildApp({ configDir: dir, demo: false, logger: false });
    app = built.app;
    store = built.ctx.store;
    store.set('radarr', { url: base, apiKey: RADARR_KEY });
    store.update('plex', { adminToken: OWNER, machineId: 'machine', serverUrl: base, sectionIds: ['1'] });
    store.set('setupComplete', true);
    await built.ctx.library.run();

    // The owner's Watchlist already holds The Matrix, plus 150 movies that aren't in the library (paging).
    watchlists.set(OWNER, [...Array.from({ length: 150 }, (_, i) => `zz${i}`), 'aaa111']);

    for (const [name, token, admin] of [['Owner', OWNER, true], ['Member', MEMBER, false], ['Kid', KID, false]] as const) {
      const id = store.createLocalProfile(name, admin);
      store.setProfileTokens(id, token, token);
      const res = await app.inject({ method: 'POST', url: `/api/profiles/${id}/select`, payload: {} });
      cookies[name] = String(res.headers['set-cookie']).split(';')[0]!;
    }
  });

  afterAll(async () => {
    PLEX_HOSTS.discover = originalDiscover;
    await app.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    calls.length = 0;
    store.update('app', { syncToServer: true });
  });

  const profileId = (name: string) => store.profileRows(true).find((p) => p.name === name)!.id;
  const mark = async (who: string, movieId: number, kind: string) =>
    (await app.inject({ method: 'POST', url: '/api/feedback', headers: { cookie: cookies[who]! }, payload: { movieId, kind } })).json() as {
      id: number;
      server?: string;
    };
  const undo = async (who: string, id: number) =>
    (await app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie: cookies[who]! } })).json() as {
      server?: string;
    };
  const picks = async (who: string) =>
    (await app.inject({ method: 'GET', url: '/api/recommendations', headers: { cookie: cookies[who]! } })).json() as RecommendationsResponse;

  it('reads each Watchlist, across pages, and favours those movies', async () => {
    expect([...store.watchlistIds(profileId('Owner'))]).toEqual([1]);
    const matrix = (await picks('Owner')).picks.find((p) => p.movie.id === 1)!;
    expect(matrix.reasons[0]).toEqual({ kind: 'watchlist', label: 'On your watchlist' });
  });

  it('a Watchlist error does not stop the watch history from syncing', () => {
    expect([...store.watchedIds(profileId('Kid'))]).toEqual([3]);
    expect(store.watchlistIds(profileId('Kid')).size).toBe(0);
  });

  it('"Seen it" marks the movie watched in Plex for that person, and Undo reverts it', async () => {
    const { id, server } = await mark('Member', 2, 'seen');
    expect(server).toBe('synced');
    expect(calls).toEqual([{ action: 'scrobble', key: '102', token: MEMBER }]);
    expect(store.watchedIds(profileId('Member')).has(2)).toBe(true);

    expect((await undo('Member', id)).server).toBe('synced');
    expect(calls[1]).toEqual({ action: 'unscrobble', key: '102', token: MEMBER });
    expect(store.watchedIds(profileId('Member')).has(2)).toBe(false);
  });

  it('leaves Plex alone for a movie that was already watched', async () => {
    const { id, server } = await mark('Owner', 2, 'seen'); // the owner watched Heat in Plex
    expect(server).toBe('already');
    expect((await undo('Owner', id)).server).toBe('skipped');
    expect(calls).toEqual([]);
    expect(store.watchedIds(profileId('Owner')).has(2)).toBe(true);
  });

  it('"Later" adds to the Plex Watchlist, boosts the movie, and Undo removes it', async () => {
    const { id, server } = await mark('Member', 2, 'later');
    expect(server).toBe('synced');
    expect(calls).toEqual([{ action: 'addToWatchlist', key: 'bbb222', token: MEMBER }]);
    const heat = (await picks('Member')).picks.find((p) => p.movie.id === 2)!;
    expect(heat.reasons.map((r) => r.kind)).toContain('watchlist');

    expect((await undo('Member', id)).server).toBe('synced');
    expect(calls[1]).toEqual({ action: 'removeFromWatchlist', key: 'bbb222', token: MEMBER });
    expect(watchlists.get(MEMBER)).toEqual([]);
  });

  it('keeps "Later" in Curatorr for movies Plex Discover does not know', async () => {
    const { id, server } = await mark('Member', 3, 'later'); // Alien: legacy agent, no Plex guid
    expect(server).toBe('skipped');
    expect(calls).toEqual([]);
    const alien = (await picks('Member')).picks.find((p) => p.movie.id === 3)!;
    expect(alien.reasons.map((r) => r.kind)).toContain('watchlist');
    await undo('Member', id);
  });

  it('sends nothing to Plex when the owner turned syncing off', async () => {
    store.update('app', { syncToServer: false });
    const seen = await mark('Member', 1, 'seen');
    const later = await mark('Member', 2, 'later');
    expect([seen.server, later.server]).toEqual(['skipped', 'skipped']);
    expect(calls).toEqual([]);
    await undo('Member', seen.id);
    await undo('Member', later.id);
  });

  it('lists "Later" alongside hidden movies, once per movie', async () => {
    await mark('Member', 2, 'later');
    await mark('Member', 2, 'later');
    const marked = (await app.inject({ method: 'GET', url: '/api/hidden', headers: { cookie: cookies.Member! } })).json() as {
      kind: string;
      movie: { id: number };
    }[];
    expect(marked.filter((m) => m.movie.id === 2 && m.kind === 'later')).toHaveLength(1);
  });
});
