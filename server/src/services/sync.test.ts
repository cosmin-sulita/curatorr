import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, type DB } from '../db.js';
import { fromRadarr, type RadarrMovie } from '../integrations/radarr.js';
import type { SeerrRequest, SeerrUser } from '../integrations/seerr.js';
import { Store } from '../store.js';
import { LibrarySync } from './library.js';
import { syncPlexState } from './profiles.js';
import { ensurePlexIds, toDTO } from './recommend.js';

const RADARR_KEY = 'radarr-key';
const OWNER_TOKEN = 'owner-token';
const MEMBER_TOKEN = 'member-token';

const radarrMovies: RadarrMovie[] = [
  {
    id: 1,
    title: 'The Matrix',
    year: 1999,
    tmdbId: 603,
    imdbId: 'tt0133093',
    hasFile: true,
    genres: ['Action', 'Science Fiction'],
    keywords: ['simulated reality', 'artificial intelligence (a.i.)', 'hacker'],
    ratings: { rottenTomatoes: { value: 83 }, imdb: { value: 8.7 } },
    collection: { title: 'The Matrix Collection', tmdbId: 2344 },
  },
  {
    id: 2,
    title: 'Heat',
    year: 1995,
    tmdbId: 949,
    imdbId: 'tt0113277',
    hasFile: true,
    genres: ['Crime', 'Drama', 'Action'],
    keywords: ['heist', 'bank robbery'],
    ratings: { rottenTomatoes: { value: 88 } },
    // Requested in Seerr (so added to Radarr) weeks before its file arrived.
    added: '2026-03-01T10:00:05Z',
    movieFile: { dateAdded: '2026-04-20T08:00:00Z' },
  },
  { id: 3, title: 'Wanted, not downloaded', tmdbId: 1, hasFile: false, genres: ['Action'] },
  // Only matchable by IMDb id (legacy Plex agent).
  { id: 4, title: 'Alien', year: 1979, tmdbId: 348, imdbId: 'tt0078748', hasFile: true, genres: ['Horror'] },
];

// What each Plex user sees in the movie library: same items, different watch state.
// The Matrix carries its slug in the listing; Heat only in its full metadata; Alien
// (legacy agent) has none at all.
const plexItems = (token: string | undefined) => [
  {
    ratingKey: '101',
    title: 'The Matrix',
    slug: 'the-matrix',
    viewCount: token === MEMBER_TOKEN ? 1 : 0,
    lastViewedAt: 1_700_000_000,
    Guid: [{ id: 'imdb://tt0133093' }, { id: 'tmdb://603' }],
  },
  { ratingKey: '102', title: 'Heat', viewCount: token === OWNER_TOKEN ? 3 : 0, Guid: [{ id: 'tmdb://949' }] },
  { ratingKey: '103', title: 'Alien', guid: 'com.plexapp.agents.imdb://tt0078748?lang=en' },
];
const plexMetadata: Record<string, object> = {
  '102': { ratingKey: '102', title: 'Heat', slug: 'heat', Guid: [{ id: 'tmdb://949' }] },
  '103': { ratingKey: '103', title: 'Alien', guid: 'com.plexapp.agents.imdb://tt0078748?lang=en' },
};
const metadataLookups: string[] = [];
let libraryFetches = 0;

