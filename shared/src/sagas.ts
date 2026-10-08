import type { Movie } from './types.js';

/**
 * Collections bigger than this (James Bond, Friday the 13th…) are franchises of
 * standalone films, so their order doesn't matter.
 */
export const MAX_SAGA_PARTS = 10;

export interface SagaState {
  /** Sequel id → the earliest unwatched owned part, to watch first. */
  blockedBy: Map<number, Movie>;
  /** Unwatched movies whose previous owned part has been watched. */
  next: Set<number>;
  /** First owned parts of sagas with at least two owned parts, none of them watched. */
  starters: Set<number>;
  /** Owned parts of each saga, in order. */
  owned: Map<number, Movie[]>;
}

export const emptySagaState = (): SagaState => ({
  blockedBy: new Map(),
  next: new Set(),
  starters: new Set(),
  owned: new Map(),
});

/**
 * Where a profile stands in each saga. `library` is what can actually be played
 * (only owned parts count: a part 1 you don't have doesn't hold back part 2);
 * `seen` is everything the profile has watched or marked "Seen it".
 */
export function sagaState(library: Movie[], seen: Set<number>): SagaState {
  const state = emptySagaState();
  for (const m of library) {
    if (!m.saga || m.saga.parts > MAX_SAGA_PARTS) continue;
    const parts = state.owned.get(m.saga.id) ?? [];
    parts.push(m);
    state.owned.set(m.saga.id, parts);
  }

  for (const parts of state.owned.values()) {
    parts.sort((a, b) => a.saga!.part - b.saga!.part);
    const firstUnwatched = parts.find((m) => !seen.has(m.id));
    if (!firstUnwatched) continue;
    if (parts.length >= 2 && parts.every((m) => !seen.has(m.id))) state.starters.add(parts[0]!.id);

    parts.forEach((m, i) => {
      if (i === 0 || seen.has(m.id)) return;
      if (seen.has(parts[i - 1]!.id)) state.next.add(m.id);
      else state.blockedBy.set(m.id, firstUnwatched);
    });
  }
  return state;
}
