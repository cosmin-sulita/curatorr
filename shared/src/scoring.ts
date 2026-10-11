import {
  GENRES,
  JUST_ARRIVED,
  MIN_OPTION_COUNT,
  MOODS,
  SEASONS,
  THEMES,
  TIME_OPTIONS,
  genreById,
  moodById,
  seasonById,
  themeById,
  timeById,
  type SeasonDef,
  type ShelfDef,
} from './taxonomy.js';
import { emptySagaState, type SagaState } from './sagas.js';
import { keywordPhrases } from './tagger.js';
import type {
  Criteria,
  FeedbackEvent,
  MediaServer,
  Movie,
  Ratings,
  Reason,
  WizardOption,
  WizardOptionsResponse,
  WizardStep,
} from './types.js';

// ---------------------------------------------------------------------------
// Quality: half what critics think, half what audiences think.
// ---------------------------------------------------------------------------

/** A missing critics' or audience score counts as this, pulling a movie with only one toward the middle. */
const MISSING_SCORE = 50;

/** An audience rating out of 10 as a percentage, roughly the share who liked it: 5.0 is 40%, 7.0 is 80%. */
function audiencePercent(rating: number) {
  return Math.min(100, Math.max(0, (rating - 3) * 20));
}

/**
 * The Rotten Tomatoes critics' score averaged with the audience's IMDb rating (TMDB's, which runs
 * about 0.3 higher, when there's none), so a crowd-pleaser the critics panned still gets its chance.
 */
export function qualityScore(r: Ratings): number {
  const critics = r.rt != null && r.rt > 0 ? r.rt : MISSING_SCORE;
  const audience =
    r.imdb != null && r.imdb > 0
      ? audiencePercent(r.imdb)
      : r.tmdb != null && r.tmdb > 0
        ? audiencePercent(r.tmdb - 0.3)
        : MISSING_SCORE;
  return (critics + audience) / 2;
}

// ---------------------------------------------------------------------------
// Eligibility: what a given profile may be offered at all.
// ---------------------------------------------------------------------------

export interface ProfileContext {
  watched: Set<number>;
  feedback: FeedbackEvent[];
  /** Allowed certifications, or null for no restriction. */
  allowedCerts: Set<string> | null;
  /** Only offer movies found on this media server (so its Watch button works); null while matching isn't working. */
  requireServer: MediaServer | null;
  /** Movies the profile can open on the media server (Jellyfin: its library access and parental controls). */
  available?: Set<number> | null;
  includeWatched: boolean;
  /** Movies on the profile's watchlist: the Plex Watchlist, or Jellyfin favourites. */
  watchlist: Set<number>;
  /** Unwatched movies the profile requested in Seerr. */
  requested?: Set<number>;
  /** Where the profile stands in each saga; blocked sequels aren't offered. */
  sagas?: SagaState;
}

export function excludedIds(ctx: ProfileContext): Set<number> {
  const out = new Set<number>();
  for (const e of ctx.feedback) if (e.kind === 'seen' || e.kind === 'never') out.add(e.movieId);
  if (!ctx.includeWatched) for (const id of ctx.watched) out.add(id);
  return out;
}

/** Whether the profile's parental restrictions allow the movie. */
export function certAllowed(m: Movie, allowedCerts: Set<string> | null) {
  return !allowedCerts || (Boolean(m.certification) && allowedCerts.has(m.certification!.toUpperCase()));
}

/** Whether the library sync found the movie on the media server. */
export function onServer(m: Movie, server: MediaServer): boolean {
  return Boolean(server === 'plex' ? m.plexRatingKey : m.jellyfinId);
}

export function eligibleMovies(movies: Movie[], ctx: ProfileContext): Movie[] {
  const excluded = excludedIds(ctx);
  return movies.filter((m) => {
    if (excluded.has(m.id)) return false;
    if (ctx.sagas?.blockedBy.has(m.id)) return false;
    if (ctx.requireServer && !onServer(m, ctx.requireServer)) return false;
    if (ctx.available && !ctx.available.has(m.id)) return false;
    return certAllowed(m, ctx.allowedCerts);
  });
}

