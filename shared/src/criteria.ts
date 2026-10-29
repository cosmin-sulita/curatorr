// Whether a movie matches the wizard's answers.
import { timeById } from './taxonomy.js';
import type { Criteria, Movie } from './types.js';

export function matchesGenre(m: Movie, genre?: string | null) {
  return !genre || m.genres.includes(genre);
}
export function matchesTheme(m: Movie, theme?: string | null) {
  return !theme || (m.themes[theme] ?? 0) > 0;
}
export function matchesMood(m: Movie, mood?: string | null) {
  return !mood || (m.moods[mood] ?? 0) > 0;
}
export function matchesTime(m: Movie, time?: string | null) {
  const max = time ? timeById.get(time)?.maxRuntime : null;
  // Unknown runtimes are given the benefit of the doubt.
  return max == null || !m.runtime || m.runtime <= max;
}

export function matchesCriteria(m: Movie, c: Criteria) {
  return matchesGenre(m, c.genre) && matchesTheme(m, c.theme) && matchesMood(m, c.mood) && matchesTime(m, c.time);
}
