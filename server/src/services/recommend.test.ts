import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { Store, type StoredMovie } from '../store.js';
import { recommendFor } from './recommend.js';

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
    ratings: { rt: 70, rtVotes: null, imdb: null, tmdb: null, metacritic: null },
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