const SEERR_KEY = 'seerr-key';
const OWNER_PLEX_ID = 5001;
const MEMBER_PLEX_ID = 5002;
const seerrUsers: SeerrUser[] = [
  { id: 1, plexId: OWNER_PLEX_ID, displayName: 'owner' },
  { id: 2, plexId: MEMBER_PLEX_ID, displayName: 'member' },
  { id: 3, plexId: null, displayName: 'local' },
];
// Like older Seerr versions, the fake ignores mediaType=movie: the TV requests fill the first
// page, so the real ones are only found by paging.
const seerrRequests: SeerrRequest[] = [
  ...Array.from({ length: 150 }, (_, i): SeerrRequest => ({
    id: 100 + i,
    status: 5,
    type: 'tv',
    media: { tmdbId: 10_000 + i, mediaType: 'tv' },
    requestedBy: { id: 3 },
  })),
  { id: 1, status: 5, type: 'movie', createdAt: '2026-03-01T10:00:00Z', media: { tmdbId: 949 }, requestedBy: { id: 1 } },
  { id: 2, status: 2, type: 'movie', media: { tmdbId: 603 }, requestedBy: { id: 2, plexId: MEMBER_PLEX_ID } },
  { id: 3, status: 3, type: 'movie', media: { tmdbId: 348 }, requestedBy: { id: 1 } }, // declined
  { id: 4, status: 5, type: 'tv', media: { tmdbId: 348, mediaType: 'tv' }, requestedBy: { id: 2 } }, // a show, same TMDB id as Alien
  { id: 5, status: 1, type: 'movie', media: { tmdbId: 1 }, requestedBy: { id: 1 } }, // not downloaded yet
  { id: 6, status: 5, type: 'movie', media: { tmdbId: 949 }, requestedBy: { id: 3 } }, // no Plex account
];