// ---------------------------------------------------------------------------
// Criteria matching
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
/** "Not tonight" keeps a movie down for two weeks, and two more for each other skip in the last 90 days. */
const SKIP_PENALTY = 15;
const SKIP_WINDOW = 14 * DAY;
const SKIP_MEMORY = 90 * DAY;
/** Each earlier evening a pick was shown and not played costs this, up to the maximum, for a month. */
const SHOWN_PENALTY = 4;
const SHOWN_PENALTY_MAX = 16;
const SHOWN_WINDOW = 30 * DAY;
/** A pick shown this evening isn't demoted yet, so answering the same way again gives the same pick. */
const SHOWN_GRACE = 3 * 60 * 60 * 1000;
const MAX_THEME_BONUS = 5;
const MAX_MOOD_BONUS = 3;
const TAG_SATURATION = 6;
const JITTER = 1.5;
/** Movies the profile wants to watch: on their Plex Watchlist or added with "Watchlist" in a pick. */
const WATCHLIST_BONUS = 6;
/** Movies the profile asked for in Seerr and hasn't watched yet. */
const REQUEST_BONUS = 8;
/**
 * Movies that just arrived: half of what a household watches is under a month old in the library.
 * The bonus fades with the days since the movie's file arrived, not since Radarr added it: a movie
 * requested before its release would look old by the time it lands.
 */
const ADDED_BONUS = 12;
const ADDED_FADE_DAYS = 21;
/** The "Added … ago" chip shows while the bonus is at least this (about two weeks). */
const ADDED_CHIP_BONUS = 6;
/**
 * Taste: points per standard deviation of likeness to what the profile watched, among the movies
 * being ranked, and the most it can add or take away. Scaled down while there's little history.
 */
const TASTE_POINTS = 6;
const TASTE_MAX = 12;
/** The "Because you watched …" chip shows when taste added at least this. */
const TASTE_CHIP = 4;
/** The next part of a saga the profile has started. */
export const NEXT_PART_BONUS = 4;
const MIN_RESULTS = 6;
const MAX_RESULTS = 12;

export interface RankedMovie {
  movie: Movie;
  score: number;
  quality: number;
  /** 0 = matches everything, 1 = matches theme or mood, 2 = genre/time only. */
  tier: number;
  reasons: Reason[];
}

/** Small deterministic hash → [0, 1). Keeps the order stable for a day, then rotates it. */
export function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function latestByKind(feedback: FeedbackEvent[], kind: FeedbackEvent['kind']) {
  const map = new Map<number, number>();
  for (const e of feedback) {
    if (e.kind !== kind) continue;
    map.set(e.movieId, Math.max(map.get(e.movieId) ?? 0, e.createdAt));
  }
  return map;
}

/** A tag score as 0..1; anything at or above the saturation point counts fully. */
export function tagStrength(score: number | undefined) {
  return Math.min(score ?? 0, TAG_SATURATION) / TAG_SATURATION;
}

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

export function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

export interface RankOptions {
  now: number;
  seed: string;
  limit?: number;
  /** The profile's Plex Watchlist; local "later" events count too. */
  watchlist?: Set<number>;
  /** Unwatched movies the profile requested in Seerr. */
  requested?: Set<number>;
  /** Movies only other profiles requested: their arrival isn't news to this one. */
  othersRequested?: Set<number>;
  sagas?: SagaState;
  /** What the profile tends to watch (see taste.ts), or each person's, when several watch together. */
  taste?: TasteProfile | TasteProfile[];
  /** When several watch together: whose request and whose watchlist each wanted movie is, for its chips. */
  wantedBy?: Map<number, WantedBy>;
}

/** A profile's taste, learned from what it watched. */
export interface TasteProfile {
  /** Whose taste it is, when several watch together; the chip says "you" without one. */
  name?: string;
  /** How much taste counts: 0 without any history, nearing 1 with plenty. */
  confidence: number;
  /** How much a movie resembles what the profile watched, 0 to 1. */
  affinity(m: Movie): number;
  /** The watched movie a pick resembles most, to explain it. */
  because(m: Movie): Movie | null;
}

