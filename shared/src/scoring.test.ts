import { describe, expect, it } from 'vitest';
import {
  eligibleMovies,
  qualityScore,
  rankMovies,
  wizardOptions,
  type ProfileContext,
} from './scoring.js';
import { sagaState } from './sagas.js';
import type { FeedbackEvent, Movie, Ratings } from './types.js';

const noRatings: Ratings = { rt: null, rtVotes: null, imdb: null, tmdb: null, metacritic: null };

let nextId = 1;
function movie(partial: Partial<Movie> & { ratings?: Partial<Ratings> } = {}): Movie {
  const id = partial.id ?? nextId++;
  return {
    id,
    tmdbId: id,
    imdbId: null,
    title: `Movie ${id}`,
    year: 2000,
    overview: '',
    runtime: 110,
    certification: 'PG-13',
    genres: ['Action'],
    keywords: [],
    themes: {},
    moods: {},
    posterUrl: `poster-${id}`,
    fanartUrl: `fanart-${id}`,
    trailerId: null,
    plexRatingKey: String(id),
    plexSlug: null,
    plexGuid: null,
    saga: null,
    addedAt: null,
    ...partial,
    ratings: { ...noRatings, ...partial.ratings },
  };
}

const ctx = (over: Partial<ProfileContext> = {}): ProfileContext => ({
  watched: new Set(),
  feedback: [],
  allowedCerts: null,
  requirePlex: true,
  includeWatched: false,
  watchlist: new Set(),
  ...over,
});

const NOW = Date.parse('2026-10-08T20:00:00Z');
const rank = (movies: Movie[], c = {}, feedback: FeedbackEvent[] = []) =>
  rankMovies(movies, c, feedback, { now: NOW, seed: 'test' });

describe('qualityScore', () => {
  it('prefers Rotten Tomatoes', () => {
    expect(qualityScore({ ...noRatings, rt: 91, imdb: 6 })).toEqual({ value: 91, source: 'rt' });
  });

  it('falls back to IMDb, then TMDB, with a penalty', () => {
    expect(qualityScore({ ...noRatings, imdb: 8 })).toEqual({ value: 75, source: 'imdb' });
    expect(qualityScore({ ...noRatings, tmdb: 8 })).toEqual({ value: 72, source: 'tmdb' });
    expect(qualityScore(noRatings)).toEqual({ value: 50, source: 'none' });
  });

  it('shrinks RT scores with very few reviews', () => {
    expect(qualityScore({ ...noRatings, rt: 100, rtVotes: 5 }).value).toBeLessThan(80);
  });
});

describe('eligibleMovies', () => {
  it('drops watched, seen, never and unmatched-in-Plex movies', () => {
    const [a, b, c, d, e] = [movie(), movie(), movie(), movie({ plexRatingKey: null }), movie()];
    const feedback: FeedbackEvent[] = [
      { movieId: b!.id, kind: 'seen', createdAt: NOW },
      { movieId: c!.id, kind: 'never', createdAt: NOW },
      { movieId: e!.id, kind: 'skipped', createdAt: NOW },
    ];
    const out = eligibleMovies([a!, b!, c!, d!, e!], ctx({ watched: new Set([a!.id]), feedback }));
    expect(out.map((m) => m.id)).toEqual([e!.id]);
  });

  it('can include watched movies', () => {
    const a = movie();
    expect(eligibleMovies([a], ctx({ watched: new Set([a.id]), includeWatched: true }))).toHaveLength(1);
  });

  it('applies certification restrictions', () => {
    const g = movie({ certification: 'G' });
    const r = movie({ certification: 'R' });
    const none = movie({ certification: null });
    const out = eligibleMovies([g, r, none], ctx({ allowedCerts: new Set(['G', 'PG']) }));
    expect(out).toEqual([g]);
  });
});

