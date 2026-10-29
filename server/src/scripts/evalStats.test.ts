import { describe, expect, it } from 'vitest';
import { beats, bootstrapMeans, harmonic, margin, mean, quantile, random, resultOf, sd } from './evalStats.js';

describe("eval's statistics", () => {
  it('averages and spreads', () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(mean([])).toBeNaN();
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(margin([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo((1.96 * 2) / Math.sqrt(8), 12);
  });

  it('takes quantiles between neighbours, whatever the order given', () => {
    expect(quantile([3, 1, 2, 4], 0)).toBe(1);
    expect(quantile([3, 1, 2, 4], 1)).toBe(4);
    expect(quantile([3, 1, 2, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20], 0.25)).toBe(12.5);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('tells how much of the rest one value beats, ties counting half', () => {
    expect(beats([5, 1, 2, 3], 0)).toBe(1);
    expect(beats([1, 5, 2, 3], 0)).toBe(0);
    expect(beats([2, 2, 1], 0)).toBe(0.75);
  });

  it('scores a watch by where it ranked, and what chance would give', () => {
    expect(resultOf(0, 2, 10)).toMatchObject({ rr: 1, h1: 1, h12: 1, pctl: 0, rrRated: 1 / 3 });
    expect(resultOf(12, 0, 20)).toMatchObject({ rr: 1 / 13, h1: 0, h12: 0, pctl: 12 / 19, rrRated: 1 });
    expect(resultOf(-1, -1, 4)).toMatchObject({ rr: 0, h12: 0, pctl: 1, rrRated: 0 });
    // At random, the mean reciprocal rank of n is H(n)/n, and a list of 12 holds 12 of them.
    expect(resultOf(3, 3, 4).rrRandom).toBeCloseTo(harmonic(4) / 4, 12);
    expect(resultOf(3, 3, 30).h12Random).toBe(12 / 30);
    expect(resultOf(0, 0, 0)).toMatchObject({ rrRandom: 0, h12Random: 0 });
  });

  it('draws the same numbers from the same seed, so intervals hold between runs', () => {
    const a = random(42);
    const b = random(42);
    const draws = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(draws);
    for (const x of draws) expect(x >= 0 && x < 1).toBe(true);
  });

  it('bootstraps a mean around the sample mean, the same way for paired samples', () => {
    const diffs = [0.1, -0.05, 0.2, 0, 0.05, 0.15, -0.1, 0.1];
    const boot = bootstrapMeans(diffs);
    expect(boot).toHaveLength(2000);
    expect(mean(boot)).toBeCloseTo(mean(diffs), 2);
    expect(quantile(boot, 0.025)).toBeLessThan(mean(diffs));
    expect(quantile(boot, 0.975)).toBeGreaterThan(mean(diffs));
    // Two measures of the same watches redraw the same watches.
    expect(bootstrapMeans(diffs.map((d) => d * 2))).toEqual(boot.map((m) => m * 2));
  });
});
