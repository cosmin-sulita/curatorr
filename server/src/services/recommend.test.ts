import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tasteEvents, type Criteria } from '@curatorr/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { Store, type StoredMovie } from '../store.js';
import { ensurePlexIds, likeSeeds, profileData, recommendFor, similarFor } from './recommend.js';

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
    jellyfinId: null,
    saga: null,
    addedAt: null,
    arrivedAt: null,
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
    const titles = (await recommendFor(store, [teen], {})).picks.map((p) => p.movie.title);
    expect(titles).toContain('Live Free or Die Hard');
    expect(titles).not.toContain('Die Hard');
  });
});

describe('a Jellyfin profile limited to some libraries', () => {
  /** A kid with no parental rating, limited to the libraries Jellyfin lets them open. */
  function jellyfinKid(store: Store) {
    store.set('jellyfin', {
      url: 'http://127.0.0.1:9',
      publicUrl: null,
      serverId: 'server',
      serverName: 'Home',
      deviceId: 'device',
      token: 'token',
      ownerId: 'a'.repeat(32),
      ownerName: 'Boss',
      libraryIds: [],
    });
    const id = store.upsertJellyfinProfile({ jellyfinUserId: 'c'.repeat(32), name: 'Kid', avatarUrl: null, isAdmin: false, restrictionProfile: null });
    return id;
  }
  const canOpen = (store: Store, kid: number, movies: StoredMovie[]) =>
    store.replaceJellyfinState(kid, { watched: [], watchlist: [], available: movies }, Date.now());
  const titles = (picks: { picks: { movie: { title: string } }[] }) => picks.picks.map((p) => p.movie.title).sort();

  it("offers nothing until Curatorr has read what the kid may open", async () => {
    const store = tempStore();
    const cartoon = movie({ title: 'Cartoon', jellyfinId: 'jf-cartoon' });
    store.replaceMovies([cartoon, movie({ title: 'Grown-up', jellyfinId: 'jf-grown-up' })], Date.now());
    const kid = jellyfinKid(store);
    expect((await recommendFor(store, [store.profileRow(kid)!], {})).picks).toEqual([]);
    expect(likeSeeds(store, [store.profileRow(kid)!], 'o')).toEqual([]);

    canOpen(store, kid, [cartoon]);
    expect(titles(await recommendFor(store, [store.profileRow(kid)!], {}))).toEqual(['Cartoon']);
  });

  it("keeps to the kid's libraries even when no movie matched Jellyfin", async () => {
    const store = tempStore();
    const cartoon = movie({ title: 'Cartoon' });
    store.replaceMovies([cartoon, movie({ title: 'Grown-up' })], Date.now());
    const kid = jellyfinKid(store);
    canOpen(store, kid, [cartoon]);
    expect(titles(await recommendFor(store, [store.profileRow(kid)!], {}))).toEqual(['Cartoon']);
  });

  it("won't start \"Something like…\" from a movie in a library the kid can't open", async () => {
    const store = tempStore();
    const cartoon = movie({ title: 'Cartoon', jellyfinId: 'jf-cartoon' });
    const grownUp = movie({ title: 'Grown-up', jellyfinId: 'jf-grown-up' });
    store.replaceMovies([cartoon, grownUp], Date.now());
    const kid = jellyfinKid(store);
    canOpen(store, kid, [cartoon]);
    await expect(similarFor(store, [store.profileRow(kid)!], grownUp.id)).rejects.toThrow('Movie not found');
    expect(likeSeeds(store, [store.profileRow(kid)!], 'o').map((s) => s.title)).toEqual(['Cartoon']);
  });
});

describe('Surprise me', () => {
  it('deals the ten best picks in a drawn order, while answers keep the ranking', async () => {
    const store = tempStore();
    // Critics and audiences both five points apart, more than the daily jitter can reorder, listed best first.
    const movies = Array.from({ length: 15 }, (_, i) =>
      movie({ ratings: { rt: 99 - i * 5, imdb: 7.95 - i / 4, tmdb: null, metacritic: null } }),
    );
    store.replaceMovies(movies, Date.now());
    const row = store.profileRow(store.createLocalProfile('Alex', true))!;
    const ids = async (c: Criteria) => (await recommendFor(store, [row], c)).picks.map((p) => p.movie.id);
    const best = movies.map((m) => m.id);

    const surprise = await ids({ genre: null, theme: null, mood: null, time: null });
    // Drawn in rank order only once in 10! draws.
    expect(surprise.slice(0, 10)).not.toEqual(best.slice(0, 10));
    expect(surprise.slice(0, 10).sort((a, b) => a - b)).toEqual(best.slice(0, 10));
    expect(surprise.slice(10)).toEqual(best.slice(10, 12));
    expect(await ids({ genre: 'Action' })).toEqual(best.slice(0, 12));
  });
});

describe('Just arrived', () => {
  it('picks from what arrived lately, best first rather than shuffled', async () => {
    const store = tempStore();
    const ago = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // Twelve new arrivals, critics and audiences both five points apart (more than the daily jitter can
    // reorder), listed best first, and an older movie rated above them all.
    const fresh = Array.from({ length: 12 }, (_, i) =>
      movie({ arrivedAt: ago(10), ratings: { rt: 98 - i * 5, imdb: 7.9 - i / 4, tmdb: null, metacritic: null } }),
    );
    const old = movie({ arrivedAt: ago(90), ratings: { rt: 100, imdb: 8, tmdb: null, metacritic: null } });
    store.replaceMovies([...fresh, old], Date.now());
    const row = store.profileRow(store.createLocalProfile('Alex', true))!;
    const { picks } = await recommendFor(store, [row], { shelf: 'new' });
    expect(picks.map((p) => p.movie.id)).toEqual(fresh.map((m) => m.id));
  });
});

