import { emptySagaState } from './sagas.js';
import { addedReasons, personalAdjustment, profileSignals, wantedReasons } from './personal.js';
import { qualityScore } from './quality.js';
import { NEXT_PART_BONUS, tagStrength, topRanked, type RankOptions, type RankedMovie } from './ranking.js';
import { keywordPhrases } from './tagger.js';
import { normalizeKeyword } from './text.js';
import { moodById, themeById, type MoodDef, type ThemeDef } from './taxonomy.js';
import type { FeedbackEvent, Movie, Reason } from './types.js';

/**
 * "Something like…": ranks movies by how much of a liked movie's signature they share.
 * A signature weighs each TMDB keyword by how rare it is in the library, plus the movie's
 * themes, moods and genres. Two signatures are compared by cosine similarity, a short one
 * counting as long as a typical movie's.
 */

/** TMDB bookkeeping keywords that say nothing about the movie itself. */
export const IGNORED_KEYWORDS = new Set(['duringcreditsstinger', 'aftercreditsstinger', 'woman director', 'sequel', 'prequel']);
/**
 * TMDB's tone words (absurd, amused, suspenseful…) say how a movie feels to someone, which the moods already
 * capture, not what happens in it. Contributors add them unevenly: The Woman in the Yard is "absurd" and
 * "suspense", and so is a Jack Ryan movie, so as keywords they made unrelated movies look alike.
 */
const TONE_KEYWORDS = new Set([
  'absurd', 'admiring', 'adoring', 'affectation', 'aggressive', 'ambiguous', 'ambivalent', 'amused', 'angry',
  'antagonistic', 'anxious', 'appreciative', 'approving', 'arrogant', 'assertive', 'audacious', 'awestruck', 'baffled',
  'bewildered', 'biting', 'bitter', 'bleak', 'blunt', 'bold', 'callous', 'calm', 'campy', 'candid', 'cautionary',
  'celebratory', 'cheerful', 'cliché', 'clinical', 'comforting', 'commanding', 'compassionate', 'complex',
  'complicated', 'conceited', 'critical', 'cruel', 'curious', 'cynical', 'dark', 'defiant', 'demeaning', 'depressing',
  'derisive', 'didactic', 'disdainful', 'disgusted', 'disturbed', 'distressing', 'dramatic', 'dreary', 'earnest',
  'embarrassed', 'empathetic', 'energetic', 'enthusiastic', 'excited', 'exhilarated', 'exuberant', 'farcical',
  'foreboding', 'frantic', 'frightened', 'frustrated', 'furious', 'ghoulish', 'gloomy', 'grand', 'grim', 'gritty',
  'hard', 'harsh', 'hilarious', 'hopeful', 'hopeless', 'horrified', 'hostile', 'inflammatory', 'informative',
  'insecure', 'inspirational', 'intense', 'intimate', 'ironic', 'joyful', 'joyous', 'light-hearted', 'lighthearted',
  'loving', 'macabre', 'malicious', 'melancholy', 'melodramatic', 'mischievous', 'mocking', 'modest', 'mysterious',
  'nostalgic', 'ominous', 'optimistic', 'philosophical', 'playful', 'powerful', 'pretentious', 'provocative',
  'reflective', 'respectful', 'ridiculous', 'romantic', 'sarcastic', 'satirical', 'scathing', 'sentimental', 'serene',
  'serious', 'shocking', 'sincere', 'sinister', 'skeptical', 'somber', 'suspense', 'suspenseful', 'sympathetic',
  'tense', 'thoughtful', 'tragic', 'vibrant', 'vindictive', 'whimsical', 'wistful', 'witty', 'wonder', 'wry', 'zealous',
]);
const THEME_WEIGHT = 4;
const MOOD_WEIGHT = 2;
const GENRE_WEIGHT = 1;
/**
 * Likeness in points: the closest match gets them all, the others their share. The rating and personal bonuses
 * then only reorder movies about as alike, instead of outweighing likeness when every movie shares little.
 */
const SIMILARITY_POINTS = 100;
const QUALITY_SHARE = 0.3;
const MAX_TAG_REASONS = 4;
/** A strong match is at least this similar compared with the closest movie. */
const STRONG_SHARE = 0.4;

export type Signature = Map<string, number>;

function usableKeywords(m: Movie): Set<string> {
  const out = new Set<string>();
  for (const raw of m.keywords) {
    const k = normalizeKeyword(raw);
    if (k && !IGNORED_KEYWORDS.has(k) && !TONE_KEYWORDS.has(k)) out.add(k);
  }
  return out;
}

