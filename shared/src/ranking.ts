// Ranking the wizard's picks: quality, the answers, the season, sagas, taste and what the profile did and wants.
import { pickingDay } from './clock.js';
import { matchesCriteria, matchesGenre, matchesMood, matchesTheme, matchesTime } from './criteria.js';
import { addedReasons, personalAdjustment, profileSignals, seededUnit, wantedReasons, type WantedBy } from './personal.js';
import { qualityScore } from './quality.js';
import { emptySagaState, type SagaState } from './sagas.js';
import { SEASON_BONUS, arrivedLately, daysInLibrary, inSeason, matchesShelf, onHoliday } from './shelves.js';
import { TASTE_CHIP, blendTaste, type TasteProfile } from './tastePoints.js';
import { JUST_ARRIVED, SAGA_TIME, genreById, moodById, seasonById, themeById, timeById, type SeasonDef } from './taxonomy.js';
import type { Criteria, FeedbackEvent, Movie, Reason } from './types.js';

const MAX_THEME_BONUS = 5;
const MAX_MOOD_BONUS = 3;
const TAG_SATURATION = 6;
/** The next part of a saga the profile has started. */
export const NEXT_PART_BONUS = 4;
/**
 * In the wizard's picks, what the profile wants counts this many times its bonus: a request or the watchlist, a new
 * arrival, the next part of a saga. In replayed watches these said more about what a household picked than the same
 * points of rating. "Something like…" ranks by likeness, and keeps the bonuses as they are.
 */
const WANTED_WEIGHT = 1.5;
/** Close matches pad a list with fewer exact ones than this. */
export const MIN_RESULTS = 6;
/** One list of picks: the most a ranking returns, and the wizard asks nothing more once this few movies are left. */
export const MAX_RESULTS = 12;

/**
 * The parts of a pick's score: its rating (a saga's average, to start one), how strongly it matches the theme and
 * mood answers, the season's holiday, the next part of a saga, taste, a request or the watchlist, a new arrival,
 * skips, earlier evenings it was shown, and the daily shuffle.
 */
export const SCORE_PARTS = ['quality', 'answers', 'season', 'saga', 'taste', 'wanted', 'arrival', 'skip', 'shown', 'jitter'] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];
/** What each part adds to a pick's score; before rounding, they add up to it. */
export type ScoreParts = Record<ScorePart, number>;

export interface RankedMovie {
  movie: Movie;
  score: number;
  quality: number;
  /** 0 = matches everything, 1 = matches theme or mood, 2 = genre/time only. */
  tier: number;
  reasons: Reason[];
  /** Where the score came from, so `npm run eval` can weigh each part. */
  parts?: ScoreParts;
}

export interface RankOptions {
  now: number;
  seed: string;
  limit?: number;
  /** The profile's media server watchlist; its own Watchlist marks count too (see wantedIds). */
  watchlist?: Set<number>;
  /** Unwatched movies the profile requested in Seerr. */
  requested?: Set<number>;
  sagas?: SagaState;
  /** What the profile tends to watch (see taste.ts), or each person's, when several watch together. */
  taste?: TasteProfile | TasteProfile[];
  /** When several watch together: whose request and whose watchlist each wanted movie is, for its chips. */
  wantedBy?: Map<number, WantedBy>;
}

/** A tag score as 0..1; anything at or above the saturation point counts fully. */
export function tagStrength(score: number | undefined) {
  return Math.min(score ?? 0, TAG_SATURATION) / TAG_SATURATION;
}

/** "45m", "1h 05m", "2h": the pick's header and its chips write a length the same way. */
export function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${String(m).padStart(2, '0')}m` : ''}` : `${m}m`;
}

/** The chips for what the movie matches: the season's holiday, the answers, a short runtime, a high rating. */
function reasonsFor(m: Movie, c: Criteria): Reason[] {
  const reasons: Reason[] = [];
  const season = c.shelf ? seasonById.get(c.shelf) : undefined;
  if (season?.chip && onHoliday(m, season)) reasons.push({ kind: 'season', label: season.chip });
  if (c.genre && m.genres.includes(c.genre)) {
    reasons.push({ kind: 'genre', label: genreById.get(c.genre)?.label ?? c.genre });
  }
  if (c.theme && matchesTheme(m, c.theme)) {
    reasons.push({ kind: 'theme', label: themeById.get(c.theme)?.label ?? c.theme });
  }
  if (c.mood && matchesMood(m, c.mood)) {
    reasons.push({ kind: 'mood', label: moodById.get(c.mood)?.label ?? c.mood });
  }
  const time = c.time ? timeById.get(c.time) : undefined;
  if (time?.maxRuntime && m.runtime && m.runtime <= time.maxRuntime) {
    reasons.push({ kind: 'time', label: `Only ${formatRuntime(m.runtime)}` });
  }
  const { rt, imdb } = m.ratings;
  if (rt != null && rt >= 75) {
    reasons.push({ kind: 'rating', label: `${Math.round(rt)}% on Rotten Tomatoes` });
  } else if (imdb != null && imdb >= 7.5) {
    reasons.push({ kind: 'rating', label: `${imdb.toFixed(1)} on IMDb` });
  }
  return reasons;
}