describe('taste', () => {
  it('counts a "Seen it" as Seen it once the media server shows it watched', () => {
    const store = tempStore();
    const film = movie();
    store.replaceMovies([film], Date.now());
    const alex = store.profileRow(store.createLocalProfile('Alex', true))!;
    const at = Date.now();
    store.setFeedbackSynced(store.addFeedback(alex.id, film.id, 'seen', at));
    // The next sync reads the mark back from Plex, which dated the watch the same second.
    store.replaceWatched(alex.id, [{ movieId: film.id, viewedAt: at - 1000 }], at);
    const d = profileData(store, alex);
    expect(tasteEvents(d.watched, d.feedback)).toEqual([{ movieId: film.id, at, weight: 0.3 }]);
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

describe('watching together', () => {
  const titles = (res: { picks: { movie: { title: string } }[] }) => res.picks.map((p) => p.movie.title).sort();
  /** A library of five, and Alex, Sam and Kids, who may only see G and PG. */
  function household() {
    const store = tempStore();
    const named = (title: string, extra: Partial<StoredMovie> = {}) => movie({ title, ...extra });
    const library = {
      heat: named('Heat', { certification: 'R' }),
      up: named('Up', { certification: 'PG' }),
      coco: named('Coco', { certification: 'PG' }),
      jaws: named('Jaws', { certification: 'PG' }),
      alien: named('Alien', { certification: 'R' }),
    };
    store.replaceMovies(Object.values(library), Date.now());
    const alex = store.profileRow(store.createLocalProfile('Alex', true))!;
    const sam = store.profileRow(store.createLocalProfile('Sam', false))!;
    const kids = store.profileRow(store.createLocalProfile('Kids', false, 'older_kid'))!;
    return { store, library, alex, sam, kids };
  }

  it("leaves out what anyone watched, or marked Seen it or Never", async () => {
    const { store, library, alex, sam } = household();
    store.replaceWatched(alex.id, [{ movieId: library.heat.id, viewedAt: Date.now() - 1000 }], Date.now());
    store.addFeedback(sam.id, library.up.id, 'seen');
    store.addFeedback(sam.id, library.coco.id, 'never');
    expect(titles(await recommendFor(store, [alex, sam], {}))).toEqual(['Alien', 'Jaws']);
    expect(titles(await recommendFor(store, [sam], {}))).toEqual(['Alien', 'Heat', 'Jaws']);
  });

  it("keeps to the strictest member's limits", async () => {
    const { store, alex, kids } = household();
    expect(titles(await recommendFor(store, [alex, kids], {}))).toEqual(['Coco', 'Jaws', 'Up']);
  });

  it('holds a sequel back until everyone has seen the part before', async () => {
    const store = tempStore();
    const part = (n: number) => movie({ title: `Saga ${n}`, saga: { id: 9, title: 'Saga', part: n, parts: 2 } });
    const [p1, p2] = [part(1), part(2)];
    store.replaceMovies([p1, p2, movie({ title: 'Other' })], Date.now());
    const alex = store.profileRow(store.createLocalProfile('Alex', true))!;
    const sam = store.profileRow(store.createLocalProfile('Sam', false))!;
    store.replaceWatched(alex.id, [{ movieId: p1.id, viewedAt: Date.now() - 1000 }], Date.now());
    expect(titles(await recommendFor(store, [alex], {}))).toEqual(['Other', 'Saga 2']);
    expect(titles(await recommendFor(store, [alex, sam], {}))).toEqual(['Other']);
  });

  it("counts anyone's watchlist and requests, and says whose", async () => {
    const { store, library, alex, sam } = household();
    store.replaceWatchlist(sam.id, [library.jaws.id]);
    store.replaceRequests([{ profileId: sam.id, movieId: library.alien.id, requestedAt: Date.now() }]);
    const picks = (await recommendFor(store, [alex, sam], {})).picks;
    const reasons = (title: string) => picks.find((p) => p.movie.title === title)!.reasons;
    expect(reasons('Jaws')).toContainEqual({ kind: 'watchlist', label: "On Sam's watchlist" });
    expect(reasons('Alien')).toContainEqual({ kind: 'requested', label: 'Sam requested this' });
    const alone = (await recommendFor(store, [alex], {})).picks;
    expect(alone.find((p) => p.movie.title === 'Jaws')!.reasons.some((r) => r.kind === 'watchlist')).toBe(false);
  });

  it("doesn't treat a movie only someone outside the group asked for as news", async () => {
    const { store, library, alex, sam, kids } = household();
    const now = Date.now();
    store.replaceMovies([{ ...library.up, arrivedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }], now);
    store.replaceRequests([{ profileId: kids.id, movieId: library.up.id, requestedAt: now }]);
    const added = async (rows: typeof alex[]) =>
      (await recommendFor(store, rows, {})).picks[0]!.reasons.some((r) => r.kind === 'added');
    expect(await added([alex, sam])).toBe(false);
    expect(await added([alex, kids])).toBe(true);
  });
});
