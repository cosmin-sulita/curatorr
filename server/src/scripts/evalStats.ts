// The statistics `npm run eval` measures ranking changes with. Pure, so they're tested (evalStats.test.ts): an error
// here would mislead every ranking decision quietly.

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
/** Half the width of a mean's 95% interval. */
export const margin = (xs: number[]) => (1.96 * sd(xs)) / Math.sqrt(xs.length);

/** The share of the others that `xs[i]` is above, ties counting half: 0.5 says nothing about it. */
export function beats(xs: number[], i: number) {
  let wins = 0;
  xs.forEach((x, j) => {
    if (j !== i) wins += xs[i]! > x ? 1 : xs[i] === x ? 0.5 : 0;
  });
  return wins / (xs.length - 1);
}

/** The value `q` of the way through `xs` once sorted (0 the least, 1 the most), between neighbours. */
export function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo);
}

/** Deterministic random numbers, so the intervals don't change between runs. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1 + 1/2 + … + 1/n: n times the mean reciprocal rank of a random order. */
export function harmonic(n: number) {
  let h = 0;
  for (let i = 1; i <= n; i++) h += 1 / i;
  return h;
}

/** How one watch fared for one question. */
export interface Result {
  /** Reciprocal rank: 1 first, 1/2 second… 0 when it wasn't among the matches. */
  rr: number;
  /** First, and among the first `top` (one list of picks). */
  h1: number;
  h12: number;
  /** Where it ranked, 0 first to 1 last. */
  pctl: number;
  /** The same, ranking the matches by rating alone (best first), for reference. */
  rrRated: number;
  /** Expected at random. */
  rrRandom: number;
  h12Random: number;
}

/**
 * One watch's result: the watched movie came `pos`th (from 0; -1 when it wasn't among the `n` matches), and `posRated`th
 * by rating alone.
 */
export function resultOf(pos: number, posRated: number, n: number, top = 12): Result {
  const random = { rrRandom: n ? harmonic(n) / n : 0, h12Random: n ? Math.min(top, n) / n : 0 };
  if (pos < 0) return { rr: 0, h1: 0, h12: 0, pctl: 1, rrRated: 0, ...random };
  return {
    rr: 1 / (pos + 1),
    h1: Number(pos === 0),
    h12: Number(pos < top),
    pctl: n > 1 ? pos / (n - 1) : 0,
    rrRated: 1 / (posRated + 1),
    ...random,
  };
}

/** The mean of `diffs`, redrawn `draws` times with replacement: its 2.5% and 97.5% quantiles make a 95% interval. */
export function bootstrapMeans(diffs: number[], draws = 2000, seed = 42): number[] {
  const draw = random(seed);
  const out: number[] = [];
  for (let i = 0; i < draws; i++) {
    let sum = 0;
    for (let j = 0; j < diffs.length; j++) sum += diffs[Math.floor(draw() * diffs.length)]!;
    out.push(sum / diffs.length);
  }
  return out;
}