describe('rankMovies', () => {
  it('ranks by Rotten Tomatoes score', () => {
    const low = movie({ ratings: { rt: 60 } });
    const high = movie({ ratings: { rt: 95 } });
    const mid = movie({ ratings: { rt: 80 } });
    expect(rank([low, high, mid]).map((r) => r.movie.id)).toEqual([high.id, mid.id, low.id]);
  });

  it('penalises movies skipped recently', () => {
    const a = movie({ ratings: { rt: 90 } });
    const b = movie({ ratings: { rt: 84 } });
    const ranked = rank([a, b], {}, [{ movieId: a.id, kind: 'skipped', createdAt: NOW - 60_000 }]);
    expect(ranked[0]!.movie.id).toBe(b.id);
  });

  it('forgets skips after two weeks', () => {
    const a = movie({ ratings: { rt: 90 } });
    const b = movie({ ratings: { rt: 84 } });
    const ranked = rank([a, b], {}, [{ movieId: a.id, kind: 'skipped', createdAt: NOW - 20 * 86_400_000 }]);
    expect(ranked[0]!.movie.id).toBe(a.id);
  });

  it('keeps a pick shown in the last few hours in place', () => {
    const a = movie({ ratings: { rt: 90 } });
    const fresh = rank([a])[0]!.score;
    const shownTonight = rank([a], {}, [{ movieId: a.id, kind: 'shown', createdAt: NOW - 60 * 60_000 }])[0]!.score;
    expect(shownTonight).toBe(fresh);
  });

  it('still demotes a pick shown yesterday', () => {
    const a = movie({ ratings: { rt: 90 } });
    const fresh = rank([a])[0]!.score;
    const shownYesterday = rank([a], {}, [{ movieId: a.id, kind: 'shown', createdAt: NOW - 86_400_000 }])[0]!.score;
    expect(shownYesterday).toBeCloseTo(fresh - 5, 5);
  });

  it('filters by genre and runtime', () => {
    const action = movie({ genres: ['Action'], runtime: 100 });
    const longAction = movie({ genres: ['Action'], runtime: 170 });
    const comedy = movie({ genres: ['Comedy'], runtime: 90 });
    const ranked = rank([action, longAction, comedy], { genre: 'Action', time: 'quick' });
    expect(ranked.map((r) => r.movie.id)).toEqual([action.id]);
  });

  it('puts exact matches first and pads with close matches', () => {
    const exact = movie({ themes: { heist: 4 }, moods: { light: 3 }, ratings: { rt: 70 } });
    const themeOnly = movie({ themes: { heist: 4 }, ratings: { rt: 99 } });
    const neither = movie({ ratings: { rt: 98 } });
    const ranked = rank([neither, themeOnly, exact], { theme: 'heist', mood: 'light' });
    expect(ranked.map((r) => [r.movie.id, r.tier])).toEqual([
      [exact.id, 0],
      [themeOnly.id, 1],
      [neither.id, 2],
    ]);
  });

  it('returns only exact matches when there are enough', () => {
    const exact = Array.from({ length: 8 }, () => movie({ themes: { heist: 2 } }));
    const other = movie({ ratings: { rt: 100 } });
    const ranked = rank([...exact, other], { theme: 'heist' });
    expect(ranked).toHaveLength(8);
    expect(ranked.every((r) => r.tier === 0)).toBe(true);
  });

  it('favours movies on the Plex Watchlist or saved for later', () => {
    // +6 beats a 2-point rating gap even with the daily jitter (±1.5 each).
    const top = movie({ ratings: { rt: 92 } });
    const listed = movie({ ratings: { rt: 90 } });
    const later = movie({ ratings: { rt: 90 } });
    const ranked = rankMovies([top, listed, later], {}, [{ movieId: later.id, kind: 'later', createdAt: NOW - 1000 }], {
      now: NOW,
      seed: 'test',
      watchlist: new Set([listed.id]),
    });
    expect(ranked[2]!.movie.id).toBe(top.id);
    expect(ranked[2]!.reasons.some((r) => r.kind === 'watchlist')).toBe(false);
    for (const r of ranked.slice(0, 2)) {
      expect(r.reasons[0]).toEqual({ kind: 'watchlist', label: 'On your watchlist' });
    }
  });

  it('explains the pick', () => {
    const m = movie({ genres: ['Action'], themes: { heist: 2 }, ratings: { rt: 92 } });
    const labels = rank([m], { genre: 'Action', theme: 'heist' })[0]!.reasons.map((r) => r.label);
    expect(labels).toEqual(['Action', 'Heists & Cons', '92% on Rotten Tomatoes']);
  });
});

