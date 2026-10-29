import { describe, expect, it } from 'vitest';
import { SURPRISE_URL, answersBefore, criteriaFrom, isStep, nextUrl } from './criteria';
import { withQuery } from './url';

describe('answers in the address', () => {
  it('reads every answer, and none as null', () => {
    expect(criteriaFrom(new URLSearchParams('genre=Comedy&mood=light'))).toEqual({
      genre: 'Comedy',
      theme: null,
      mood: 'light',
      time: null,
      shelf: null,
    });
  });

  it('moves on to the next question with the answers so far, and to a pick after the last', () => {
    expect(nextUrl('genre', {}, 'Comedy')).toBe('/ask/theme?genre=Comedy');
    expect(nextUrl('theme', { genre: 'Comedy' }, 'heist')).toBe('/ask/mood?genre=Comedy&theme=heist');
    expect(nextUrl('time', { genre: 'Comedy', theme: 'heist', mood: 'any' }, 'quick')).toBe(
      '/pick?genre=Comedy&theme=heist&mood=any&time=quick',
    );
  });

  it('drops the answers to later questions when one is asked again (going back)', () => {
    const later = { genre: 'Comedy', theme: 'heist', mood: 'light', time: 'quick' };
    expect(answersBefore('theme', later)).toEqual({ genre: 'Comedy' });
    expect(nextUrl('theme', later, 'space')).toBe('/ask/mood?genre=Comedy&theme=space');
  });

  it('round-trips: what an address says is what the next one carries on from', () => {
    const url = nextUrl('mood', criteriaFrom(new URLSearchParams('genre=Horror&theme=zombies')), 'dark');
    expect(criteriaFrom(new URL(url, 'http://x').searchParams)).toMatchObject({ genre: 'Horror', theme: 'zombies', mood: 'dark' });
  });

  it('knows the questions, and "Surprise me" answers none of them', () => {
    expect(isStep('mood')).toBe(true);
    expect(isStep('pick')).toBe(false);
    expect(isStep(undefined)).toBe(false);
    expect(SURPRISE_URL).toBe('/pick?genre=any&theme=any&mood=any&time=any');
  });

  it('leaves empty values out of an address', () => {
    expect(withQuery('/like', { q: '', id: null, page: '2' })).toBe('/like?page=2');
    expect(withQuery('/pick', {})).toBe('/pick');
  });
});