/** Document frequency to rarity, from each movie's usable keywords. */
function idfOf(keywords: Set<string>[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const set of keywords) for (const k of set) df.set(k, (df.get(k) ?? 0) + 1);
  const n = keywords.length;
  return new Map([...df].map(([k, count]) => [k, Math.log(1 + n / count)]));
}

/** How telling each keyword is: one shared by a handful of movies says more than one most movies have. */
export function keywordIdf(library: Movie[]): Map<string, number> {
  return idfOf(library.map(usableKeywords));
}

/** A tag only exists once it passes its threshold, so having it counts for half. */
const tagWeight = (score: number) => 0.5 + 0.5 * tagStrength(score);

function signatureOf(m: Movie, keywords: Set<string>, idf: Map<string, number>): Signature {
  const sig: Signature = new Map();
  for (const k of keywords) sig.set(`k:${k}`, idf.get(k) ?? 0);
  for (const [id, score] of Object.entries(m.themes)) sig.set(`t:${id}`, THEME_WEIGHT * tagWeight(score));
  for (const [id, score] of Object.entries(m.moods)) sig.set(`m:${id}`, MOOD_WEIGHT * tagWeight(score));
  for (const g of m.genres) sig.set(`g:${g}`, GENRE_WEIGHT);
  return sig;
}

export function signature(m: Movie, idf: Map<string, number>): Signature {
  return signatureOf(m, usableKeywords(m), idf);
}

export function norm(s: Signature) {
  let sum = 0;
  for (const w of s.values()) sum += w * w;
  return Math.sqrt(sum);
}

export interface IndexEntry {
  movie: Movie;
  sig: Signature;
  norm: number;
  /** The keywords it counts, for what it shares with another movie. */
  keywords: Set<string>;
}

function indexEntry(m: Movie, keywords: Set<string>, idf: Map<string, number>): IndexEntry {
  const sig = signatureOf(m, keywords, idf);
  return { movie: m, sig, norm: norm(sig), keywords };
}

/** A library's keyword rarity and every movie's signature. */
export interface LibraryIndex {
  idf: Map<string, number>;
  entries: Map<number, IndexEntry>;
  /** How long a typical movie's signature is: the median, leaving out movies with none. */
  typicalNorm: number;
}

const indexes = new WeakMap<Movie[], LibraryIndex>();

/** Worked out once per library: the store keeps the same array until the next sync. */
export function libraryIndex(library: Movie[]): LibraryIndex {
  let index = indexes.get(library);
  if (!index) {
    const keywords = library.map(usableKeywords);
    const idf = idfOf(keywords);
    const entries = new Map(library.map((m, i) => [m.id, indexEntry(m, keywords[i]!, idf)] as const));
    const norms = [...entries.values()].map((e) => e.norm).filter((n) => n > 0).sort((a, b) => a - b);
    index = { idf, entries, typicalNorm: norms[Math.floor(norms.length / 2)] ?? 0 };
    indexes.set(library, index);
  }
  return index;
}

/**
 * Cosine similarity, 0 (nothing in common) to 1 (the same signature). A signature shorter than `minNorm`
 * counts as that long: a movie TMDB knows little about isn't all about the one thing it shares.
 */
export function similarity(a: Signature, b: Signature, minNorm = 0): number {
  return cosine(a, norm(a), b, norm(b), minNorm);
}

/** `similarity` with both lengths known, as the library's index keeps them. */
export function cosine(a: Signature, aNorm: number, b: Signature, bNorm: number, minNorm: number): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [feature, w] of small) dot += w * (large.get(feature) ?? 0);
  const n = Math.max(aNorm, minNorm) * Math.max(bNorm, minNorm);
  return n ? dot / n : 0;
}

interface Shared {
  themes: string[];
  moods: string[];
  /** Rarest first. */
  keywords: string[];
}

/** Tags both movies carry, strongest in both first. */
function sharedTags(a: Record<string, number>, b: Record<string, number>) {
  return Object.keys(b)
    .filter((id) => (a[id] ?? 0) > 0)
    .sort((x, y) => Math.min(a[y]!, b[y]!) - Math.min(a[x]!, b[x]!));
}