describe('wizardOptions', () => {
  const image = (m: Movie, kind: 'fanart' | 'poster') => (kind === 'fanart' ? m.fanartUrl : m.posterUrl);

  it('only offers genres with enough movies, most popular first', () => {
    const movies = [
      ...Array.from({ length: 5 }, () => movie({ genres: ['Comedy'] })),
      ...Array.from({ length: 3 }, () => movie({ genres: ['Horror'] })),
      ...Array.from({ length: 2 }, () => movie({ genres: ['Western'] })),
    ];
    const res = wizardOptions(movies, 'genre', {}, { image });
    expect(res.options.map((o) => [o.id, o.count])).toEqual([
      ['Comedy', 5],
      ['Horror', 3],
    ]);
    expect(res.total).toBe(10);
  });

  it('features a different movie on each genre card', () => {
    const shared = movie({ genres: ['Action', 'Adventure'], ratings: { rt: 100 } });
    const movies = [shared, ...Array.from({ length: 4 }, () => movie({ genres: ['Action', 'Adventure'] }))];
    const res = wizardOptions(movies, 'genre', {}, { image });
    const imgs = res.options.map((o) => o.images[0]);
    expect(new Set(imgs).size).toBe(imgs.length);
  });

  it('leads each theme with a different poster when it can', () => {
    const movies = [100, 95, 90, 85].map((rt) => movie({ themes: { space: 2, aliens: 2 }, ratings: { rt } }));
    const res = wizardOptions(movies, 'theme', {}, { image });
    const leads = res.options.map((o) => o.images[0]);
    expect(leads).toHaveLength(2);
    expect(new Set(leads).size).toBe(2);
    expect(res.options.every((o) => o.images.length === 3)).toBe(true);
  });

  it('computes themes within the chosen genre', () => {
    const movies = [
      ...Array.from({ length: 4 }, () => movie({ genres: ['Horror'], themes: { zombies: 2 } })),
      ...Array.from({ length: 4 }, () => movie({ genres: ['Comedy'], themes: { heist: 2 } })),
      ...Array.from({ length: 3 }, () => movie({ genres: ['Horror'], themes: { vampires: 2 } })),
    ];
    const res = wizardOptions(movies, 'theme', { genre: 'Horror' }, { image });
    expect(res.total).toBe(7);
    expect(res.options.map((o) => o.id)).toEqual(['zombies', 'vampires']);
    expect(res.skip).toBe(false);
  });

  it('skips a theme or mood question with only one real answer', () => {
    const movies = [
      ...Array.from({ length: 4 }, () => movie({ moods: { edge: 3 } })),
      ...Array.from({ length: 4 }, () => movie()),
    ];
    expect(wizardOptions(movies, 'mood', {}, { image }).skip).toBe(true);
  });

  it('keeps the time question when one shorter option exists', () => {
    const movies = [
      ...Array.from({ length: 4 }, () => movie({ runtime: 95 })),
      ...Array.from({ length: 4 }, () => movie({ runtime: 150 })),
    ];
    expect(wizardOptions(movies, 'time', {}, { image }).skip).toBe(false);
  });

  it('skips a step that would not narrow anything', () => {
    const movies = Array.from({ length: 6 }, () => movie({ runtime: 90 }));
    expect(wizardOptions(movies, 'time', {}, { image }).skip).toBe(true);
  });
});

