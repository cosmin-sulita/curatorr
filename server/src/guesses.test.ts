import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Guesses } from './guesses.js';

const MINUTE = 60 * 1000;

describe('Guesses', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  /** Takes `n` tries for the key and returns what each one answered. */
  const take = (guesses: Guesses, key: string | number, n = 1) => Array.from({ length: n }, () => guesses.take(key));

  it('lets five tries go ahead, then pauses the key for ten minutes', () => {
    const guesses = new Guesses();
    expect(take(guesses, 'dad', 5)).toEqual([null, null, null, null, null]);
    expect(guesses.take('dad')).toBe('10 minutes');
    vi.advanceTimersByTime(9 * MINUTE + 1);
    expect(guesses.take('dad')).toBe('a minute');
  });

  it('counts a try before it is checked, so tries in flight together still pause the key', () => {
    const guesses = new Guesses();
    // Nothing has been checked yet: the five are in flight.
    take(guesses, 7, 5);
    expect(guesses.take(7)).toBe('10 minutes');
  });

  it('allows one try per pause once the key is paused', () => {
    const guesses = new Guesses();
    take(guesses, 'dad', 5);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(guesses.take('dad')).toBeNull();
    expect(guesses.take('dad')).toBe('10 minutes');
  });

  it("lifts a pause begun by a try that couldn't be checked", () => {
    const guesses = new Guesses();
    take(guesses, 'dad', 5);
    guesses.refund('dad');
    // Four count: one more may go, and it pauses the key again.
    expect(guesses.take('dad')).toBeNull();
    expect(guesses.take('dad')).toBe('10 minutes');
  });

  it("doesn't let a refund lift a pause after a right try cleared the key", () => {
    const guesses = new Guesses();
    take(guesses, 'dad', 2);
    guesses.hit('dad');
    guesses.refund('dad');
    expect(take(guesses, 'dad', 5)).toEqual([null, null, null, null, null]);
    expect(guesses.take('dad')).toBe('10 minutes');
  });

  it('starts a key afresh after a right try, and keeps keys apart', () => {
    const guesses = new Guesses();
    take(guesses, 'dad', 5);
    take(guesses, 'mum', 4);
    guesses.hit('dad');
    expect(take(guesses, 'dad', 5)).toEqual([null, null, null, null, null]);
    expect(guesses.take('dad')).toBe('10 minutes');
    expect(guesses.take('mum')).toBeNull();
    expect(guesses.take('mum')).toBe('10 minutes');
  });
});
