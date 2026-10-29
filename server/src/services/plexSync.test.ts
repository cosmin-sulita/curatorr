import { createServer, type Server } from 'node:http';
import type { RecommendationsResponse } from '@curatorr/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { PLEX_HOSTS } from '../integrations/plex.js';
import type { RadarrMovie } from '../integrations/radarr.js';
import type { Store } from '../store.js';
import { syncServerState } from './mediaServer.js';
import { cookieOf, listen, silentLog, tempApp } from '../testing.js';

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
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let store: Store;
  const calls: Call[] = [];
  const watchlists = new Map<string, string[]>();
  /** While set, a Watchlist read gets the list as it was when asked, but only once `release` settles. */
  let watchlistHeld: { asked: () => void; release: Promise<void> } | null = null;
  /** Plex leaves the Watchlist's size out of its answers. */
  let watchlistSizeUnknown = false;
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
        const total = watchlistSizeUnknown ? {} : { totalSize: all.length };
        const body = { MediaContainer: { ...total, size: page.length, Metadata: page } };
        if (!watchlistHeld) return json(200, body);
        watchlistHeld.asked();
        return void watchlistHeld.release.then(() => json(200, body));
      }
      json(404, {});
    });
    const base = await listen(server);
    PLEX_HOSTS.discover = base;

    const built = await tempApp('plexsync', { demo: false });
    close = built.close;
    app = built.app;
    store = built.ctx.store;
    store.set('radarr', { url: base, apiKey: RADARR_KEY });
    store.update('plex', { adminToken: OWNER, machineId: 'machine', serverUrl: base, sectionIds: ['1'] });
    store.set('setupComplete', true);
    await built.ctx.library.run();

    // The owner's Watchlist already holds The Matrix, plus 150 movies that aren't in the library (paging).
    watchlists.set(OWNER, [...Array.from({ length: 150 }, (_, i) => `zz${i}`), 'aaa111']);

    await newProfile('Owner', OWNER, true);
    await newProfile('Member', MEMBER);
    await newProfile('Kid', KID);
  });

  afterAll(async () => {
    PLEX_HOSTS.discover = originalDiscover;
    await close();
    server.close();
  });

  beforeEach(() => {
    calls.length = 0;
    store.update('app', { syncToServer: true });
  });

  const profileId = (name: string) => store.profileRows(true).find((p) => p.name === name)!.id;
  /** A profile signed in to its own Plex account, picked on a device of its own. */
  async function newProfile(name: string, token: string, admin = false) {
    const id = store.createLocalProfile(name, admin);
    store.setProfileTokens(id, token, token);
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${id}/select`, payload: {} });
    cookies[name] = cookieOf(res);
    return id;
  }
  /** The Watchlist in Settings, in its order: each movie, with its mark's id (null when only Plex has it). */
  const watchlisted = async (who: string) =>
    ((await app.inject({ method: 'GET', url: '/api/hidden', headers: { cookie: cookies[who]! } })).json() as {
      id: number | null;
      kind: string;
      movie: { id: number };
    }[])
      .filter((h) => h.kind === 'later')
      .map((h) => ({ movieId: h.movie.id, id: h.id }));
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
  const unlist = async (who: string, movieId: number) =>
    (await app.inject({ method: 'DELETE', url: `/api/watchlist/${movieId}`, headers: { cookie: cookies[who]! } })).json() as {
      server?: string;
      onWatchlistOf?: number[];
    };

  it('reads each Watchlist, across pages, and favours those movies', async () => {
    expect([...store.watchlistIds(profileId('Owner'))]).toEqual([1]);
    const matrix = (await picks('Owner')).picks.find((p) => p.movie.id === 1)!;
    expect(matrix.reasons[0]).toEqual({ kind: 'watchlist', label: 'On your watchlist' });
    expect(matrix.onWatchlistOf).toEqual([profileId('Owner')]);
  });

  it('shows what is on the Plex Watchlist in Settings, before anything is saved in Curatorr', async () => {
    expect(await watchlisted('Owner')).toEqual([{ movieId: 1, id: null }]);
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

  it('takes a movie off the Plex Watchlist, also one added in Plex, and Watchlist puts it back', async () => {
    // The Matrix was on the owner's Plex Watchlist before Curatorr saw it.
    expect(await unlist('Owner', 1)).toEqual({ server: 'synced', onWatchlistOf: [] });
    expect(calls).toEqual([{ action: 'removeFromWatchlist', key: 'aaa111', token: OWNER }]);
    const matrix = (await picks('Owner')).picks.find((p) => p.movie.id === 1)!;
    expect(matrix.onWatchlistOf).toEqual([]);
    expect(matrix.reasons.map((r) => r.kind)).not.toContain('watchlist');

    expect((await mark('Owner', 1, 'later')).server).toBe('synced');
    expect(calls[1]).toEqual({ action: 'addToWatchlist', key: 'aaa111', token: OWNER });
  });

  it('leaves what was added in Plex on the Plex Watchlist when the owner turned syncing off', async () => {
    const member = profileId('Member');
    store.addToWatchlist(member, 1); // as read from the member's Plex Watchlist
    store.update('app', { syncToServer: false });
    try {
      expect(await unlist('Member', 1)).toEqual({ server: 'skipped', onWatchlistOf: [member] });
      expect(calls).toEqual([]);
    } finally {
      store.removeFromWatchlist(member, 1);
    }
  });

  it('only asks Plex to take off what is on the Plex Watchlist', async () => {
    store.update('app', { syncToServer: false });
    expect((await mark('Member', 1, 'later')).server).toBe('skipped'); // saved in Curatorr only
    store.update('app', { syncToServer: true });
    expect(await unlist('Member', 1)).toEqual({ server: 'skipped', onWatchlistOf: [] });
    expect(calls).toEqual([]);
  });

  it('takes what Curatorr added back off the Plex Watchlist, even with syncing off', async () => {
    expect((await mark('Member', 1, 'later')).server).toBe('synced');
    store.update('app', { syncToServer: false });
    expect(await unlist('Member', 1)).toEqual({ server: 'synced', onWatchlistOf: [] });
    expect(calls).toEqual([
      { action: 'addToWatchlist', key: 'aaa111', token: MEMBER },
      { action: 'removeFromWatchlist', key: 'aaa111', token: MEMBER },
    ]);
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

  it('lists the watchlist newest first, whether a movie went on it in Plex or in Curatorr', async () => {
    const id = await newProfile('Lists', 'lists-token');
    const minutesAgo = (n: number) => Date.now() - n * 60_000;
    store.addFeedback(id, 3, 'later', minutesAgo(3)); // Alien, saved in Curatorr
    store.replaceWatchlist(id, [2], minutesAgo(2)); // Heat, found on the Plex Watchlist
    store.addFeedback(id, 1, 'later', minutesAgo(1)); // The Matrix, saved in Curatorr
    store.replaceWatchlist(id, [2]); // read again: Heat has been there since it was first found
    expect((await watchlisted('Lists')).map((w) => w.movieId)).toEqual([1, 2, 3]);
  });

  it('takes a movie off the watchlist in Curatorr once it is taken off the Plex Watchlist in Plex', async () => {
    const id = await newProfile('Unlisted', 'unlisted-token');
    expect((await mark('Unlisted', 2, 'later')).server).toBe('synced'); // Heat, on the Plex Watchlist too
    watchlists.set('unlisted-token', []); // taken off in a Plex app
    await syncServerState(store, store.profileRow(id)!, silentLog, true);
    expect(await watchlisted('Unlisted')).toEqual([]);
    expect((await picks('Unlisted')).picks.find((p) => p.movie.id === 2)!.onWatchlistOf).toEqual([]);
  });

  it('keeps what was saved in Curatorr when the owner turned updating Plex off', async () => {
    const id = await newProfile('Kept', 'kept-token');
    expect((await mark('Kept', 2, 'later')).server).toBe('synced');
    store.update('app', { syncToServer: false });
    watchlists.set('kept-token', []);
    await syncServerState(store, store.profileRow(id)!, silentLog, true);
    expect((await watchlisted('Kept')).map((w) => w.movieId)).toEqual([2]);
  });

  it('keeps a movie saved in Curatorr while its Plex Watchlist was being read', async () => {
    const id = await newProfile('Racing', 'racing-token');
    let release!: () => void;
    const asked = new Promise<void>((resolve) => {
      watchlistHeld = { asked: resolve, release: new Promise<void>((r) => (release = r)) };
    });
    try {
      const read = syncServerState(store, store.profileRow(id)!, silentLog, true);
      await asked; // Plex has answered "nothing on it", but the answer is still on its way
      expect((await mark('Racing', 2, 'later')).server).toBe('synced');
      release();
      await read;
    } finally {
      watchlistHeld = null;
    }
    expect((await watchlisted('Racing')).map((w) => w.movieId)).toEqual([2]);
  });

  it('keeps a movie on the watchlist while its file is away from the library', async () => {
    const id = await newProfile('Away', 'away-token');
    expect((await mark('Away', 2, 'later')).server).toBe('synced'); // Heat, on the Plex Watchlist too
    const library = store.movies();
    store.replaceMovies(library.filter((m) => m.id !== 2), Date.now()); // Heat's file is being replaced, say
    try {
      await syncServerState(store, store.profileRow(id)!, silentLog, true);
    } finally {
      store.replaceMovies(library, Date.now());
    }
    expect(await watchlisted('Away')).toEqual([{ movieId: 2, id: expect.any(Number) }]);
  });

  it('reads every page of a Plex Watchlist, even when Plex leaves out its size', async () => {
    const id = await newProfile('Long', 'long-token');
    watchlists.set('long-token', [...Array.from({ length: 150 }, (_, i) => `zz${i}`), 'aaa111']);
    watchlistSizeUnknown = true;
    try {
      await syncServerState(store, store.profileRow(id)!, silentLog, true);
    } finally {
      watchlistSizeUnknown = false;
    }
    expect([...store.watchlistIds(id)]).toEqual([1]);
  });
});
