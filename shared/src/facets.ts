// The wizard's questions: which answers to offer, how many movies each keeps, their pictures, and when to skip one.
import { matchesGenre, matchesMood, matchesTheme, matchesTime } from './criteria.js';
import { qualityScore } from './quality.js';
import { MAX_RESULTS } from './ranking.js';
import { arrivedLately, inSeason, seasonFor } from './shelves.js';
import { GENRES, JUST_ARRIVED, MIN_OPTION_COUNT, MOODS, SAGA_TIME, THEMES, TIME_OPTIONS, type ShelfDef } from './taxonomy.js';
import type { Criteria, Movie, WizardOption, WizardOptionsResponse, WizardStep } from './types.js';

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
function candidatesBefore(eligible: Movie[], step: WizardStep, c: Criteria): Movie[] {
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
  /** An answer worth offering keeps enough movies and leaves some out: one that keeps them all is "no preference". */
  const narrows = (count: number) => count >= MIN_OPTION_COUNT && count < total;
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
      .filter(({ movies }) => narrows(movies.length))
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
      .filter(({ movies }) => narrows(movies.length))
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
      movies: pool.filter((m) => (t.id === SAGA_TIME ? opts.sagaStarters?.has(m.id) : matchesTime(m, t.id))),
    }))
      // "Any length" is always offered; one saga is enough to offer starting it.
      .filter(({ t, movies }) => (t.id === SAGA_TIME ? movies.length > 0 : t.maxRuntime == null || narrows(movies.length)))
      .map(({ t, movies }) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: t.icon,
        count: movies.length,
        images: [],
      }));
  }

  // A step is pointless once the picks can show every movie left, or when there is no real choice to make.
  // Time always has "any length", so a single shorter option is still a choice;
  // a theme/mood question with one answer is not worth asking.
  const narrowing = options.filter((o) => o.count < total);
  const minChoices = step === 'time' ? 1 : 2;
  const skip = step !== 'genre' && (total <= MAX_RESULTS || narrowing.length < minChoices);

  return shelves ? { step, total, options, skip, shelves } : { step, total, options, skip };
}