describe('library sync against fake Radarr and Plex servers', () => {
  let server: Server;
  let base: string;
  let dir: string;
  let store: Store;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/api/v3/movie') {
        return req.headers['x-api-key'] === RADARR_KEY ? json(200, radarrMovies) : json(401, { error: 'nope' });
      }
      if (url.pathname === '/api/v3/collection') {
        return json(200, [
          {
            tmdbId: 2344,
            title: 'The Matrix Collection',
            movies: [
              { tmdbId: 604, title: 'The Matrix Reloaded', year: 2003 },
              { tmdbId: 603, title: 'The Matrix', year: 1999 },
              { tmdbId: 605, title: 'The Matrix Revolutions', year: 2003 },
            ],
          },
        ]);
      }
      if (url.pathname === '/library/sections/1/all') {
        const token = req.headers['x-plex-token'] as string | undefined;
        if (token !== OWNER_TOKEN && token !== MEMBER_TOKEN) return json(401, {});
        libraryFetches++;
        return json(200, { MediaContainer: { Metadata: plexItems(token) } });
      }
      // A library the owner keeps to themselves: Plex refuses it to the others at home.
      if (url.pathname === '/library/sections/2/all') {
        const token = req.headers['x-plex-token'] as string | undefined;
        if (token === OWNER_TOKEN) return json(200, { MediaContainer: { Metadata: [] } });
        return json(token === MEMBER_TOKEN ? 403 : 401, {});
      }
      if (url.pathname.startsWith('/api/v1/')) {
        if (req.headers['x-api-key'] !== SEERR_KEY) return json(401, { message: 'Unauthorized' });
        const page = (all: unknown[]) => {
          const skip = Number(url.searchParams.get('skip') ?? 0);
          const take = Number(url.searchParams.get('take') ?? 10);
          return json(200, { pageInfo: { results: all.length }, results: all.slice(skip, skip + take) });
        };
        if (url.pathname === '/api/v1/auth/me') return json(200, seerrUsers[0]);
        if (url.pathname === '/api/v1/user') return page(seerrUsers);
        if (url.pathname === '/api/v1/request') return page(seerrRequests);
      }
      const item = /^\/library\/metadata\/(\d+)$/.exec(url.pathname);
      if (item && plexMetadata[item[1]!] && req.headers['x-plex-token'] === OWNER_TOKEN) {
        metadataLookups.push(item[1]!);
        return json(200, { MediaContainer: { Metadata: [plexMetadata[item[1]!]] } });
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    dir = mkdtempSync(path.join(tmpdir(), 'curatorr-sync-'));
    store = new Store(openDb(dir));
    store.set('radarr', { url: base, apiKey: RADARR_KEY });
    store.update('plex', { adminToken: OWNER_TOKEN, machineId: 'machine', serverUrl: base, sectionIds: ['1'] });
    store.set('setupComplete', true);
  });

  afterAll(() => {
    server.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

  it('keeps downloaded movies, tags them and links them to Plex', async () => {
    await new LibrarySync(store, silent).run();
    const movies = store.movies();
    expect(movies.map((m) => m.title)).toEqual(['Alien', 'Heat', 'The Matrix']);
    expect(movies.map((m) => m.plexRatingKey)).toEqual(['103', '102', '101']);
    expect(store.movie(2)!.themes).toHaveProperty('heist');
    expect(store.movie(1)!.ratings.rt).toBe(83);
    expect(store.get('sync')).toMatchObject({ movies: 3, matched: 3, error: null });
    expect(movies.map((m) => m.plexSlug)).toEqual([null, null, 'the-matrix']);
    expect(store.movie(1)!.saga).toEqual({ id: 2344, title: 'The Matrix', part: 1, parts: 3 });
    expect(store.movie(2)!.saga).toBeNull();
    expect(store.movie(2)!.arrivedAt).toBe('2026-04-20T08:00:00.000Z');
    expect(store.movie(1)!.arrivedAt).toBeNull();
  });

  it('looks up missing watch.plex.tv slugs once, and links phones to them', async () => {
    await ensurePlexIds(store, store.movies());
    await ensurePlexIds(store, store.movies());
    expect(metadataLookups.sort()).toEqual(['102', '103']);
    expect(store.movie(2)!.plexSlug).toBe('heat');
    expect(store.movie(4)!.plexSlug).toBe(''); // legacy agent: Plex has none

    expect(toDTO(store, store.movie(2)!).watchAppUrl).toBe('https://watch.plex.tv/movie/heat');
    expect(toDTO(store, store.movie(4)!).watchAppUrl).toMatch(/^plex:\/\/preplay\//);
    expect(toDTO(store, store.movie(4)!).watchUrl).toContain('app.plex.tv/desktop/#!/server/machine/details');
  });

  it('keeps looked-up slugs when the library syncs again', async () => {
    await new LibrarySync(store, silent).run();
    expect(store.movie(2)!.plexSlug).toBe('heat');
    expect(store.movie(1)!.plexSlug).toBe('the-matrix');
  });

  it("keeps the tags of movies that didn't change, and tags again the one that did", async () => {
    // Tags only a change to a movie's genres, keywords, plot or runtime should redo.
    store.updateTags([1, 2].map((id) => ({ id, themes: { kept: 4 }, moods: {} })));
    const heat = radarrMovies[1]!;
    const keywords = heat.keywords;
    heat.keywords = [...keywords!, 'los angeles'];
    try {
      await new LibrarySync(store, silent).run();
      expect(store.movie(1)!.themes).toEqual({ kept: 4 });
      expect(store.movie(2)!.themes).toHaveProperty('heist');
    } finally {
      heat.keywords = keywords;
      new LibrarySync(store, silent).retag();
    }
  });

  it('keeps the first arrival when an upgrade replaces the file', async () => {
    const [matrix, heat] = radarrMovies;
    heat!.movieFile = { dateAdded: '2026-06-01T08:00:00Z' }; // a better copy
    matrix!.movieFile = { dateAdded: '2026-05-05T00:00:00Z' }; // a date Radarr didn't send before
    try {
      await new LibrarySync(store, silent).run();
      expect(store.movie(2)!.arrivedAt).toBe('2026-04-20T08:00:00.000Z');
      expect(store.movie(1)!.arrivedAt).toBe('2026-05-05T00:00:00.000Z');
    } finally {
      heat!.movieFile = { dateAdded: '2026-04-20T08:00:00Z' };
      delete matrix!.movieFile;
    }
  });

  it('reads each profile’s own watch history', async () => {
    const owner = store.profileRow(store.createLocalProfile('Owner', true))!;
    const member = store.profileRow(store.createLocalProfile('Member', false))!;
    store.setProfileTokens(owner.id, OWNER_TOKEN, OWNER_TOKEN);
    store.setProfileTokens(member.id, MEMBER_TOKEN, MEMBER_TOKEN);

    await syncPlexState(store, store.profileRow(owner.id)!, silent);
    await syncPlexState(store, store.profileRow(member.id)!, silent);

    expect([...store.watchedIds(owner.id)]).toEqual([2]);
    expect([...store.watchedIds(member.id)]).toEqual([1]);
  });

  it('reads a member’s history from the libraries shared with them', async () => {
    const member = store.profileRow(store.createLocalProfile('Not shared', false))!;
    store.setProfileTokens(member.id, MEMBER_TOKEN, MEMBER_TOKEN);
    store.update('plex', { sectionIds: ['1', '2'] });
    try {
      await syncPlexState(store, store.profileRow(member.id)!, silent);
      expect([...store.watchedIds(member.id)]).toEqual([1]);
      // The owner sees every library, so a refusal there is a real failure.
      await new LibrarySync(store, silent).run();
      expect(store.get('sync').error).toBeNull();
    } finally {
      store.update('plex', { sectionIds: ['1'] });
    }
  });

  it('shares one Plex fetch between overlapping syncs, then waits until the history is stale', async () => {
    const id = store.createLocalProfile('Overlap', false);
    store.setProfileTokens(id, MEMBER_TOKEN, MEMBER_TOKEN);
    const row = store.profileRow(id)!;
    const before = libraryFetches;

    await Promise.all([syncPlexState(store, row, silent), syncPlexState(store, row, silent)]);
    expect(libraryFetches - before).toBe(1);
    expect([...store.watchedIds(id)]).toEqual([1]);

    await syncPlexState(store, store.profileRow(id)!, silent);
    expect(libraryFetches - before).toBe(1);
  });

  it('fills settings added by newer versions into settings saved by older ones', () => {
    // As saved by 0.2.x, before syncToPlex (now syncToServer) existed.
    store.set('app', { includeWatched: true, syncIntervalHours: 3 } as never);
    expect(store.get('app')).toEqual({ includeWatched: true, syncIntervalHours: 3, syncToServer: true, boostRequests: true });
  });

  const plexProfile = (plexUserId: number, name: string) =>
    store.upsertPlexProfile({
      plexUserId,
      plexUuid: null,
      name,
      avatarUrl: null,
      isAdmin: plexUserId === OWNER_PLEX_ID,
      restrictionProfile: null,
      pinProtected: false,
    });

  it('reads Seerr requests and pairs them with Plex profiles and library movies', async () => {
    const owner = plexProfile(OWNER_PLEX_ID, 'Plex owner');
    const member = plexProfile(MEMBER_PLEX_ID, 'Plex member');
    store.set('seerr', { url: base, apiKey: SEERR_KEY });
    await new LibrarySync(store, silent).run();

    // Heat; not the declined Alien, nor the movie that isn't downloaded yet.
    expect([...store.requestedIds(owner)]).toEqual([2]);
    // The Matrix; not the show that shares Alien's TMDB id.
    expect([...store.requestedIds(member)]).toEqual([1]);
    expect(store.get('seerrSync')).toMatchObject({ requests: 2, profiles: 2, error: null });
  });

  it('keeps the last requests when Seerr fails, without failing the library sync', async () => {
    store.set('seerr', { url: base, apiKey: 'wrong' });
    await new LibrarySync(store, silent).run();
    expect(store.get('seerrSync').error).toMatch(/Seerr: unauthorized/);
    expect(store.get('sync').error).toBeNull();
    expect([...store.requestedIds(plexProfile(OWNER_PLEX_ID, 'Plex owner'))]).toEqual([2]);
    store.set('seerr', null);
  });

  it('records a failed sync without losing the library', async () => {
    store.set('radarr', { url: base, apiKey: 'wrong' });
    await expect(new LibrarySync(store, silent).run()).rejects.toThrow(/unauthorized/);
    expect(store.get('sync').error).toMatch(/Radarr: unauthorized/);
    expect(store.movies()).toHaveLength(3);
  });
});

describe('tagging a movie from Radarr', () => {
  const heat = radarrMovies[1]!;
  const stored = { ...fromRadarr(heat), themes: { kept: 4 }, moods: { kept: 2 } };

  it('reuses its stored tags while its genres, keywords, plot and runtime are as stored', () => {
    expect(fromRadarr(heat, stored)).toMatchObject({ themes: { kept: 4 }, moods: { kept: 2 } });
    // Radarr's capitals don't matter: keywords are kept in lowercase.
    expect(fromRadarr({ ...heat, keywords: ['Heist', 'Bank Robbery'] }, stored).themes).toEqual({ kept: 4 });
  });

  it('tags it again once any of them changed', () => {
    const changes: Partial<RadarrMovie>[] = [
      { genres: ['Crime', 'Drama'] },
      { keywords: ['heist', 'bank robbery', 'los angeles'] },
      { overview: 'A crew plans one last job.' },
      { runtime: 170 },
    ];
    for (const change of changes) expect(fromRadarr({ ...heat, ...change }, stored).themes).toHaveProperty('heist');
  });
});

describe('re-tagging the stored library', () => {
  it('applies the current vocabulary at startup, without waiting for a sync', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-retag-'));
    const store = new Store(openDb(dir));
    const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;
    // Heat, as tagged by a vocabulary that matched "cat" inside "cat and mouse".
    store.replaceMovies([{ ...fromRadarr(radarrMovies[1]!), themes: { animals: 2, heist: 4 } }], Date.now());

    const library = new LibrarySync(store, silent);
    expect(library.retag()).toBe(1);
    expect(store.movie(2)!.themes).toEqual({ heist: 4 });
    expect(library.retag()).toBe(0);

    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('a database from an older version', () => {
  /**
   * Takes a new database back to version 6: v7 only renamed settings, v8 added Jellyfin, v9 watching together and
   * v10 dated the watchlist.
   */
  const backToVersion6 = (db: DB) =>
    db.exec(`
      ALTER TABLE watchlist DROP COLUMN added_at;
      DROP TABLE together;
      DROP TABLE available;
      DROP INDEX profiles_jellyfin_user;
      ALTER TABLE profiles DROP COLUMN jellyfin_user_id;
      ALTER TABLE movies DROP COLUMN jellyfin_id;
      PRAGMA user_version = 6;
    `);

  it('gains arrival dates and reads the library again on the next start', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-migrate-'));
    // As version 5 left it: no arrival dates, and a recent sync that wouldn't be repeated for hours.
    const old = openDb(dir);
    backToVersion6(old);
    old.exec('ALTER TABLE movies DROP COLUMN arrived_at; PRAGMA user_version = 5');
    new Store(old).set('sync', { at: Date.now(), movies: 1, matched: 0, error: null });
    old.close();

    const store = new Store(openDb(dir));
    expect(store.get('sync').at).toBeNull();
    store.replaceMovies([fromRadarr({ ...radarrMovies[1]!, movieFile: { dateAdded: '2026-04-20T08:00:00Z' } })], Date.now());
    expect(store.movie(2)!.arrivedAt).toBe('2026-04-20T08:00:00.000Z');

    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the owner's settings that were named after Plex, under names that cover any media server", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-migrate-'));
    // As version 6 saved them, with syncing to Plex turned off.
    const old = openDb(dir);
    backToVersion6(old);
    const save = old.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    save.run('app', JSON.stringify({ includeWatched: false, syncIntervalHours: 6, syncToPlex: false, boostRequests: true }));
    save.run('sync', JSON.stringify({ at: 1, movies: 20, matchedInPlex: 12, error: null }));
    old.close();

    const store = new Store(openDb(dir));
    expect(store.get('app')).toEqual({ includeWatched: false, syncIntervalHours: 6, syncToServer: false, boostRequests: true });
    expect(store.get('sync')).toEqual({ at: 1, movies: 20, matched: 12, error: null });
    // And it has room for Jellyfin.
    store.replaceMovies([{ ...fromRadarr(radarrMovies[1]!), jellyfinId: 'item-2' }], Date.now());
    expect(store.movie(2)!.jellyfinId).toBe('item-2');

    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the scheduler's check", () => {
  const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const MINUTE = 60_000;
  const cleanups: (() => void)[] = [];
  afterAll(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  /** Just synced, with The Matrix on Plex and Heat, whose file arrived `ago` ms before, there or not. */
  function justSynced({ ago, heatOnPlex, matrixOnPlex = true }: { ago: number; heatOnPlex: boolean; matrixOnPlex?: boolean }) {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-due-'));
    const store = new Store(openDb(dir));
    cleanups.push(() => {
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    store.update('plex', { adminToken: OWNER_TOKEN, machineId: 'machine', serverUrl: 'http://127.0.0.1:9', sectionIds: ['1'] });
    store.set('setupComplete', true);
    const now = Date.now();
    const onPlex = (yes: boolean, key: string) => (yes ? { plexRatingKey: key, plexGuid: `guid-${key}` } : {});
    store.replaceMovies(
      [
        { ...fromRadarr(radarrMovies[0]!), ...onPlex(matrixOnPlex, '101') },
        { ...fromRadarr(radarrMovies[1]!), arrivedAt: new Date(now - ago).toISOString(), ...onPlex(heatOnPlex, '102') },
      ],
      now,
    );
    store.set('sync', { at: now, movies: 2, matched: 1, error: null });
    return { library: new LibrarySync(store, silent), store, now };
  }

  it('syncs again while a movie that just arrived is missing from Plex', () => {
    const { library, now } = justSynced({ ago: 10 * MINUTE, heatOnPlex: false });
    expect(library.syncDue(now)).toBe(true);
  });

  it('waits for the interval once Plex has the new movie', () => {
    const { library, now } = justSynced({ ago: 10 * MINUTE, heatOnPlex: true });
    expect(library.syncDue(now)).toBe(false);
  });

  it('stops waiting for Plex an hour after the movie arrived', () => {
    const { library, now } = justSynced({ ago: 61 * MINUTE, heatOnPlex: false });
    expect(library.syncDue(now)).toBe(false);
  });

  it("doesn't wait for Plex when no movie is found there at all", () => {
    const { library, now } = justSynced({ ago: 10 * MINUTE, heatOnPlex: false, matrixOnPlex: false });
    expect(library.syncDue(now)).toBe(false);
  });

  it('syncs once the interval has passed', () => {
    const { library, store, now } = justSynced({ ago: 10 * MINUTE, heatOnPlex: true });
    store.update('sync', { at: now - 6 * 60 * MINUTE });
    expect(library.syncDue(now)).toBe(true);
  });
});

describe('sync requests while a sync is under way', () => {
  let radarr: Server;
  let base: string;
  /** The Radarr addresses whose movies were read, in order; the old one answers slowly. */
  const reads: string[] = [];
  const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

  beforeAll(async () => {
    radarr = createServer(async (req, res) => {
      const [prefix, rest] = req.url!.split('/api/v3/');
      if (rest === 'movie') {
        reads.push(prefix!);
        if (prefix === '/old') await new Promise((resolve) => setTimeout(resolve, 200));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
    });
    await new Promise<void>((resolve) => radarr.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(radarr.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    radarr.close();
  });

  function slowSync() {
    reads.length = 0;
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-sync-'));
    const store = new Store(openDb(dir));
    store.set('radarr', { url: `${base}/old`, apiKey: 'k' });
    store.set('setupComplete', true);
    const library = new LibrarySync(store, silent);
    const first = library.run();
    const done = async () => {
      await vi.waitFor(() => expect(library.syncing).toBe(false));
      library.stop();
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    };
    return { store, library, first, done };
  }

  it('syncs again afterwards, so a new Radarr address is read straight away', async () => {
    const { store, library, first, done } = slowSync();
    store.set('radarr', { url: `${base}/new`, apiKey: 'k' }); // what saving it in Settings does
    library.trigger();
    await first;
    await vi.waitFor(() => expect(reads).toEqual(['/old', '/new']));
    await done();
  });

  it("doesn't queue another sync from the scheduler's check", async () => {
    const { library, first, done } = slowSync();
    library.schedule(); // checks at once: no sync yet, so one is due
    await first;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reads).toEqual(['/old']);
    await done();
  });
});