describe('sagas in picks', () => {
  const image = (m: Movie) => m.posterUrl;
  const part = (id: number, n: number, parts: number, extra: Partial<Movie> & { ratings?: Partial<Ratings> } = {}) =>
    movie({ genres: ['Comedy'], saga: { id, title: 'Back to the Future', part: n, parts }, ...extra });
  const opts = (sagas: ReturnType<typeof sagaState>) => ({ now: NOW, seed: 'test', sagas });

  it('does not offer a sequel before its first part', () => {
    const [p1, p2] = [part(50, 1, 2), part(50, 2, 2)];
    const sagas = sagaState([p1, p2], new Set());
    expect(eligibleMovies([p1, p2], ctx({ sagas })).map((m) => m.id)).toEqual([p1.id]);
  });

  it('suggests the first part instead of a matching sequel', () => {
    // Only the sequel matches the theme answer; part 1 still fits the genre.
    const p1 = part(51, 1, 2);
    const p2 = part(51, 2, 2, { themes: { 'time-travel': 4 } });
    const others = Array.from({ length: 6 }, () =>
      movie({ genres: ['Comedy'], themes: { 'time-travel': 2 }, ratings: { rt: 60 } }),
    );
    const library = [p1, p2, ...others];
    const sagas = sagaState(library, new Set());
    const ranked = rankMovies(eligibleMovies(library, ctx({ sagas })), { genre: 'Comedy', theme: 'time-travel' }, [], opts(sagas));
    const first = ranked.find((r) => r.movie.id === p1.id)!;
    expect(first.tier).toBe(0);
    expect(first.reasons.map((r) => r.label)).toContain('Start of Back to the Future');
    expect(ranked.some((r) => r.movie.id === p2.id)).toBe(false);
  });

  it('does not swap in a first part from another genre', () => {
    const [p1, p2] = [part(52, 1, 2, { genres: ['Drama'] }), part(52, 2, 2)];
    const sagas = sagaState([p1, p2], new Set());
    const ranked = rankMovies(eligibleMovies([p1, p2], ctx({ sagas })), { genre: 'Comedy' }, [], opts(sagas));
    expect(ranked).toEqual([]);
  });

  it('favours the next part of a started saga', () => {
    const [p1, p2] = [part(53, 1, 2), part(53, 2, 2, { ratings: { rt: 80 } })];
    const sagas = sagaState([p1, p2], new Set([p1.id]));
    const [ranked] = rankMovies([p2], {}, [], opts(sagas));
    expect(ranked!.reasons[0]).toEqual({ kind: 'saga', label: 'Next in Back to the Future' });
    expect(ranked!.score).toBeGreaterThan(80 + 4 - 1.5 - 0.1);
  });

  it('"Start a saga" offers first parts, judged by the whole saga', () => {
    // Saga A averages 85 although its first part is weaker; saga B averages 75.
    const a = [part(54, 1, 2, { ratings: { rt: 70 } }), part(54, 2, 2, { ratings: { rt: 100 } })];
    const b = [part(55, 1, 2, { ratings: { rt: 90 } }), part(55, 2, 2, { ratings: { rt: 60 } })];
    const lone = movie({ genres: ['Comedy'], ratings: { rt: 99 } });
    const library = [...a, ...b, lone];
    const sagas = sagaState(library, new Set());
    const ranked = rankMovies(eligibleMovies(library, ctx({ sagas })), { time: 'saga' }, [], opts(sagas));
    expect(ranked.map((r) => r.movie.id)).toEqual([a[0]!.id, b[0]!.id]);
    expect(ranked[0]!.reasons.map((r) => r.label)).toEqual(['Start of Back to the Future', '2 parts, 3h 40m in all']);
  });

  it('offers "Start a saga" in the time question when one can be started', () => {
    const library = [part(56, 1, 3), part(56, 2, 3), ...Array.from({ length: 5 }, () => movie({ runtime: 150 }))];
    const sagas = sagaState(library, new Set());
    const res = wizardOptions(eligibleMovies(library, ctx({ sagas })), 'time', {}, { image, sagaStarters: sagas.starters });
    expect(res.options.find((o) => o.id === 'saga')).toMatchObject({ label: 'Start a saga', count: 1 });
  });
});
