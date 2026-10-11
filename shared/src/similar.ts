import { emptySagaState } from './sagas.js';
import {
  NEXT_PART_BONUS,
  addedReasons,
  personalAdjustment,
  profileSignals,
  qualityScore,
  tagStrength,
  topRanked,
  wantedReasons,
  type RankOptions,
  type RankedMovie,
} from './scoring.js';
import { keywordPhrases } from './tagger.js';
import { moodById, themeById, type MoodDef, type ThemeDef } from './taxonomy.js';
import type { FeedbackEvent, Movie, Reason } from './types.js';

/**
 * "Something like…": ranks movies by how much of a liked movie's signature they share.
 * A signature weighs each TMDB keyword by how rare it is in the library, plus the movie's
 * themes, moods and genres. Two signatures are compared by cosine similarity.
 */

/** TMDB bookkeeping keywords that say nothing about the movie itself. */
export const IGNORED_KEYWORDS = new Set(['duringcreditsstinger', 'aftercreditsstinger', 'woman director', 'sequel', 'prequel']);
const THEME_WEIGHT = 4;
const MOOD_WEIGHT = 2;
const GENRE_WEIGHT = 1;
/** Similarity (0..1) in points; the rating mostly breaks near-ties. */
const SIMILARITY_POINTS = 100;
const QUALITY_SHARE = 0.3;
const MAX_TAG_REASONS = 4;
/** A strong match is at least this similar compared with the closest movie. */
const STRONG_SHARE = 0.4;

export type Signature = Map<string, number>;

function usableKeywords(m: Movie): Set<string> {
  const out = new Set<string>();
  for (const raw of m.keywords) {
    const k = raw.toLowerCase().trim();
    if (k && !IGNORED_KEYWORDS.has(k)) out.add(k);
  }
  return out;
}

/** How telling each keyword is: one shared by a handful of movies says more than one most movies have. */
export function keywordIdf(library: Movie[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const m of library) for (const k of usableKeywords(m)) df.set(k, (df.get(k) ?? 0) + 1);
  const n = library.length;
  return new Map([...df].map(([k, count]) => [k, Math.log(1 + n / count)]));
}

/** A tag only exists once it passes its threshold, so having it counts for half. */
const tagWeight = (score: number) => 0.5 + 0.5 * tagStrength(score);

export function signature(m: Movie, idf: Map<string, number>): Signature {
  const sig: Signature = new Map();
  for (const k of usableKeywords(m)) sig.set(`k:${k}`, idf.get(k) ?? 0);
  for (const [id, score] of Object.entries(m.themes)) sig.set(`t:${id}`, THEME_WEIGHT * tagWeight(score));
  for (const [id, score] of Object.entries(m.moods)) sig.set(`m:${id}`, MOOD_WEIGHT * tagWeight(score));
  for (const g of m.genres) sig.set(`g:${g}`, GENRE_WEIGHT);
  return sig;
}

function norm(s: Signature) {
  let sum = 0;
  for (const w of s.values()) sum += w * w;
  return Math.sqrt(sum);
}

/** Cosine similarity, 0 (nothing in common) to 1 (the same signature). */
export function similarity(a: Signature, b: Signature): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [feature, w] of small) dot += w * (large.get(feature) ?? 0);
  const n = norm(a) * norm(b);
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
  const idf = keywordIdf(library);
  const likedSig = signature(liked, idf);
  const likedKeywords = usableKeywords(liked);
  const signals = profileSignals(feedback, opts);
  const sagas = opts.sagas ?? emptySagaState();

  const candidates = eligible.flatMap((m) => {
    if (m.id === liked.id || (liked.saga && m.saga?.id === liked.saga.id)) return [];
    const sim = similarity(likedSig, signature(m, idf));
    return sim > 0 ? [{ m, sim }] : [];
  });
  const strongSim = STRONG_SHARE * Math.max(0, ...candidates.map((c) => c.sim));

  const ranked = candidates.map(({ m, sim }): RankedMovie => {
    const shared: Shared = {
      themes: sharedTags(liked.themes, m.themes),
      moods: sharedTags(liked.moods, m.moods),
      keywords: [...usableKeywords(m)]
        .filter((k) => likedKeywords.has(k))
        .sort((x, y) => (idf.get(y) ?? 0) - (idf.get(x) ?? 0)),
    };
    const quality = qualityScore(m.ratings);
    const adj = personalAdjustment(m, signals, opts);
    let score = SIMILARITY_POINTS * sim + QUALITY_SHARE * quality + adj.delta;

    const sagaReasons: Reason[] = [];
    if (sagas.next.has(m.id) && m.saga) {
      score += NEXT_PART_BONUS;
      sagaReasons.push({ kind: 'saga', label: `Next in ${m.saga.title}` });
    }

    // A shared genre or mood alone, or one small thing in common, makes only a loose match.
    const strong = sim >= strongSim && (shared.themes.length > 0 || shared.keywords.length >= 2);
    return {
      movie: m,
      score: Math.round(score * 10) / 10,
      quality,
      tier: strong ? 0 : 1,
      reasons: [
        ...wantedReasons(adj),
        ...sagaReasons,
        ...addedReasons(adj),
        ...tagReasons(shared),
      ],
    };
  });
  return topRanked(ranked, opts.limit);
}
