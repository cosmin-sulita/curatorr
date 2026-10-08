import {
  GENRES,
  MIN_OPTION_COUNT,
  MOODS,
  THEMES,
  TIME_OPTIONS,
  genreById,
  moodById,
  themeById,
  timeById,
} from './taxonomy.js';
import type {
  Criteria,
  FeedbackEvent,
  Movie,
  Ratings,
  Reason,
  WizardOption,
  WizardOptionsResponse,
  WizardStep,
} from './types.js';

// ---------------------------------------------------------------------------
// Quality: Rotten Tomatoes first, other sources as penalised fallbacks.
// ---------------------------------------------------------------------------

export type QualitySource = 'rt' | 'imdb' | 'tmdb' | 'none';

/** RT scores built on few reviews are pulled toward this value. */
const RT_PRIOR = 60;
const RT_PRIOR_WEIGHT = 10;
const RT_MIN_RELIABLE_VOTES = 20;

export function qualityScore(r: Ratings): { value: number; source: QualitySource } {
  if (r.rt != null && r.rt > 0) {
    if (r.rtVotes != null && r.rtVotes > 0 && r.rtVotes < RT_MIN_RELIABLE_VOTES) {
      const shrunk = (r.rt * r.rtVotes + RT_PRIOR * RT_PRIOR_WEIGHT) / (r.rtVotes + RT_PRIOR_WEIGHT);
      return { value: shrunk, source: 'rt' };
    }
    return { value: r.rt, source: 'rt' };
  }
  if (r.imdb != null && r.imdb > 0) return { value: r.imdb * 10 - 5, source: 'imdb' };
  if (r.tmdb != null && r.tmdb > 0) return { value: r.tmdb * 10 - 8, source: 'tmdb' };
  return { value: 50, source: 'none' };
}

// ---------------------------------------------------------------------------
// Eligibility: what a given profile may be offered at all.
// ---------------------------------------------------------------------------

export interface ProfileContext {
  watched: Set<number>;
  feedback: FeedbackEvent[];
  /** Allowed certifications, or null for no restriction. */
  allowedCerts: Set<string> | null;
  /** Only offer movies Plex knows about (so "Watch on Plex" works). */
  requirePlex: boolean;
  includeWatched: boolean;
}

export function excludedIds(ctx: ProfileContext): Set<number> {
  const out = new Set<number>();
  for (const e of ctx.feedback) if (e.kind === 'seen' || e.kind === 'never') out.add(e.movieId);
  if (!ctx.includeWatched) for (const id of ctx.watched) out.add(id);
  return out;
}