function sagaTotals(parts: Movie[]) {
  const quality = parts.reduce((sum, m) => sum + qualityScore(m.ratings), 0) / parts.length;
  const runtime = parts.reduce((sum, m) => sum + (m.runtime ?? 0), 0);
  return { quality, runtime };
}

/** Best first. Exact matches always lead; close ones only pad a short list. Leaves `ranked` as it was. */
export function topRanked(ranked: RankedMovie[], limit = MAX_RESULTS): RankedMovie[] {
  const sorted = [...ranked].sort((a, b) => a.tier - b.tier || b.score - a.score);
  const exact = sorted.filter((r) => r.tier === 0);
  if (exact.length >= MIN_RESULTS) return exact.slice(0, limit);
  return sorted.slice(0, Math.max(limit, exact.length));
}

/** "Surprise me" deals this many of the best picks in a drawn order. */
const SURPRISE_POOL = 10;

/** "Surprise me" answers none of the questions, and isn't a shortcut. */
export function isSurprise(c: Criteria) {
  return !c.genre && !c.theme && !c.mood && !c.time && !c.shelf;
}

/**
 * "Surprise me": the best picks in an order drawn for the profile and the evening, each as likely as
 * the others to come first, so it isn't always the top-ranked movie. Each movie draws its own place,
 * so the order holds all evening, and the others keep theirs when one drops out of the best.
 */
export function surpriseOrder(ranked: RankedMovie[], opts: RankOptions): RankedMovie[] {
  const day = pickingDay(opts.now);
  const draw = (r: RankedMovie) => seededUnit(`${opts.seed}|${day}|surprise|${r.movie.id}`);
  const pool = ranked.slice(0, SURPRISE_POOL).sort((a, b) => draw(b) - draw(a));
  return [...pool, ...ranked.slice(SURPRISE_POOL)];
}

/**
 * A matching sequel whose earlier part is unwatched brings in that part instead, as long as it fits the genre and time
 * answers, and a season's shortcut. On "Just arrived" it needn't be new. Adds those first parts to `base`, and answers
 * them: they rank as exact matches.
 */
function pullInFirstParts(
  base: Movie[],
  eligible: Movie[],
  c: Criteria,
  sagas: SagaState,
  season: SeasonDef | undefined,
  now: number,
): Set<number> {
  const startsFor = new Set<number>();
  const eligibleById = new Map(eligible.map((m) => [m.id, m]));
  const inBase = new Set(base.map((m) => m.id));
  for (const parts of sagas.owned.values()) {
    for (const sequel of parts) {
      const first = eligibleById.get(sagas.blockedBy.get(sequel.id)?.id ?? -1);
      if (!first || !matchesCriteria(sequel, c) || !matchesShelf(sequel, c.shelf, now)) continue;
      if (!matchesGenre(first, c.genre) || !matchesTime(first, c.time)) continue;
      if (season && !inSeason(first, season)) continue;
      startsFor.add(first.id);
      if (!inBase.has(first.id)) {
        base.push(first);
        inBase.add(first.id);
      }
    }
  }
  return startsFor;
}

/**
 * What a saga means for a pick: to start one ("Start a saga"), a saga is judged by all its parts, and says how many it
 * has; the next part of a started one gets NEXT_PART_BONUS; a first part brought in for its sequel says it starts one.
 */
function sagaPart(m: Movie, sagas: SagaState, startingSaga: boolean, startsFor: Set<number>) {
  const reasons: Reason[] = [];
  const owned = m.saga ? sagas.owned.get(m.saga.id) : undefined;
  if (startingSaga && owned && m.saga) {
    const totals = sagaTotals(owned);
    reasons.push({ kind: 'saga', label: `Start of ${m.saga.title}` });
    reasons.push({
      kind: 'saga',
      label:
        owned.length === m.saga.parts
          ? `${owned.length} parts, ${formatRuntime(totals.runtime)} in all`
          : `${owned.length} of ${m.saga.parts} parts in your library`,
    });
    return { rating: totals.quality, bonus: 0, reasons };
  }
  if (sagas.next.has(m.id) && m.saga) {
    // Also covers a later part pulled in for a sequel: it continues a saga already started.
    reasons.push({ kind: 'saga', label: `Next in ${m.saga.title}` });
    return { rating: null, bonus: NEXT_PART_BONUS, reasons };
  }
  if (startsFor.has(m.id) && m.saga) reasons.push({ kind: 'saga', label: `Start of ${m.saga.title}` });
  return { rating: null, bonus: 0, reasons };
}

