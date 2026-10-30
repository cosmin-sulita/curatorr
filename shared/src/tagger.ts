import { normalizeKeyword } from './text.js';
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
/** With fewer keywords than this, the overview is read as well. */
const SPARSE_KEYWORDS = 5;
const THEME_THRESHOLD = 2;

type TermIndex = Map<string, { id: string; weight: number }[]>;

interface Vocabulary {
  terms: TermIndex;
  /** Per tag id: whole keywords that never count toward it. */
  excluded: Map<string, Set<string>>;
}

function addTerms(index: TermIndex, id: string, terms: string[] | undefined, weight: number) {
  for (const raw of terms ?? []) {
    const term = raw.toLowerCase();
    const list = index.get(term) ?? [];
    list.push({ id, weight });
    index.set(term, list);
  }
}

function buildVocabulary(defs: (ThemeDef | MoodDef)[]): Vocabulary {
  const terms: TermIndex = new Map();
  const excluded = new Map<string, Set<string>>();
  for (const def of defs) {
    addTerms(terms, def.id, def.strong, STRONG);
    addTerms(terms, def.id, def.weak, WEAK);
    addTerms(terms, def.id, (def as MoodDef).negative, -STRONG);
    if (def.exclude?.length) excluded.set(def.id, new Set(def.exclude.map((k) => k.toLowerCase())));
  }
  return { terms, excluded };
}

const themeVocabulary = buildVocabulary(THEMES);
const moodVocabulary = buildVocabulary(MOODS);

/** The longest run of a keyword's words a term can match inside it. Longer terms only match a keyword exactly. */
const MAX_PHRASE_WORDS = 4;

/**
 * All phrases a keyword can satisfy: the whole keyword plus every run of up to four consecutive words, so "zombie
 * apocalypse" yields "zombie", "apocalypse" and "zombie apocalypse". A five-word term like "based on a true story"
 * matches only that keyword.
 */
export function keywordPhrases(keyword: string): Set<string> {
  const normalized = normalizeKeyword(keyword);
  const phrases = new Set<string>([normalized]);
  const words = normalized.split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= Math.min(words.length, start + MAX_PHRASE_WORDS); end++) {
      phrases.add(words.slice(start, end).join(' '));
    }
  }
  return phrases;
}

/** Whether any theme or mood term matches the keyword, whole or as a run of its words. */
export function inVocabulary(keyword: string): boolean {
  for (const phrase of keywordPhrases(keyword)) {
    if (themeVocabulary.terms.has(phrase) || moodVocabulary.terms.has(phrase)) return true;
  }
  return false;
}

function push(map: Map<string, TagEvidence[]>, id: string, evidence: TagEvidence) {
  const list = map.get(id) ?? [];
  list.push(evidence);
  map.set(id, list);
}

/**
 * Keyword evidence per tag id. Each keyword counts once per tag, through its best term (the
 * whole keyword wins a tie), and each term counts once per tag. So "based on true story" isn't
 * also counted as "true story", and "casino" plus "casino owner" count as one.
 */
function keywordEvidence(keywords: string[], vocabulary: Vocabulary): Map<string, TagEvidence[]> {
  const out = new Map<string, TagEvidence[]>();
  const used = new Set<string>();
  for (const raw of keywords) {
    const keyword = normalizeKeyword(raw);
    const best = new Map<string, { term: string; weight: number }>();
    for (const phrase of keywordPhrases(keyword)) {
      for (const hit of vocabulary.terms.get(phrase) ?? []) {
        if (used.has(`${hit.id}|${phrase}`) || vocabulary.excluded.get(hit.id)?.has(keyword)) continue;
        const current = best.get(hit.id);
        if (current && Math.abs(current.weight) >= Math.abs(hit.weight)) continue;
        best.set(hit.id, { term: phrase, weight: hit.weight });
      }
    }
    for (const [id, { term, weight }] of best) {
      used.add(`${id}|${term}`);
      push(out, id, { source: 'keyword', term, keyword, weight });
    }
  }
  return out;
}

const total = (evidence: TagEvidence[]) => evidence.reduce((sum, e) => sum + e.weight, 0);

function round(n: number) {
  return Math.round(n * 10) / 10;
}

// Weak terms are often a side detail ("army", "computer"), so they only add to a tag that has
// stronger evidence: a strong term, an implying genre or the plot for themes; a genre lean, a
// strong term or the runtime bonus for moods.
const backsTheme = (e: TagEvidence) => e.source !== 'keyword' || e.weight >= STRONG;
const backsMood = (e: TagEvidence) => e.weight > 0 && (e.source !== 'keyword' || e.weight >= STRONG);

function themeTagged(theme: ThemeDef, evidence: TagEvidence[]) {
  return total(evidence) >= (theme.threshold ?? THEME_THRESHOLD) && evidence.some(backsTheme);
}

function explainThemes(movie: TaggableMovie): TagExplanations {
  const fromKeywords = keywordEvidence(movie.keywords, themeVocabulary);
  const scored = THEMES.map((theme) => {
    const evidence = [...(fromKeywords.get(theme.id) ?? [])];
    const genre = theme.genres?.find((g) => movie.genres.includes(g));
    if (genre) evidence.push({ source: 'genre', term: genre, weight: GENRE_IMPLIES });
    return { theme, evidence };
  });

  // The plot fills in when keywords are sparse or don't tag anything.
  const sparse = movie.keywords.length < SPARSE_KEYWORDS;
  if (sparse || !scored.some(({ theme, evidence }) => themeTagged(theme, evidence))) {
    const overview = movie.overview.toLowerCase();
    for (const { theme, evidence } of scored) {
      // Idioms come out first, so "haunted by his past" isn't read as a haunting.
      const plot = theme.overviewExclude ? overview.replaceAll(theme.overviewExclude, ' ') : overview;
      const words = theme.overview?.exec(plot);
      if (words) evidence.push({ source: 'overview', term: words[0], weight: OVERVIEW_HIT });
    }
  }

  const out: TagExplanations = {};
  for (const { theme, evidence } of scored) {
    if (!evidence.length) continue;
    out[theme.id] = { score: round(total(evidence)), tagged: themeTagged(theme, evidence), evidence };
  }
  return out;
}

function explainMoods(movie: TaggableMovie): TagExplanations {
  const fromKeywords = keywordEvidence(movie.keywords, moodVocabulary);

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
    out[mood.id] = { score: round(score), tagged: score >= mood.threshold && evidence.some(backsMood), evidence };
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
