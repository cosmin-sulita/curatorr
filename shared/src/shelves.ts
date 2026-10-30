// The first question's shortcuts: what just arrived, and the season's movies.
import { DAY, pickingDay } from './clock.js';
import { JUST_ARRIVED, SEASONS, seasonById, type SeasonDef } from './taxonomy.js';
import { keywordPhrases } from './tagger.js';
import type { Movie } from './types.js';

/** When the movie arrived in the library: its file's import, or Radarr's added date when that isn't known. */
export function arrivalTime(m: Movie): number | null {
  const t = Date.parse(m.arrivedAt ?? m.addedAt ?? '');
  return Number.isFinite(t) ? t : null;
}

/** Days since the movie arrived, or null when unknown. */
export function daysInLibrary(m: Movie, now: number): number | null {
  const at = arrivalTime(m);
  return at == null ? null : Math.max(0, (now - at) / DAY);
}

/** "Just arrived" offers the movies that arrived this recently. */
const JUST_ARRIVED_DAYS = 30;

/** Whether the movie is among those "Just arrived" offers at `now`. */
export function arrivedLately(m: Movie, now: number) {
  const days = daysInLibrary(m, now);
  return days != null && days <= JUST_ARRIVED_DAYS;
}

/** A movie set on the season's holiday itself gets this much on the season's shortcut, so those lead it. */
export const SEASON_BONUS = 5;

/** The season the evening of `now` belongs to, if any. */
export function seasonFor(now: number): SeasonDef | null {
  const month = Number(pickingDay(now).slice(5, 7));
  return SEASONS.find((s) => s.month === month) ?? null;
}

/**
 * Whether each movie is set on a season's holiday, by season. The shortcut and its tile ask about every movie on each
 * request, and splitting the keywords is the slow part. A movie's keywords never change: a sync brings new objects.
 */
const onHolidayBySeason = new Map<string, WeakMap<Movie, boolean>>();

/** Whether one of the movie's keywords holds a holiday term, as a whole word: "halloween party" does. */
export function onHoliday(m: Movie, season: SeasonDef) {
  let known = onHolidayBySeason.get(season.id);
  if (!known) onHolidayBySeason.set(season.id, (known = new WeakMap()));
  let on = known.get(m);
  if (on === undefined) {
    on = m.keywords.some((k) => [...keywordPhrases(k)].some((p) => season.keywords.includes(p)));
    known.set(m, on);
  }
  return on;
}

/** Whether the movie fits the season: one of its genres or themes, or set on the holiday itself. */
export function inSeason(m: Movie, season: SeasonDef) {
  return (
    Boolean(season.genres?.some((g) => m.genres.includes(g))) ||
    Boolean(season.themes?.some((t) => (m.themes[t] ?? 0) > 0)) ||
    onHoliday(m, season)
  );
}

/** Whether the movie belongs on the shortcut's shelf; without one, every movie does. */
export function matchesShelf(m: Movie, shelf: string | null | undefined, now: number) {
  if (!shelf) return true;
  if (shelf === JUST_ARRIVED.id) return arrivedLately(m, now);
  const season = seasonById.get(shelf);
  return season ? inSeason(m, season) : false;
}