/**
 * Ranks eligible movies for the given criteria.
 * Exact matches always come first; if there are too few, close matches
 * (dropping theme and/or mood) pad the list so there is always something to offer.
 */
export function rankMovies(
  eligible: Movie[],
  c: Criteria,
  feedback: FeedbackEvent[],
  opts: RankOptions,
): RankedMovie[] {
  const signals = profileSignals(feedback, opts);
  const sagas = opts.sagas ?? emptySagaState();
  const startingSaga = c.time === SAGA_TIME;
  const season = c.shelf ? seasonById.get(c.shelf) : undefined;

  // "Start a saga" only offers first parts of sagas the profile hasn't started.
  const base = eligible.filter(
    (m) =>
      matchesGenre(m, c.genre) &&
      matchesTime(m, c.time) &&
      matchesShelf(m, c.shelf, opts.now) &&
      (!startingSaga || sagas.starters.has(m.id)),
  );
  const startsFor = startingSaga ? new Set<number>() : pullInFirstParts(base, eligible, c, sagas, season, opts.now);

  const { points: taste, leader } = blendTaste(base, opts.taste);
  /** Where each pick's taste chip goes: after the personal chips, before the ones for the answers. */
  const tasteChipAt = new Map<number, number>();

  const tierOf = (m: Movie): number => {
    if (startsFor.has(m.id)) return 0;
    const theme = matchesTheme(m, c.theme);
    const mood = matchesMood(m, c.mood);
    if (theme && mood) return 0;
    if (c.theme && c.mood && (theme || mood)) return 1;
    return 2;
  };

  const ranked = base.map((m): RankedMovie => {
    const quality = qualityScore(m.ratings);
    const saga = sagaPart(m, sagas, startingSaga, startsFor);
    const theme = c.theme ? MAX_THEME_BONUS * tagStrength(m.themes[c.theme]) : 0;
    const mood = c.mood ? MAX_MOOD_BONUS * tagStrength(m.moods[c.mood]) : 0;
    const adj = personalAdjustment(m, signals, opts);
    const parts: ScoreParts = {
      quality: saga.rating ?? quality,
      answers: theme + mood,
      season: season && onHoliday(m, season) ? SEASON_BONUS : 0,
      saga: saga.bonus * WANTED_WEIGHT,
      taste: taste.get(m.id) ?? 0,
      ...adj.parts,
      wanted: adj.parts.wanted * WANTED_WEIGHT,
      arrival: adj.parts.arrival * WANTED_WEIGHT,
    };
    const score = SCORE_PARTS.reduce((sum, part) => sum + parts[part], 0);

    // On "Just arrived" every new arrival says when it came, also once its bonus no longer would.
    const listedNew = c.shelf === JUST_ARRIVED.id && arrivedLately(m, opts.now);
    const arrived = { addedDaysAgo: adj.addedDaysAgo ?? (listedNew ? daysInLibrary(m, opts.now) : null) };
    const personal = [...wantedReasons(adj, opts.wantedBy?.get(m.id)), ...saga.reasons, ...addedReasons(arrived)];
    tasteChipAt.set(m.id, personal.length);
    return {
      movie: m,
      score: Math.round(score * 10) / 10,
      quality,
      tier: tierOf(m),
      reasons: [...personal, ...reasonsFor(m, c)],
      parts,
    };
  });

  const top = topRanked(ranked, opts.limit);
  // Explaining taste compares a pick with every watched movie, so only the picks that are shown get it.
  for (const r of top.slice(0, MAX_RESULTS)) {
    if ((taste.get(r.movie.id) ?? 0) < TASTE_CHIP) continue;
    // Watching together, the chip names the person whose taste the pick follows most.
    const who = leader.get(r.movie.id);
    const like = who?.because(r.movie);
    if (!like) continue;
    const label = `Because ${who!.name ?? 'you'} watched ${like.title}`;
    r.reasons.splice(tasteChipAt.get(r.movie.id)!, 0, { kind: 'taste', label });
  }
  return top;
}
