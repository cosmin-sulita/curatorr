import { describe, expect, it } from 'vitest';
import { keywordPhrases, tagMoods, tagThemes } from './tagger.js';

const base = { genres: [], keywords: [], overview: '', runtime: 110 };

describe('keywordPhrases', () => {
  it('yields the whole keyword and every word run', () => {
    expect([...keywordPhrases('Zombie Apocalypse')]).toEqual(['zombie apocalypse', 'zombie', 'apocalypse']);
  });
});

describe('tagThemes', () => {
  it('tags from a single strong keyword', () => {
    expect(tagThemes({ ...base, keywords: ['superhero'] })).toHaveProperty('superheroes');
  });

  it('matches strong terms inside longer keywords', () => {
    const themes = tagThemes({ ...base, keywords: ['zombie apocalypse', 'shopping mall'] });
    expect(themes.zombies).toBeGreaterThanOrEqual(2);
    expect(themes).toHaveProperty('dystopia');
  });

  it('needs more than one weak signal', () => {
    expect(tagThemes({ ...base, keywords: ['based on comic'] })).not.toHaveProperty('superheroes');
    expect(
      tagThemes({ ...base, keywords: ['based on comic', 'vigilante'] }),
    ).toHaveProperty('superheroes');
  });

  it('lets genres imply themes', () => {
    expect(tagThemes({ ...base, genres: ['Romance'] })).toHaveProperty('romance');
  });

  it('falls back to the overview only when keywords are sparse', () => {
    const overview = 'A family moves into a house haunted by ghosts.';
    expect(tagThemes({ ...base, overview })).toHaveProperty('supernatural');
    const rich = { ...base, overview, keywords: ['family', 'house', 'move', 'suburb', 'parents', 'kids'] };
    expect(tagThemes(rich)).not.toHaveProperty('supernatural');
  });

  it('scores more matching terms higher', () => {
    const one = tagThemes({ ...base, keywords: ['heist'] }).heist!;
    const two = tagThemes({ ...base, keywords: ['heist', 'bank robbery', 'con artist'] }).heist!;
    expect(two).toBeGreaterThan(one);
  });
});

describe('tagMoods', () => {
  it('treats a plain comedy as light', () => {
    expect(tagMoods({ ...base, genres: ['Comedy'] })).toHaveProperty('light');
  });

  it('never calls horror light', () => {
    expect(tagMoods({ ...base, genres: ['Comedy', 'Horror'], keywords: ['hilarious'] })).not.toHaveProperty('light');
  });

  it('uses TMDB tone keywords', () => {
    expect(tagMoods({ ...base, keywords: ['suspenseful'] })).toHaveProperty('edge');
    expect(tagMoods({ ...base, genres: ['Science Fiction'], keywords: ['twist ending'] })).toHaveProperty('mind-bending');
  });

  it('pulls family movies away from dark', () => {
    expect(tagMoods({ ...base, genres: ['Family', 'Animation'], keywords: ['grief'] })).not.toHaveProperty('dark');
  });

  it('gives long adventures an epic boost', () => {
    const lotr = { ...base, genres: ['Adventure', 'Fantasy', 'Action'], runtime: 178 };
    expect(tagMoods(lotr)).toHaveProperty('epic');
    expect(tagMoods({ ...lotr, runtime: 95 })).not.toHaveProperty('epic');
  });
});
