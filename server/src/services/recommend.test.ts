import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tasteEvents, type Criteria, type TasteProfile } from '@curatorr/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { Store, type ProfileRow, type StoredMovie } from '../store.js';
import {
  ensurePlexIds,
  likeSeeds,
  optionsFor,
  pickingFor,
  profileData,
  recommendFor,
  similarFor,
} from './recommend.js';

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

describe('a saga with a part marked Never', () => {
  /** A saga of `n` parts, and enough other movies to fill the picks. */
  function saga(n: number) {
    const store = tempStore();
    const parts = Array.from({ length: n }, (_, i) =>
      movie({ title: `Part ${i + 1}`, saga: { id: 7, title: 'Saga', part: i + 1, parts: n } }),
    );
    store.replaceMovies([...parts, movie({ title: 'Other' })], Date.now());
    const alex = store.profileRow(store.createLocalProfile('Alex', true))!;
    const watch = (...seen: StoredMovie[]) =>
      store.replaceWatched(alex.id, seen.map((m) => ({ movieId: m.id, viewedAt: Date.now() - 86_400_000 })), Date.now());
    return { store, parts, alex, watch };
  }
  const reasonsOf = (res: { picks: { movie: { title: string }; reasons: { label: string }[] }[] }, title: string) =>
    res.picks.find((p) => p.movie.title === title)?.reasons.map((r) => r.label);

  it('goes on to the part after it', async () => {
    const { store, parts, alex, watch } = saga(5);
    watch(parts[0]!, parts[1]!);
    store.addFeedback(alex.id, parts[2]!.id, 'never');
    const res = await recommendFor(store, [alex], {});
    expect(reasonsOf(res, 'Part 4')).toContain('Next in Saga');
    expect(res.picks.map((p) => p.movie.title)).not.toContain('Part 3');
  });

  it('starts the saga at the next part when the first is marked Never', async () => {
    const { store, parts, alex } = saga(3);
    store.addFeedback(alex.id, parts[0]!.id, 'never');
    const titles = (await recommendFor(store, [alex], {})).picks.map((p) => p.movie.title);
    expect(titles).toContain('Part 2');
    expect(titles).not.toContain('Part 1');
    expect(titles).not.toContain('Part 3');
  });

  it('still holds the next part back for an unwatched part without a mark', async () => {
    const { store, parts, alex, watch } = saga(3);
    watch(parts[0]!);
    const titles = (await recommendFor(store, [alex], {})).picks.map((p) => p.movie.title);
    expect(titles).toContain('Part 2');
    expect(titles).not.toContain('Part 3');
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

describe('picking for a whole screen of answers', () => {
  /** Four movies, and Alex and Sam. */
  function home() {
    const store = tempStore();
    const films = Array.from({ length: 4 }, (_, i) => movie({ title: `Film ${i + 1}` }));
    store.replaceMovies(films, Date.now());
    const alex = store.profileRow(store.createLocalProfile('Alex', true))!;
    const sam = store.profileRow(store.createLocalProfile('Sam', false))!;
    // The first read of the Plex settings saves their defaults, a write of its own.
    store.get('plex');
    return { store, films, alex, sam };
  }
  // Each request reads its profiles anew.
  const fresh = (store: Store, ...rows: ProfileRow[]) => rows.map((r) => store.profileRow(r.id)!);

  it('works a group out once for all the answers of a screen, each at its own moment', () => {
    const { store, alex } = home();
    const now = Date.now();
    const first = pickingFor(store, fresh(store, alex), now);
    const again = pickingFor(store, fresh(store, alex), now + 1000);
    expect(again.picking.eligible).toBe(first.picking.eligible);
    expect([first.picking.opts.now, again.picking.opts.now]).toEqual([now, now + 1000]);
  });

  it('changes the very next answer after a mark, an Undo, a profile read, a setting or a sync', async () => {
    const { store, films, alex } = home();
    const total = () => optionsFor(store, fresh(store, alex), 'genre', {}).total;
    expect(total()).toBe(4);
    store.addFeedback(alex.id, films[0]!.id, 'seen');
    expect(total()).toBe(3);
    store.deleteMarks(alex.id, films[0]!.id, 'seen');
    expect(total()).toBe(4);
    store.replaceWatched(alex.id, [{ movieId: films[1]!.id, viewedAt: Date.now() - 1000 }], Date.now());
    expect(total()).toBe(3);
    store.update('app', { includeWatched: true });
    expect(total()).toBe(4);
    store.replaceMovies([...films, movie({ title: 'Film 5' })], Date.now());
    expect(total()).toBe(5);
    store.replaceRequests([{ profileId: alex.id, movieId: films[2]!.id, requestedAt: Date.now() }]);
    const requested = async () => {
      const { picks } = await recommendFor(store, fresh(store, alex), {});
      return picks.some((p) => p.reasons.some((r) => r.kind === 'requested'));
    };
    expect(await requested()).toBe(true);
    store.update('app', { boostRequests: false });
    expect(await requested()).toBe(false);
  });

  it('keeps a group apart from its members, and from the same people in another order', () => {
    const { store, films, alex, sam } = home();
    store.replaceWatchlist(alex.id, [films[0]!.id]);
    store.replaceWatchlist(sam.id, [films[0]!.id]);
    const now = Date.now();
    const [a, ab, ba] = [[alex], [alex, sam], [sam, alex]].map((rows) => pickingFor(store, fresh(store, ...rows), now));
    expect(new Set([a, ab, ba].map((p) => p!.picking.eligible)).size).toBe(3);
    // The order says whose name comes first on a chip.
    expect(ab!.picking.opts.wantedBy?.get(films[0]!.id)?.watchlist).toEqual(['Alex', 'Sam']);
    expect(ba!.picking.opts.wantedBy?.get(films[0]!.id)?.watchlist).toEqual(['Sam', 'Alex']);
  });

  it("counts tonight's watch in taste from the next evening, with nothing written in between", () => {
    const { store, films, alex } = home();
    const evening = new Date(2026, 9, 20, 21).getTime();
    store.replaceWatched(alex.id, [{ movieId: films[0]!.id, viewedAt: evening - 60 * 60 * 1000 }], evening);
    const confidence = (now: number) =>
      (pickingFor(store, fresh(store, alex), now, { taste: true }).picking.opts.taste as TasteProfile).confidence;
    expect(confidence(evening)).toBe(0);
    // 5 am, past the 4 am turnover: one watch of the ten that make taste count for half.
    expect(confidence(evening + 8 * 60 * 60 * 1000)).toBeCloseTo(1 / 11, 10);
  });

  it('keeps four groups at most, dropping the one asked for longest ago', () => {
    const { store } = home();
    const people = ['A', 'B', 'C', 'D', 'E'].map((name) => store.profileRow(store.createLocalProfile(name, false))!);
    const now = Date.now();
    const first = people.map((p) => pickingFor(store, fresh(store, p), now).picking.eligible);
    expect(pickingFor(store, fresh(store, people[4]!), now).picking.eligible).toBe(first[4]);
    expect(pickingFor(store, fresh(store, people[0]!), now).picking.eligible).not.toBe(first[0]);
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

  it('treats a movie someone else in the household asked for as news when it arrives', async () => {
    const { store, library, alex, sam, kids } = household();
    const now = Date.now();
    store.replaceMovies([{ ...library.up, arrivedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }], now);
    store.replaceRequests([{ profileId: kids.id, movieId: library.up.id, requestedAt: now }]);
    const added = async (rows: typeof alex[]) =>
      (await recommendFor(store, rows, {})).picks[0]!.reasons.some((r) => r.kind === 'added');
    expect(await added([alex])).toBe(true);
    expect(await added([alex, sam])).toBe(true);
  });
});
