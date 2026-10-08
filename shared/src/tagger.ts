import { MOODS, THEMES, type MoodDef, type ThemeDef } from './taxonomy.js';
import type { TagScores } from './types.js';

export interface TaggableMovie {
  genres: string[];
  keywords: string[];
  overview: string;
  runtime: number | null;
}

const STRONG = 2;
const WEAK = 1;
const GENRE_IMPLIES = 2;
const OVERVIEW_HIT = 2;
/** Overview text is only consulted when TMDB keywords are sparse. */
const SPARSE_KEYWORDS = 5;
const THEME_THRESHOLD = 2;

type TermIndex = Map<string, { id: string; weight: number }[]>;

function addTerms(index: TermIndex, id: string, terms: string[] | undefined, weight: number) {
  for (const raw of terms ?? []) {
    const term = raw.toLowerCase();
    const list = index.get(term) ?? [];
    list.push({ id, weight });
    index.set(term, list);
  }
}

function buildIndex(defs: (ThemeDef | MoodDef)[], negative = false): TermIndex {
  const index: TermIndex = new Map();
  for (const def of defs) {
    if (negative) {
      addTerms(index, def.id, (def as MoodDef).negative, -STRONG);
    } else {
      addTerms(index, def.id, def.strong, STRONG);
      addTerms(index, def.id, def.weak, WEAK);
    }
  }
  return index;
}

const themeIndex = buildIndex(THEMES);
const moodIndex = buildIndex(MOODS);
const moodNegativeIndex = buildIndex(MOODS, true);

/**
 * All phrases a keyword can satisfy: the whole keyword plus every run of
 * consecutive words, so "zombie apocalypse" yields "zombie", "apocalypse"
 * and "zombie apocalypse".
 */
export function keywordPhrases(keyword: string): Set<string> {
  const normalized = keyword.toLowerCase().trim();
  const phrases = new Set<string>([normalized]);
  const words = normalized.split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= Math.min(words.length, start + 4); end++) {
      phrases.add(words.slice(start, end).join(' '));
    }
  }
  return phrases;
}

/** Sums term weights per tag id, counting each (tag, term) pair once. */
function scoreTerms(keywords: string[], index: TermIndex): Map<string, number> {
  const scores = new Map<string, number>();
  const seen = new Set<string>();
  for (const keyword of keywords) {
    for (const phrase of keywordPhrases(keyword)) {
      for (const hit of index.get(phrase) ?? []) {
        const key = `${hit.id}|${phrase}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scores.set(hit.id, (scores.get(hit.id) ?? 0) + hit.weight);
      }
    }
  }
  return scores;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

export function tagThemes(movie: TaggableMovie): TagScores {
  const scores = scoreTerms(movie.keywords, themeIndex);
  const overview = movie.overview.toLowerCase();
  const sparse = movie.keywords.length < SPARSE_KEYWORDS;

  const result: TagScores = {};
  for (const theme of THEMES) {
    let score = scores.get(theme.id) ?? 0;
    if (theme.genres?.some((g) => movie.genres.includes(g))) score += GENRE_IMPLIES;
    if (sparse && theme.overview?.test(overview)) score += OVERVIEW_HIT;
    if (score >= THEME_THRESHOLD) result[theme.id] = round(score);
  }
  return result;
}

export function tagMoods(movie: TaggableMovie): TagScores {
  const scores = scoreTerms(movie.keywords, moodIndex);
  const negatives = scoreTerms(movie.keywords, moodNegativeIndex);

  const result: TagScores = {};
  for (const mood of MOODS) {
    if (mood.excludeGenres?.some((g) => movie.genres.includes(g))) continue;

    let score = (scores.get(mood.id) ?? 0) + (negatives.get(mood.id) ?? 0);
    for (const genre of movie.genres) {
      score += mood.genres[genre] ?? 0;
      score -= mood.negativeGenres?.[genre] ?? 0;
    }
    if (movie.runtime && mood.runtimeBonus) {
      const bonus = mood.runtimeBonus.find((b) => movie.runtime! >= b.min);
      if (bonus) score += bonus.bonus;
    }
    if (score >= mood.threshold) result[mood.id] = round(score);
  }
  return result;
}

export function tagMovie(movie: TaggableMovie): { themes: TagScores; moods: TagScores } {
  return { themes: tagThemes(movie), moods: tagMoods(movie) };
}
