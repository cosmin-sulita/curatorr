import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { Store, type StoredMovie } from '../store.js';
import { ensurePlexIds, recommendFor } from './recommend.js';

let nextId = 1;
function movie(extra: Partial<StoredMovie> = {}): StoredMovie {
  const id = nextId++;
  return {
    id,
    tmdbId: id,
    imdbId: null,
    title: `Movie ${id}`,
    year: 2000,
    overview: '',
    runtime: 110,
    certification: 'PG-13',
    genres: ['Action'],
    keywords: [],
    themes: {},
    moods: {},
    ratings: { rt: 70, imdb: null, tmdb: null, metacritic: null },
    posterUrl: null,
    fanartUrl: null,
    posterPath: null,
    fanartPath: null,
    trailerId: null,
    plexRatingKey: null,
    plexSlug: null,
    plexGuid: null,
    saga: null,
    addedAt: null,
    ...extra,
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-recommend-'));
  const store = new Store(openDb(dir));
  cleanups.push(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

describe('picks for a restricted profile', () => {
  it("offers a sequel it may watch when an earlier part isn't allowed", async () => {
    const store = tempStore();
    const dieHard = (part: number, title: string, certification: string) =>
      movie({ title, certification, saga: { id: 1, title: 'Die Hard', part, parts: 5 } });
    store.replaceMovies(
      [dieHard(1, 'Die Hard', 'R'), dieHard(4, 'Live Free or Die Hard', 'PG-13'), movie(), movie(), movie()],
      Date.now(),
    );
    const teen = store.profileRow(store.createLocalProfile('Teen', false, 'teen'))!;
    const titles = (await recommendFor(store, teen, {})).picks.map((p) => p.movie.title);
    expect(titles).toContain('Live Free or Die Hard');
    expect(titles).not.toContain('Die Hard');
  });
});

describe('looking up Plex ids for picks', () => {
  /** A Plex server answering with `handler`, and how many requests it got. */
  async function plexServer(handler: RequestListener) {
    const counter = { requests: 0 };
    const server = createServer((req, res) => {
      counter.requests++;
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => server.close());
    const store = tempStore();
    const port = (server.address() as AddressInfo).port;
    store.update('plex', { adminToken: 'token', machineId: 'machine', serverUrl: `http://127.0.0.1:${port}` });
    store.replaceMovies([movie({ plexRatingKey: '1' }), movie({ plexRatingKey: '2' })], Date.now());
    return { store, counter };
  }

  it("stops asking a Plex server it can't reach for a while, so picks don't wait on it", async () => {
    const { store, counter } = await plexServer((req) => req.socket.destroy());
    await ensurePlexIds(store, store.movies());
    expect(counter.requests).toBe(2);
    await ensurePlexIds(store, store.movies());
    expect(counter.requests).toBe(2);
  });

  it('keeps looking up the others when one item is gone', async () => {
    const { store, counter } = await plexServer((req, res) => {
      const found = req.url === '/library/metadata/2';
      res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(found ? { MediaContainer: { Metadata: [{ ratingKey: '2', slug: 'two' }] } } : {}));
    });
    await ensurePlexIds(store, store.movies());
    expect(Object.fromEntries(store.movies().map((m) => [m.plexRatingKey, m.plexSlug]))).toEqual({ 1: null, 2: 'two' });
    await ensurePlexIds(store, store.movies());
    expect(counter.requests).toBe(3);
  });
});