/** One person's taste points: likeness compared with the other movies being ranked. */
function memberTastePoints(pool: Movie[], taste: TasteProfile): Map<number, number> {
  const out = new Map<number, number>();
  if (!taste.confidence || pool.length < 2) return out;
  const likeness = pool.map((m) => taste.affinity(m));
  const mean = likeness.reduce((a, b) => a + b, 0) / likeness.length;
  const sd = Math.sqrt(likeness.reduce((a, x) => a + (x - mean) ** 2, 0) / likeness.length);
  if (sd < 1e-6) return out;
  pool.forEach((m, i) => {
    const points = (TASTE_POINTS * taste.confidence * (likeness[i]! - mean)) / sd;
    out.set(m.id, Math.max(-TASTE_MAX, Math.min(TASTE_MAX, points)));
  });
  return out;
}

/**
 * Taste points per movie, and whose taste each follows most. For several people, a movie gets half their
 * average plus half the lowest, so nobody's least favourite wins. People without a history are left out.
 */
function blendTaste(pool: Movie[], taste?: TasteProfile | TasteProfile[]) {
  const members = (Array.isArray(taste) ? taste : taste ? [taste] : []).filter((t) => t.confidence);
  const points = new Map<number, number>();
  const leader = new Map<number, TasteProfile>();
  if (members.length === 1) {
    for (const [id, p] of memberTastePoints(pool, members[0]!)) {
      points.set(id, p);
      leader.set(id, members[0]!);
    }
  } else if (members.length > 1) {
    const each = members.map((t) => memberTastePoints(pool, t));
    for (const m of pool) {
      const own = each.map((p) => p.get(m.id) ?? 0);
      const mean = own.reduce((a, b) => a + b, 0) / own.length;
      points.set(m.id, (mean + Math.min(...own)) / 2);
      leader.set(m.id, members[own.indexOf(Math.max(...own))]!);
    }
  }
  return { points, leader };
}

/**
 * Taste points per movie: its likeness compared with the other movies being ranked, so taste
 * reorders them without favouring one question's movies over another's.
 */
export function tastePoints(pool: Movie[], taste?: TasteProfile | TasteProfile[]): Map<number, number> {
  return blendTaste(pool, taste).points;
}

function sagaTotals(parts: Movie[]) {
  const quality = parts.reduce((sum, m) => sum + qualityScore(m.ratings), 0) / parts.length;
  const runtime = parts.reduce((sum, m) => sum + (m.runtime ?? 0), 0);
  return { quality, runtime };
}

/** What the profile did lately, looked up once per ranking. */
export interface ProfileSignals {
  /** When each movie was last skipped, and how many times in the last 90 days. */
  skips: Map<number, { last: number; count: number }>;
  /** On how many earlier evenings of the last month each movie was shown. */
  shownEvenings: Map<number, number>;
  wanted: Set<number>;
  requested: Set<number>;
  othersRequested: Set<number>;
  day: string;
}

/** The daily shuffle turns over at this hour, local time, so no evening spans two days. */
const DAY_TURNS_AT_HOUR = 4;

