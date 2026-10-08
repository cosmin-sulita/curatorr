import { describe, expect, it } from 'vitest';
import { MAX_SAGA_PARTS, sagaState } from './sagas.js';
import type { Movie } from './types.js';

let nextId = 1;
function part(sagaId: number, part: number, parts: number): Movie {
  const id = nextId++;
  return {
    id,
    tmdbId: id,
    imdbId: null,
    title: `Saga ${sagaId} part ${part}`,
    year: 2000 + part,
    overview: '',
    runtime: 120,
    certification: 'PG-13',
    genres: ['Adventure'],
    keywords: [],
    themes: {},
    moods: {},
    ratings: { rt: 80, rtVotes: null, imdb: null, tmdb: null, metacritic: null },
    posterUrl: null,
    fanartUrl: null,
    trailerId: null,
    plexRatingKey: String(id),
    plexSlug: null,
    plexGuid: null,
    saga: { id: sagaId, title: `Saga ${sagaId}`, part, parts },
    addedAt: null,
  };
}

describe('sagaState', () => {
  it('holds back a sequel until the previous part is watched, pointing at the first unwatched part', () => {
    const [p1, p2, p3] = [part(1, 1, 3), part(1, 2, 3), part(1, 3, 3)];
    const state = sagaState([p3, p1, p2], new Set());
    expect(state.blockedBy.get(p2!.id)).toBe(p1);
    expect(state.blockedBy.get(p3!.id)).toBe(p1);
    expect(state.blockedBy.has(p1!.id)).toBe(false);
    expect([...state.starters]).toEqual([p1!.id]);
    expect(state.owned.get(1)!.map((m) => m.id)).toEqual([p1!.id, p2!.id, p3!.id]);
  });

  it('lets the next part through once the previous one is watched', () => {
    const [p1, p2, p3] = [part(2, 1, 3), part(2, 2, 3), part(2, 3, 3)];
    const state = sagaState([p1!, p2!, p3!], new Set([p1!.id]));
    expect([...state.next]).toEqual([p2!.id]);
    expect(state.blockedBy.get(p3!.id)).toBe(p2); // part 2 is now the first unwatched
    expect(state.starters.size).toBe(0); // already started
  });

  it('only counts owned parts: a missing part 1 does not hold back part 2', () => {
    const [p2, p3] = [part(3, 2, 3), part(3, 3, 3)];
    const state = sagaState([p2!, p3!], new Set());
    expect(state.blockedBy.has(p2!.id)).toBe(false);
    expect(state.blockedBy.get(p3!.id)).toBe(p2);
    expect([...state.starters]).toEqual([p2!.id]);
  });

  it('treats big franchises as standalone films', () => {
    const bond = [part(4, 1, MAX_SAGA_PARTS + 15), part(4, 2, MAX_SAGA_PARTS + 15)];
    const state = sagaState(bond, new Set());
    expect(state.blockedBy.size).toBe(0);
    expect(state.starters.size).toBe(0);
  });

  it('needs two owned parts to offer starting a saga', () => {
    expect(sagaState([part(5, 1, 3)], new Set()).starters.size).toBe(0);
  });

  it('has nothing to say once every part is watched', () => {
    const parts = [part(6, 1, 2), part(6, 2, 2)];
    const state = sagaState(parts, new Set(parts.map((m) => m.id)));
    expect([state.blockedBy.size, state.next.size, state.starters.size]).toEqual([0, 0, 0]);
  });
});
