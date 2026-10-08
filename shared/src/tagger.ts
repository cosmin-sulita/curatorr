import { MOODS, THEMES, type MoodDef, type ThemeDef } from './taxonomy.js';
import type { TagScores } from './types.js';

export interface TaggableMovie {
  genres: string[];
  keywords: string[];
  overview: string;
  runtime: number | null;
}

/** One reason a movie leans toward (or away from) a tag. */
export interface TagEvidence {
  source: 'keyword' | 'genre' | 'overview' | 'runtime';
  /** The vocabulary term, genre, overview words or runtime rule that matched. */
  term: string;
  /** For keyword evidence: the movie's keyword the term was found in. */
  keyword?: string;
  weight: number;
}

/** How a movie scores for one tag, and why. Tags with no evidence at all are left out. */
export interface TagExplanation {
  score: number;
  tagged: boolean;
  evidence: TagEvidence[];
}

export type TagExplanations = Record<string, TagExplanation>;

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

function buildIndex(defs: (ThemeDef | MoodDef)[]): TermIndex {
  const index: TermIndex = new Map();
  for (const def of defs) {
    addTerms(index, def.id, def.strong, STRONG);
    addTerms(index, def.id, def.weak, WEAK);
    addTerms(index, def.id, (def as MoodDef).negative, -STRONG);
  }
  return index;
}

const themeIndex = buildIndex(THEMES);
const moodIndex = buildIndex(MOODS);

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

/** Whether any theme or mood term matches the keyword, whole or as a run of its words. */
export function inVocabulary(keyword: string): boolean {
  for (const phrase of keywordPhrases(keyword)) {
    if (themeIndex.has(phrase) || moodIndex.has(phrase)) return true;
  }
  return false;
}

function push(map: Map<string, TagEvidence[]>, id: string, evidence: TagEvidence) {
  const list = map.get(id) ?? [];
  list.push(evidence);
  map.set(id, list);
}

/** Keyword evidence per tag id, counting each (tag, term) pair once. */
function keywordEvidence(keywords: string[], index: TermIndex): Map<string, TagEvidence[]> {
  const out = new Map<string, TagEvidence[]>();
  const seen = new Set<string>();
  for (const keyword of keywords) {
    for (const phrase of keywordPhrases(keyword)) {
      for (const hit of index.get(phrase) ?? []) {
        const key = `${hit.id}|${phrase}`;
        if (seen.has(key)) continue;
        seen.add(key);
        push(out, hit.id, { source: 'keyword', term: phrase, keyword, weight: hit.weight });
      }
    }
  }
  return out;
}

const total = (evidence: TagEvidence[]) => evidence.reduce((sum, e) => sum + e.weight, 0);

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function explainThemes(movie: TaggableMovie): TagExplanations {
  const fromKeywords = keywordEvidence(movie.keywords, themeIndex);
  const overview = movie.overview.toLowerCase();
  const sparse = movie.keywords.length < SPARSE_KEYWORDS;

  const out: TagExplanations = {};
  for (const theme of THEMES) {
    const evidence = [...(fromKeywords.get(theme.id) ?? [])];
    const genre = theme.genres?.find((g) => movie.genres.includes(g));
    if (genre) evidence.push({ source: 'genre', term: genre, weight: GENRE_IMPLIES });
    const words = sparse ? theme.overview?.exec(overview) : null;
    if (words) evidence.push({ source: 'overview', term: words[0], weight: OVERVIEW_HIT });
    if (!evidence.length) continue;
    const score = total(evidence);
    out[theme.id] = { score: round(score), tagged: score >= THEME_THRESHOLD, evidence };
  }
  return out;
}

function explainMoods(movie: TaggableMovie): TagExplanations {
  const fromKeywords = keywordEvidence(movie.keywords, moodIndex);

  const out: TagExplanations = {};
  for (const mood of MOODS) {
    if (mood.excludeGenres?.some((g) => movie.genres.includes(g))) continue;

    const evidence = [...(fromKeywords.get(mood.id) ?? [])];
    for (const genre of movie.genres) {
      const weight = (mood.genres[genre] ?? 0) - (mood.negativeGenres?.[genre] ?? 0);
      if (weight) evidence.push({ source: 'genre', term: genre, weight });
    }
    const bonus = movie.runtime ? mood.runtimeBonus?.find((b) => movie.runtime! >= b.min) : undefined;
    if (bonus) evidence.push({ source: 'runtime', term: `${bonus.min}+ min`, weight: bonus.bonus });
    if (!evidence.length) continue;
    const score = total(evidence);
    out[mood.id] = { score: round(score), tagged: score >= mood.threshold, evidence };
  }
  return out;
}

/** Every theme and mood the movie has any evidence for, with its score and whether it's tagged. */
export function explainTags(movie: TaggableMovie): { themes: TagExplanations; moods: TagExplanations } {
  return { themes: explainThemes(movie), moods: explainMoods(movie) };
}

function taggedScores(explanations: TagExplanations): TagScores {
  const out: TagScores = {};
  for (const [id, e] of Object.entries(explanations)) if (e.tagged) out[id] = e.score;
  return out;
}

export function tagThemes(movie: TaggableMovie): TagScores {
  return taggedScores(explainThemes(movie));
}

export function tagMoods(movie: TaggableMovie): TagScores {
  return taggedScores(explainMoods(movie));
}

export function tagMovie(movie: TaggableMovie): { themes: TagScores; moods: TagScores } {
  const { themes, moods } = explainTags(movie);
  return { themes: taggedScores(themes), moods: taggedScores(moods) };
}
