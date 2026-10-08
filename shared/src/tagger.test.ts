import { describe, expect, it } from 'vitest';
import { moodById, themeById } from './taxonomy.js';
import { TAGGED_MOVIES } from './tagger.fixtures.js';
import { explainTags, inVocabulary, keywordPhrases, tagMoods, tagMovie, tagThemes } from './tagger.js';

const base = { genres: [], keywords: [], overview: '', runtime: 110 };

describe('keywordPhrases', () => {
  it('yields the whole keyword and every word run', () => {
    expect([...keywordPhrases('Zombie Apocalypse')]).toEqual(['zombie apocalypse', 'zombie', 'apocalypse']);
  });

  it('reads non-breaking hyphens as plain ones', () => {
    expect(keywordPhrases('human\u2011animal bond')).toContain('human-animal bond');
  });

  it('knows which keywords the vocabulary covers', () => {
    expect(inVocabulary('zombie apocalypse')).toBe(true);
    expect(inVocabulary('new york city')).toBe(false);
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

  it('only lets weak keywords back up a stronger signal', () => {
    // Contagion's outbreak, virus and pandemic don't make a zombie movie.
    const contagion = { ...base, keywords: ['outbreak', 'virus', 'pandemic', 'epidemic'] };
    expect(tagThemes(contagion)).not.toHaveProperty('zombies');
    expect(tagThemes({ ...base, keywords: ['zombie', 'outbreak'] }).zombies).toBe(3);
  });

  it('counts a keyword once per theme, through its best term', () => {
    expect(explainTags({ ...base, keywords: ['computer hacker'] }).themes['ai-robots']?.score).toBe(1);
    expect(tagThemes({ ...base, keywords: ['based on true story'] })['true-story']).toBe(2);
  });

  it('counts a term once, however many keywords contain it', () => {
    expect(tagThemes({ ...base, keywords: ['heist', 'casino', 'casino owner'] }).heist).toBe(3);
  });

  it('ignores idioms a theme excludes, while other themes still read them', () => {
    expect(explainTags({ ...base, keywords: ['cat and mouse'] }).themes).not.toHaveProperty('animals');
    expect(tagThemes({ ...base, keywords: ['cold war', 'soldier'] }).war).toBe(2);
    expect(explainTags({ ...base, keywords: ['cold war'] }).themes.spies?.score).toBe(1);
  });

  it('asks for more where one keyword is often a side detail', () => {
    expect(tagThemes({ ...base, keywords: ['dog'] })).not.toHaveProperty('animals');
    expect(tagThemes({ ...base, keywords: ['dog', 'police dog'] })).toHaveProperty('animals');
  });

  it('lets genres imply themes', () => {
    expect(tagThemes({ ...base, genres: ['Romance'] })).toHaveProperty('romance');
  });

  it('falls back to the overview when keywords are sparse or tag nothing', () => {
    const overview = 'A family moves into a house haunted by ghosts.';
    expect(tagThemes({ ...base, overview })).toHaveProperty('supernatural');
    const untagged = { ...base, overview, keywords: ['family', 'house', 'move', 'suburb', 'parents', 'kids'] };
    expect(tagThemes(untagged)).toHaveProperty('supernatural');
    expect(tagThemes({ ...untagged, keywords: [...untagged.keywords, 'heist'] })).not.toHaveProperty('supernatural');
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
    const twisty = { ...base, genres: ['Science Fiction'], keywords: ['twist ending'] };
    expect(tagMoods(twisty)).toHaveProperty('mind-bending');
  });

  it('only lets cheerful tone words back up a genre lean', () => {
    // TMDB calls The Shawshank Redemption "amused".
    expect(tagMoods({ ...base, genres: ['Drama', 'Crime'], keywords: ['amused'] })).not.toHaveProperty('light');
    expect(tagMoods({ ...base, genres: ['Family'], keywords: ['amused'] })).toHaveProperty('light');
  });

  it('pulls family movies away from dark', () => {
    expect(tagMoods({ ...base, genres: ['Family', 'Animation'], keywords: ['grief'] })).not.toHaveProperty('dark');
  });

  it('gives long adventures an epic boost', () => {
    const quest = { ...base, genres: ['Adventure', 'Fantasy'], runtime: 178 };
    expect(tagMoods(quest)).toHaveProperty('epic');
    expect(tagMoods({ ...quest, runtime: 95 })).not.toHaveProperty('epic');
  });

  it('keeps very long movies out of light', () => {
    const comedy = { ...base, genres: ['Comedy'] };
    expect(tagMoods({ ...comedy, runtime: 165 })).not.toHaveProperty('light');
  });
});

describe('explainTags', () => {
  it('names the keyword and term behind each tag', () => {
    const { themes } = explainTags({ ...base, keywords: ['zombie apocalypse'] });
    expect(themes.zombies?.evidence).toEqual([
      { source: 'keyword', term: 'zombie apocalypse', keyword: 'zombie apocalypse', weight: 2 },
    ]);
    expect(themes.dystopia?.evidence).toEqual([
      { source: 'keyword', term: 'apocalypse', keyword: 'zombie apocalypse', weight: 2 },
    ]);
  });

  it('keeps near misses, untagged', () => {
    expect(explainTags({ ...base, keywords: ['outbreak'] }).themes.zombies).toMatchObject({ score: 1, tagged: false });
  });
});

describe('real TMDB keywords', () => {
  it('only names themes and moods that exist', () => {
    for (const m of TAGGED_MOVIES) {
      const themes = [...(m.themes ?? []), ...(m.notThemes ?? [])];
      const moods = [...(m.moods ?? []), ...(m.notMoods ?? [])];
      for (const id of themes) expect(themeById.has(id), `${m.title}: ${id}`).toBe(true);
      for (const id of moods) expect(moodById.has(id), `${m.title}: ${id}`).toBe(true);
    }
  });

  it.each(TAGGED_MOVIES)('tags $title', (movie) => {
    const { themes, moods } = tagMovie(movie);
    for (const id of movie.themes ?? []) expect(themes, `theme ${id}`).toHaveProperty(id);
    for (const id of movie.notThemes ?? []) expect(themes, `no theme ${id}`).not.toHaveProperty(id);
    for (const id of movie.moods ?? []) expect(moods, `mood ${id}`).toHaveProperty(id);
    for (const id of movie.notMoods ?? []) expect(moods, `no mood ${id}`).not.toHaveProperty(id);
  });
});
