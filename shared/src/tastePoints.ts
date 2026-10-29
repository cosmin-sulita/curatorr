// How taste (taste.ts) turns into points in the wizard's picks, for one profile or several watching together.
import type { Movie } from './types.js';

/**
 * Taste: points per standard deviation of likeness to what the profile watched, among the movies
 * being ranked, and the most it can add or take away. Scaled down while there's little history.
 */
const TASTE_POINTS = 6;
const TASTE_MAX = 12;
/** The "Because you watched …" chip shows when taste added at least this. */
export const TASTE_CHIP = 4;

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
export function blendTaste(pool: Movie[], taste?: TasteProfile | TasteProfile[]) {
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
