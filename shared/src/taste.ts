import { dayStart, type TasteProfile } from './scoring.js';
import { libraryIndex, norm, type IndexEntry, type Signature } from './similar.js';
import type { FeedbackEvent, Movie } from './types.js';

/**
 * A profile's taste: what the movies it watched have in common, compared the way "Something like…"
 * compares two movies (TMDB keywords weighted by rarity, themes, moods and genres). Recent watches
 * count most. `npm run eval` measures how well it predicts what a profile goes on to watch.
 */

const DAY = 24 * 60 * 60 * 1000;
/** A watch counts half as much after this many days. */
const HALF_LIFE_DAYS = 60;
/** Watches with no date count as this old. */
const UNDATED_DAYS = 365;
/** Taste counts for half once a profile has this many watches, and for nothing without any. */
const HALF_CONFIDENCE_WATCHES = 10;
/** "Seen it" says a movie was watched somewhere, not that it was liked. */
const SEEN_WEIGHT = 0.3;
/**
 * "Seen it" also marks the movie watched on the media server, which dates the watch that moment, and the
 * next sync reads it back. A watch this close to such a mark is the mark (allowing for the server's clock).
 */
const ECHO_MS = 10 * 60 * 1000;

export interface TasteEvent {
  movieId: number;
  /** When, or null if unknown. */
  at: number | null;
  weight: number;
}

/** Tells the media server's watches that are only its copy of a "Seen it" mark Curatorr made there. */
export function seenEchoes(feedback: FeedbackEvent[]) {
  const marked = new Map<number, number[]>();
  for (const e of feedback) {
    if (e.kind === 'seen' && e.serverSynced) marked.set(e.movieId, [...(marked.get(e.movieId) ?? []), e.createdAt]);
  }
  return (w: { movieId: number; viewedAt: number | null }) =>
    w.viewedAt != null && (marked.get(w.movieId) ?? []).some((at) => Math.abs(at - w.viewedAt!) <= ECHO_MS);
}

/** Plex watches, plays started from Curatorr and "Seen it" marks: one event per movie, the strongest. */
export function tasteEvents(
  watched: { movieId: number; viewedAt: number | null }[],
  feedback: FeedbackEvent[],
): TasteEvent[] {
  const best = new Map<number, TasteEvent>();
  const add = (e: TasteEvent) => {
    const current = best.get(e.movieId);
    if (!current || e.weight > current.weight || (e.weight === current.weight && (e.at ?? 0) > (current.at ?? 0))) {
      best.set(e.movieId, e);
    }
  };
  const echo = seenEchoes(feedback);
  for (const w of watched) if (!echo(w)) add({ movieId: w.movieId, at: w.viewedAt, weight: 1 });
  for (const e of feedback) {
    if (e.kind === 'accepted') add({ movieId: e.movieId, at: e.createdAt, weight: 1 });
    else if (e.kind === 'seen') add({ movieId: e.movieId, at: e.createdAt, weight: SEEN_WEIGHT });
  }
  return [...best.values()];
}

/** Cosine between an entry and a vector of known length. */
function cosine(a: IndexEntry, b: Signature, bNorm: number) {
  let dot = 0;
  for (const [feature, w] of a.sig) dot += w * (b.get(feature) ?? 0);
  return a.norm && bNorm ? dot / (a.norm * bNorm) : 0;
}

/**
 * The profile's taste at `now`, from `events` over `library` (every movie, for keyword rarity).
 * Tonight's watches only count from tomorrow, so the picks stay put all evening.
 */
export function tasteProfile(library: Movie[], events: TasteEvent[], now: number): TasteProfile {
  const index = libraryIndex(library).entries;
  const since = dayStart(now);
  const vector: Signature = new Map();
  const watched: { entry: IndexEntry; weight: number }[] = [];
  for (const e of events) {
    if (e.at != null && e.at >= since) continue;
    const entry = index.get(e.movieId);
    if (!entry?.norm) continue;
    const ageDays = e.at == null ? UNDATED_DAYS : (since - e.at) / DAY;
    const weight = e.weight * 0.5 ** (ageDays / HALF_LIFE_DAYS);
    for (const [feature, w] of entry.sig) vector.set(feature, (vector.get(feature) ?? 0) + (weight * w) / entry.norm);
    watched.push({ entry, weight });
  }
  const size = norm(vector);
  return {
    confidence: size ? watched.length / (watched.length + HALF_CONFIDENCE_WATCHES) : 0,
    affinity(m) {
      const entry = index.get(m.id);
      return entry ? cosine(entry, vector, size) : 0;
    },
    because(m) {
      // The taste vector is a sum over watched movies, so the biggest term of the likeness is the
      // watched movie that contributes most to it.
      const entry = index.get(m.id);
      if (!entry) return null;
      let best: Movie | null = null;
      let most = 0;
      for (const w of watched) {
        if (w.entry.movie.id === m.id) continue;
        const share = w.weight * cosine(entry, w.entry.sig, w.entry.norm);
        if (share > most) {
          most = share;
          best = w.entry.movie;
        }
      }
      return best;
    },
  };
}