export function eligibleMovies(movies: Movie[], ctx: ProfileContext): Movie[] {
  const excluded = excludedIds(ctx);
  return movies.filter((m) => {
    if (excluded.has(m.id)) return false;
    if (ctx.requirePlex && !m.plexRatingKey) return false;
    if (ctx.allowedCerts && (!m.certification || !ctx.allowedCerts.has(m.certification.toUpperCase()))) {
      return false;
    }
    return true;
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
const SKIP_PENALTY = 15;
const SKIP_WINDOW = 14 * DAY;
const SHOWN_PENALTY = 5;
const SHOWN_WINDOW = 3 * DAY;
const MAX_THEME_BONUS = 5;
const MAX_MOOD_BONUS = 3;
const TAG_SATURATION = 6;
const JITTER = 1.5;
const MIN_RESULTS = 6;
const MAX_RESULTS = 12;

export interface RankedMovie {
  movie: Movie;
  score: number;
  quality: number;
  qualitySource: QualitySource;
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

function tagStrength(score: number | undefined) {
  return Math.min(score ?? 0, TAG_SATURATION) / TAG_SATURATION;
}

function reasonsFor(m: Movie, c: Criteria, quality: { value: number; source: QualitySource }): Reason[] {
  const reasons: Reason[] = [];
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
  if (quality.source === 'rt' && quality.value >= 75) {
    reasons.push({ kind: 'rating', label: `${Math.round(m.ratings.rt!)}% on Rotten Tomatoes` });
  } else if (quality.source === 'imdb' && m.ratings.imdb! >= 7.5) {
    reasons.push({ kind: 'rating', label: `${m.ratings.imdb!.toFixed(1)} on IMDb` });
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
  const limit = opts.limit ?? MAX_RESULTS;
  const skipped = latestByKind(feedback, 'skipped');
  const shown = latestByKind(feedback, 'shown');
  const day = new Date(opts.now).toISOString().slice(0, 10);

  const base = eligible.filter((m) => matchesGenre(m, c.genre) && matchesTime(m, c.time));

  const tierOf = (m: Movie): number => {
    const theme = matchesTheme(m, c.theme);
    const mood = matchesMood(m, c.mood);
    if (theme && mood) return 0;
    if (c.theme && c.mood && (theme || mood)) return 1;
    return 2;
  };

  const ranked = base.map((m): RankedMovie => {
    const quality = qualityScore(m.ratings);
    let score = quality.value;
    if (c.theme) score += MAX_THEME_BONUS * tagStrength(m.themes[c.theme]);
    if (c.mood) score += MAX_MOOD_BONUS * tagStrength(m.moods[c.mood]);

    const skippedAt = skipped.get(m.id);
    if (skippedAt && opts.now - skippedAt < SKIP_WINDOW) score -= SKIP_PENALTY;
    const shownAt = shown.get(m.id);
    if (shownAt && opts.now - shownAt < SHOWN_WINDOW) score -= SHOWN_PENALTY;

    score += (seededUnit(`${opts.seed}|${day}|${m.id}`) * 2 - 1) * JITTER;

    return {
      movie: m,
      score: Math.round(score * 10) / 10,
      quality: quality.value,
      qualitySource: quality.source,
      tier: tierOf(m),
      reasons: reasonsFor(m, c, quality),
    };
  });

  ranked.sort((a, b) => a.tier - b.tier || b.score - a.score);

  const exact = ranked.filter((r) => r.tier === 0);
  if (exact.length >= MIN_RESULTS) return exact.slice(0, limit);
  return ranked.slice(0, Math.max(limit, exact.length));
}

// ---------------------------------------------------------------------------
// Wizard facets
// ---------------------------------------------------------------------------

export interface FacetOptions {
  /** Picks the best image for a movie (fanart for wide cards, poster for tiles). */
  image: (m: Movie, kind: 'fanart' | 'poster') => string | null;
}

function byQuality(a: Movie, b: Movie) {
  return qualityScore(b.ratings).value - qualityScore(a.ratings).value;
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

  if (step === 'genre') {
    const used = new Set<number>();
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
    options = THEMES.map((t) => ({ t, movies: pool.filter((m) => (m.themes[t.id] ?? 0) > 0) }))
      .filter(({ movies }) => movies.length >= MIN_OPTION_COUNT)
      .sort((a, b) => b.movies.length - a.movies.length)
      .map(({ t, movies }) => ({
        id: t.id,
        label: t.label,
        icon: t.icon,
        count: movies.length,
        images: topImages(movies, 'poster', 3, opts),
      }));
  } else if (step === 'mood') {
    options = MOODS.map((md) => ({ md, movies: pool.filter((m) => (m.moods[md.id] ?? 0) > 0) }))
      .filter(({ movies }) => movies.length >= MIN_OPTION_COUNT)
      .map(({ md, movies }) => ({
        id: md.id,
        label: md.label,
        description: md.description,
        icon: md.icon,
        count: movies.length,
        images: topImages(movies, 'fanart', 1, opts),
      }));
  } else {
    options = TIME_OPTIONS.map((t) => ({ t, movies: pool.filter((m) => matchesTime(m, t.id)) }))
      .filter(({ t, movies }) => t.maxRuntime == null || movies.length >= MIN_OPTION_COUNT)
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

  return { step, total, options, skip };
}