function termsOf(def: ThemeDef | MoodDef | undefined): string[] {
  return [...(def?.strong ?? []), ...(def?.weak ?? [])].map((t) => t.toLowerCase());
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Chips for the pick screen: shared themes, then keywords they don't already cover, then a mood. */
function tagReasons(shared: Shared): Reason[] {
  const covered = new Set([
    ...shared.themes.flatMap((id) => termsOf(themeById.get(id))),
    ...shared.moods.flatMap((id) => termsOf(moodById.get(id))),
  ]);
  const keywords = shared.keywords.filter((k) => ![...keywordPhrases(k)].some((p) => covered.has(p)));
  return [
    ...shared.themes.slice(0, 2).map((id): Reason => ({ kind: 'theme', label: themeById.get(id)?.label ?? id })),
    ...keywords.slice(0, 2).map((k): Reason => ({ kind: 'keyword', label: sentenceCase(k) })),
    ...shared.moods.slice(0, 1).map((id): Reason => ({ kind: 'mood', label: moodById.get(id)?.label ?? id })),
  ].slice(0, MAX_TAG_REASONS);
}

/**
 * Ranks eligible movies by likeness to `liked`. `library` is every movie, for keyword rarity.
 * The liked movie's own saga is left out: the regular picks already offer its next part.
 */
export function rankSimilar(
  eligible: Movie[],
  liked: Movie,
  library: Movie[],
  feedback: FeedbackEvent[],
  opts: RankOptions,
): RankedMovie[] {
  const { idf, entries, typicalNorm } = libraryIndex(library);
  // Every movie is in its library's index; one that isn't is worked out on the spot.
  const entryOf = (m: Movie) => entries.get(m.id) ?? indexEntry(m, usableKeywords(m), idf);
  const likedEntry = entryOf(liked);
  const signals = profileSignals(feedback, opts);
  const sagas = opts.sagas ?? emptySagaState();

  const candidates = eligible.flatMap((m) => {
    if (m.id === liked.id || (liked.saga && m.saga?.id === liked.saga.id)) return [];
    const entry = entryOf(m);
    const sim = cosine(likedEntry.sig, likedEntry.norm, entry.sig, entry.norm, typicalNorm);
    return sim > 0 ? [{ m, entry, sim }] : [];
  });
  const best = Math.max(0, ...candidates.map((c) => c.sim));
  const strongSim = STRONG_SHARE * best;

  // The chips are only worked out for the picks that are returned, a dozen of a library's worth.
  type Detail = { entry: IndexEntry; adj: ReturnType<typeof personalAdjustment>; next: boolean };
  const details = new Map<RankedMovie, Detail>();
  const ranked = candidates.map(({ m, entry, sim }): RankedMovie => {
    const quality = qualityScore(m.ratings);
    const adj = personalAdjustment(m, signals, opts);
    let score = SIMILARITY_POINTS * (sim / best) + QUALITY_SHARE * quality + adj.delta;
    const next = Boolean(sagas.next.has(m.id) && m.saga);
    if (next) score += NEXT_PART_BONUS;

    // A shared genre or mood alone, or one small thing in common, makes only a loose match.
    const sharesTheme = Object.keys(m.themes).some((id) => (liked.themes[id] ?? 0) > 0);
    const strong = sim >= strongSim && (sharesTheme || countShared(likedEntry.keywords, entry.keywords) >= 2);
    const r: RankedMovie = { movie: m, score: Math.round(score * 10) / 10, quality, tier: strong ? 0 : 1, reasons: [] };
    details.set(r, { entry, adj, next });
    return r;
  });

  const top = topRanked(ranked, opts.limit);
  for (const r of top) {
    const { entry, adj, next } = details.get(r)!;
    const m = r.movie;
    const shared: Shared = {
      themes: sharedTags(liked.themes, m.themes),
      moods: sharedTags(liked.moods, m.moods),
      keywords: [...entry.keywords]
        .filter((k) => likedEntry.keywords.has(k))
        .sort((x, y) => (idf.get(y) ?? 0) - (idf.get(x) ?? 0)),
    };
    const sagaReasons: Reason[] = next ? [{ kind: 'saga', label: `Next in ${m.saga!.title}` }] : [];
    r.reasons = [
      ...wantedReasons(adj, opts.wantedBy?.get(m.id)),
      ...sagaReasons,
      ...addedReasons(adj),
      ...tagReasons(shared),
    ];
  }
  return top;
}

/** How many of `b` are in `a`. */
function countShared(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const k of b) if (a.has(k)) n++;
  return n;
}
