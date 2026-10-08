import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import type { RadarrMovie } from '../integrations/radarr.js';
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
        return json(200, { MediaContainer: { Metadata: plexItems(token) } });
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
    expect(store.get('sync')).toMatchObject({ movies: 3, matchedInPlex: 3, error: null });
    expect(movies.map((m) => m.plexSlug)).toEqual([null, null, 'the-matrix']);
    expect(store.movie(1)!.saga).toEqual({ id: 2344, title: 'The Matrix', part: 1, parts: 3 });
    expect(store.movie(2)!.saga).toBeNull();
  });

  it('looks up missing watch.plex.tv slugs once, and links phones to them', async () => {
    await ensurePlexIds(store, store.movies());
    await ensurePlexIds(store, store.movies());
    expect(metadataLookups.sort()).toEqual(['102', '103']);
    expect(store.movie(2)!.plexSlug).toBe('heat');
    expect(store.movie(4)!.plexSlug).toBe(''); // legacy agent: Plex has none

    expect(toDTO(store, store.movie(2)!).plexAppUrl).toBe('https://watch.plex.tv/movie/heat');
    expect(toDTO(store, store.movie(4)!).plexAppUrl).toMatch(/^plex:\/\/preplay\//);
    expect(toDTO(store, store.movie(4)!).plexUrl).toContain('app.plex.tv/desktop/#!/server/machine/details');
  });

  it('keeps looked-up slugs when the library syncs again', async () => {
    await new LibrarySync(store, silent).run();
    expect(store.movie(2)!.plexSlug).toBe('heat');
    expect(store.movie(1)!.plexSlug).toBe('the-matrix');
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

  it('fills settings added by newer versions into settings saved by older ones', () => {
    // As saved by 0.2.x, before syncToPlex existed.
    store.set('app', { includeWatched: true, syncIntervalHours: 3 } as never);
    expect(store.get('app')).toEqual({ includeWatched: true, syncIntervalHours: 3, syncToPlex: true, boostRequests: true });
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
