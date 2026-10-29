import { describe, expect, it } from 'vitest';
import { GENRES, MOODS, NO_PREFERENCE, SAGA_TIME, SEASONS, SHELVES, THEMES, TIME_OPTIONS, genreById, themeById } from './taxonomy.js';

// The vocabulary refers to itself by id in plain strings: a misspelt one would compile and quietly match nothing.
describe('the vocabulary', () => {
  it('gives every answer and shortcut an id of its own', () => {
    for (const list of [GENRES, THEMES, MOODS, TIME_OPTIONS, SHELVES]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size, ids.join(', ')).toBe(ids.length);
    }
  });

  it('only names genres and themes that exist', () => {
    const genre = (id: string) => expect(genreById.has(id), `genre ${id}`).toBe(true);
    for (const t of THEMES) t.genres?.forEach(genre);
    for (const m of MOODS) {
      Object.keys(m.genres).forEach(genre);
      Object.keys(m.negativeGenres ?? {}).forEach(genre);
      m.excludeGenres?.forEach(genre);
    }
    for (const s of SEASONS) {
      s.genres?.forEach(genre);
      for (const id of s.themes ?? []) expect(themeById.has(id), `theme ${id}`).toBe(true);
    }
  });

  it('reads each plot pattern afresh for every movie', () => {
    for (const t of THEMES) {
      // exec() on a global pattern starts where the last movie's match ended.
      if (t.overview) expect(t.overview.global, t.id).toBe(false);
      // replaceAll() needs one.
      if (t.overviewExclude) expect(t.overviewExclude.global, t.id).toBe(true);
    }
  });

  it('offers "no preference" and "Start a saga" as time answers', () => {
    expect(TIME_OPTIONS.map((t) => t.id)).toEqual(expect.arrayContaining([NO_PREFERENCE, SAGA_TIME]));
  });
});