/** The evening `now` belongs to, as YYYY-MM-DD in the local time zone (the server's TZ). */
export function pickingDay(now: number) {
  const d = new Date(now - DAY_TURNS_AT_HOUR * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** When the evening `now` belongs to began: the turnover hour on its picking day. */
export function dayStart(now: number) {
  const d = new Date(now - DAY_TURNS_AT_HOUR * 60 * 60 * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_TURNS_AT_HOUR).getTime();
}

export function profileSignals(feedback: FeedbackEvent[], opts: RankOptions): ProfileSignals {
  const skips = new Map<number, { last: number; count: number }>();
  const shownDays = new Map<number, Set<string>>();
  for (const e of feedback) {
    const age = opts.now - e.createdAt;
    if (e.kind === 'skipped' && age < SKIP_MEMORY) {
      const s = skips.get(e.movieId);
      skips.set(e.movieId, { last: Math.max(s?.last ?? 0, e.createdAt), count: (s?.count ?? 0) + 1 });
    } else if (e.kind === 'shown' && age > SHOWN_GRACE && age < SHOWN_WINDOW) {
      // Shown twice in one evening is still one evening.
      const days = shownDays.get(e.movieId) ?? new Set<string>();
      days.add(pickingDay(e.createdAt));
      shownDays.set(e.movieId, days);
    }
  }
  return {
    skips,
    shownEvenings: new Map([...shownDays].map(([id, days]) => [id, days.size])),
    wanted: new Set([...(opts.watchlist ?? []), ...latestByKind(feedback, 'later').keys()]),
    requested: opts.requested ?? new Set(),
    othersRequested: opts.othersRequested ?? new Set(),
    day: pickingDay(opts.now),
  };
}

/** When the movie arrived in the library: its file's import, or Radarr's added date when that isn't known. */
export function arrivalTime(m: Movie): number | null {
  const t = Date.parse(m.arrivedAt ?? m.addedAt ?? '');
  return Number.isFinite(t) ? t : null;
}

/** Days since the movie arrived, or null when unknown. */
function daysInLibrary(m: Movie, now: number): number | null {
  const at = arrivalTime(m);
  return at == null ? null : Math.max(0, (now - at) / DAY);
}

/** "Just arrived" offers the movies that arrived this recently. */
export const JUST_ARRIVED_DAYS = 30;

/** Whether the movie is among those "Just arrived" offers at `now`. */
export function arrivedLately(m: Movie, now: number) {
  const days = daysInLibrary(m, now);
  return days != null && days <= JUST_ARRIVED_DAYS;
}

/** A movie set on the season's holiday itself gets this much on the season's shortcut, so those lead it. */
const SEASON_BONUS = 5;

/** The season the evening of `now` belongs to, if any. */
export function seasonFor(now: number): SeasonDef | null {
  const month = Number(pickingDay(now).slice(5, 7));
  return SEASONS.find((s) => s.month === month) ?? null;
}

/** Whether one of the movie's keywords holds a holiday term, as a whole word: "halloween party" does. */
function onHoliday(m: Movie, season: SeasonDef) {
  return m.keywords.some((k) => [...keywordPhrases(k)].some((p) => season.keywords.includes(p)));
}

function inSeason(m: Movie, season: SeasonDef) {
  return (
    onHoliday(m, season) ||
    Boolean(season.genres?.some((g) => m.genres.includes(g))) ||
    Boolean(season.themes?.some((t) => (m.themes[t] ?? 0) > 0))
  );
}

/** Whether the movie belongs on the shortcut's shelf; without one, every movie does. */
export function matchesShelf(m: Movie, shelf: string | null | undefined, now: number) {
  if (!shelf) return true;
  if (shelf === JUST_ARRIVED.id) return arrivedLately(m, now);
  const season = seasonById.get(shelf);
  return season ? inSeason(m, season) : false;
}

/** Skip and shown penalties, the request or watchlist bonus, the newly added bonus and the daily jitter. */
export function personalAdjustment(m: Movie, s: ProfileSignals, opts: RankOptions) {
  let delta = 0;
  const skip = s.skips.get(m.id);
  if (skip && opts.now - skip.last < SKIP_WINDOW * skip.count) delta -= SKIP_PENALTY;
  delta -= Math.min(SHOWN_PENALTY_MAX, SHOWN_PENALTY * (s.shownEvenings.get(m.id) ?? 0));
  const onWatchlist = s.wanted.has(m.id);
  const requested = s.requested.has(m.id);
  // Seerr can auto-request Watchlist items, so the two bonuses don't stack: it's one wish.
  delta += requested ? REQUEST_BONUS : onWatchlist ? WATCHLIST_BONUS : 0;
  const days = s.othersRequested.has(m.id) ? null : daysInLibrary(m, opts.now);
  const added = days == null ? 0 : ADDED_BONUS * Math.exp(-days / ADDED_FADE_DAYS);
  delta += added;
  delta += (seededUnit(`${opts.seed}|${s.day}|${m.id}`) * 2 - 1) * JITTER;
  return { delta, onWatchlist, requested, addedDaysAgo: added >= ADDED_CHIP_BONUS ? days : null };
}

/** Who wants a movie, when several watch together: who requested it, and whose watchlist it's on. */
export interface WantedBy {
  requested: string[];
  watchlist: string[];
}

/** "Alex", "Alex and Sam", "Alex, Sam and Kids". */
function listNames(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
}

/** Chips for movies the profile wants to watch: requested in Seerr first, then the watchlist. Groups name who. */
export function wantedReasons(adj: { onWatchlist: boolean; requested: boolean }, who?: WantedBy): Reason[] {
  const requested = who?.requested.length ? `${listNames(who.requested)} requested this` : 'You requested this';
  const lists = who?.watchlist.length ?? 0;
  const watchlist = lists
    ? `On ${listNames(who!.watchlist.map((name) => `${name}'s`))} ${lists > 1 ? 'watchlists' : 'watchlist'}`
    : 'On your watchlist';
  return [
    ...(adj.requested ? [{ kind: 'requested' as const, label: requested }] : []),
    ...(adj.onWatchlist ? [{ kind: 'watchlist' as const, label: watchlist }] : []),
  ];
}

/** The chip for a movie that just arrived in the library. */
export function addedReasons(adj: { addedDaysAgo: number | null }): Reason[] {
  if (adj.addedDaysAgo == null) return [];
  const days = Math.floor(adj.addedDaysAgo);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return [{ kind: 'added', label: `Added ${when}` }];
}

/** Best first. Exact matches always lead; close ones only pad a short list. */
export function topRanked(ranked: RankedMovie[], limit = MAX_RESULTS): RankedMovie[] {
  ranked.sort((a, b) => a.tier - b.tier || b.score - a.score);
  const exact = ranked.filter((r) => r.tier === 0);
  if (exact.length >= MIN_RESULTS) return exact.slice(0, limit);
  return ranked.slice(0, Math.max(limit, exact.length));
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
  const startingSaga = c.time === 'saga';
  const season = c.shelf ? seasonById.get(c.shelf) : undefined;

  // "Start a saga" only offers first parts of sagas the profile hasn't started.
  const base = eligible.filter(
    (m) =>
      matchesGenre(m, c.genre) &&
      matchesTime(m, c.time) &&
      matchesShelf(m, c.shelf, opts.now) &&
      (!startingSaga || sagas.starters.has(m.id)),
  );

  // A matching sequel whose earlier part is unwatched brings in that part instead, as long as it
  // fits the genre and time answers, and a season's shortcut. On "Just arrived" it needn't be new.
  const startsFor = new Set<number>();
  if (!startingSaga) {
    const eligibleById = new Map(eligible.map((m) => [m.id, m]));
    const inBase = new Set(base.map((m) => m.id));
    for (const parts of sagas.owned.values()) {
      for (const sequel of parts) {
        const first = eligibleById.get(sagas.blockedBy.get(sequel.id)?.id ?? -1);
        if (!first || !matchesCriteria(sequel, c) || !matchesShelf(sequel, c.shelf, opts.now)) continue;
        if (!matchesGenre(first, c.genre) || !matchesTime(first, c.time)) continue;
        if (season && !inSeason(first, season)) continue;
        startsFor.add(first.id);
        if (!inBase.has(first.id)) {
          base.push(first);
          inBase.add(first.id);
        }
      }
    }
  }

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
    const sagaReasons: Reason[] = [];
    let score = quality;

    const parts = m.saga ? sagas.owned.get(m.saga.id) : undefined;
    if (startingSaga && parts && m.saga) {
      // Judge a saga by all of its parts, not just the first.
      const totals = sagaTotals(parts);
      score = totals.quality;
      sagaReasons.push({ kind: 'saga', label: `Start of ${m.saga.title}` });
      sagaReasons.push({
        kind: 'saga',
        label:
          parts.length === m.saga.parts
            ? `${parts.length} parts, ${formatRuntime(totals.runtime)} in all`
            : `${parts.length} of ${m.saga.parts} parts in your library`,
      });
    } else if (sagas.next.has(m.id) && m.saga) {
      // Also covers a later part pulled in for a sequel: it continues a saga already started.
      score += NEXT_PART_BONUS;
      sagaReasons.push({ kind: 'saga', label: `Next in ${m.saga.title}` });
    } else if (startsFor.has(m.id) && m.saga) {
      sagaReasons.push({ kind: 'saga', label: `Start of ${m.saga.title}` });
    }
    if (c.theme) score += MAX_THEME_BONUS * tagStrength(m.themes[c.theme]);
    if (c.mood) score += MAX_MOOD_BONUS * tagStrength(m.moods[c.mood]);
    if (season && onHoliday(m, season)) score += SEASON_BONUS;
    score += taste.get(m.id) ?? 0;

    const adj = personalAdjustment(m, signals, opts);
    score += adj.delta;

    // On "Just arrived" every new arrival says when it came, also once its bonus no longer would.
    const listedNew = c.shelf === JUST_ARRIVED.id && arrivedLately(m, opts.now);
    const arrived = { addedDaysAgo: adj.addedDaysAgo ?? (listedNew ? daysInLibrary(m, opts.now) : null) };
    const personal = [...wantedReasons(adj, opts.wantedBy?.get(m.id)), ...sagaReasons, ...addedReasons(arrived)];
    tasteChipAt.set(m.id, personal.length);
    return {
      movie: m,
      score: Math.round(score * 10) / 10,
      quality,
      tier: tierOf(m),
      reasons: [...personal, ...reasonsFor(m, c)],
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

// ---------------------------------------------------------------------------
// Wizard facets
// ---------------------------------------------------------------------------

export interface FacetOptions {
  /** Picks the best image for a movie (fanart for wide cards, poster for tiles). */
  image: (m: Movie, kind: 'fanart' | 'poster') => string | null;
  /** First parts of sagas the profile hasn't started, for the "Start a saga" answer. */
  sagaStarters?: Set<number>;
  /** The moment the first question's shortcuts are for. Without it, they're left out. */
  now?: number;
}

function byQuality(a: Movie, b: Movie) {
  return qualityScore(b.ratings) - qualityScore(a.ratings);
}

function topImages(
  movies: Movie[],
  kind: 'fanart' | 'poster',
  count: number,
  opts: FacetOptions,
  used?: Set<number>,
): string[] {
  const out: string[] = [];
  const sorted = [...movies].sort(byQuality);
  // Prefer movies not already featured on another card.
  const ordered = used ? [...sorted.filter((m) => !used.has(m.id)), ...sorted.filter((m) => used.has(m.id))] : sorted;
  for (const m of ordered) {
    const url = opts.image(m, kind);
    if (!url) continue;
    out.push(url);
    used?.add(m.id);
    if (out.length >= count) break;
  }
  return out;
}

/** A shortcut's card on the first question, featuring the best of its movies. */
function shelfOption(def: ShelfDef, movies: Movie[], opts: FacetOptions, used: Set<number>): WizardOption {
  const { id, label, icon, color } = def;
  return { id, label, icon, color, count: movies.length, images: topImages(movies, 'fanart', 1, opts, used) };
}

/** The first question's shortcuts that have enough movies behind them at `now`. */
function shelfOptions(pool: Movie[], now: number, opts: FacetOptions, used: Set<number>): WizardOption[] {
  const out: WizardOption[] = [];
  const fresh = pool.filter((m) => arrivedLately(m, now));
  // A library imported last week isn't all news: only offered while it's at most half of what's left to watch.
  if (fresh.length >= MIN_OPTION_COUNT && fresh.length <= pool.length / 2) {
    out.push(shelfOption(JUST_ARRIVED, fresh, opts, used));
  }
  // However much of the library is the season's: a library of horror is all Halloween.
  const season = seasonFor(now);
  const seasonal = season ? pool.filter((m) => inSeason(m, season)) : [];
  if (season && seasonal.length >= MIN_OPTION_COUNT) out.push(shelfOption(season, seasonal, opts, used));
  return out;
}

/** Movies matching every answer given before `step`. */
export function candidatesBefore(eligible: Movie[], step: WizardStep, c: Criteria): Movie[] {
  return eligible.filter((m) => {
    if (step === 'genre') return true;
    if (!matchesGenre(m, c.genre)) return false;
    if (step === 'theme') return true;
    if (!matchesTheme(m, c.theme)) return false;
    if (step === 'mood') return true;
    return matchesMood(m, c.mood);
  });
}

export function wizardOptions(
  eligible: Movie[],
  step: WizardStep,
  c: Criteria,
  opts: FacetOptions,
): WizardOptionsResponse {
  const pool = candidatesBefore(eligible, step, c);
  const total = pool.length;
  let options: WizardOption[] = [];
  let shelves: WizardOption[] | undefined;

  if (step === 'genre') {
    const used = new Set<number>();
    // The shortcuts come first on screen, so they get the first pick of images.
    if (opts.now != null) shelves = shelfOptions(pool, opts.now, opts, used);
    const counted = GENRES.map((g) => ({ g, movies: pool.filter((m) => m.genres.includes(g.id)) }))
      .filter(({ movies }) => movies.length >= MIN_OPTION_COUNT)
      .sort((a, b) => b.movies.length - a.movies.length);
    options = counted.map(({ g, movies }) => ({
      id: g.id,
      label: g.label,
      icon: g.icon,
      color: g.color,
      count: movies.length,
      images: topImages(movies, 'fanart', 1, opts, used),
    }));
  } else if (step === 'theme') {
    const used = new Set<number>();
    options = THEMES.map((t) => ({ t, movies: pool.filter((m) => (m.themes[t.id] ?? 0) > 0) }))
      .filter(({ movies }) => movies.length >= MIN_OPTION_COUNT)
      .sort((a, b) => b.movies.length - a.movies.length)
      .map(({ t, movies }) => ({
        id: t.id,
        label: t.label,
        icon: t.icon,
        count: movies.length,
        images: topImages(movies, 'poster', 3, opts, used),
      }));
  } else if (step === 'mood') {
    const used = new Set<number>();
    options = MOODS.map((md) => ({ md, movies: pool.filter((m) => (m.moods[md.id] ?? 0) > 0) }))
      .filter(({ movies }) => movies.length >= MIN_OPTION_COUNT)
      .map(({ md, movies }) => ({
        id: md.id,
        label: md.label,
        description: md.description,
        icon: md.icon,
        count: movies.length,
        images: topImages(movies, 'fanart', 1, opts, used),
      }));
  } else {
    options = TIME_OPTIONS.map((t) => ({
      t,
      movies: pool.filter((m) => (t.id === 'saga' ? opts.sagaStarters?.has(m.id) : matchesTime(m, t.id))),
    }))
      // "Any length" is always offered; one saga is enough to offer starting it.
      .filter(({ t, movies }) =>
        t.id === 'saga' ? movies.length > 0 : t.maxRuntime == null || movies.length >= MIN_OPTION_COUNT,
      )
      .map(({ t, movies }) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: t.icon,
        count: movies.length,
        images: [],
      }));
  }

  // A step is pointless when the pool is tiny or there is no real choice to make.
  // Time always has "any length", so a single shorter option is still a choice;
  // a theme/mood question with one answer is not worth asking.
  const narrowing = options.filter((o) => o.count < total);
  const minChoices = step === 'time' ? 1 : 2;
  const skip = step !== 'genre' && (total <= MIN_OPTION_COUNT || narrowing.length < minChoices);

  return shelves ? { step, total, options, skip, shelves } : { step, total, options, skip };
}
