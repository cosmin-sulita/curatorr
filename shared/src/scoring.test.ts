import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  eligibleMovies,
  formatRuntime,
  matchesShelf,
  pickingDay,
  qualityScore,
  rankMovies,
  surpriseOrder,
  tastePoints,
  wizardOptions,
  type ProfileContext,
} from './scoring.js';
import { sagaState } from './sagas.js';
import { keywordPhrases, tagMovie } from './tagger.js';
import { TAGGED_MOVIES } from './tagger.fixtures.js';
import { RESTRICTION_CERTS, SEASONS, type SeasonDef } from './taxonomy.js';
import type { FeedbackEvent, Movie, Ratings } from './types.js';

const noRatings: Ratings = { rt: null, imdb: null, tmdb: null, metacritic: null };

let nextId = 1;
function movie(partial: Omit<Partial<Movie>, 'ratings'> & { ratings?: Partial<Ratings> } = {}): Movie {
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
    jellyfinId: null,
    saga: null,
    addedAt: null,
    arrivedAt: null,
    ...partial,
    ratings: { ...noRatings, ...partial.ratings },
  };
}

const ctx = (over: Partial<ProfileContext> = {}): ProfileContext => ({
  watched: new Set(),
  feedback: [],
  allowedCerts: null,
  requireServer: 'plex',
  includeWatched: false,
  watchlist: new Set(),
  ...over,
});

const NOW = Date.parse('2026-10-08T20:00:00Z');
const DAY = 86_400_000;
const rank = (movies: Movie[], c = {}, feedback: FeedbackEvent[] = []) =>
  rankMovies(movies, c, feedback, { now: NOW, seed: 'test' });

describe('qualityScore', () => {
  it('averages what critics and audiences think', () => {
    // IMDb 6.0 counts as 60%.
    expect(qualityScore({ ...noRatings, rt: 91, imdb: 6 })).toBe(75.5);
    // An audience score is a percentage, so it stops at 100.
    expect(qualityScore({ ...noRatings, rt: 80, imdb: 9 })).toBe(90);
  });

  it('counts a missing score as 50, which keeps the old IMDb and TMDB fallbacks', () => {
    expect(qualityScore({ ...noRatings, imdb: 8 })).toBe(75);
    expect(qualityScore({ ...noRatings, tmdb: 8 })).toBeCloseTo(72, 9);
    expect(qualityScore({ ...noRatings, rt: 90 })).toBe(70);
    expect(qualityScore(noRatings)).toBe(50);
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

  it('only offers movies found in Jellyfin when Curatorr uses it', () => {
    const found = movie({ plexRatingKey: null, jellyfinId: 'item-1' });
    const missing = movie({ plexRatingKey: null });
    expect(eligibleMovies([found, missing], ctx({ requireServer: 'jellyfin' }))).toEqual([found]);
  });

  it("leaves out movies the profile can't open on the media server", () => {
    const [open, closed] = [movie(), movie()];
    expect(eligibleMovies([open, closed], ctx({ available: new Set([open.id]) }))).toEqual([open]);
    expect(eligibleMovies([open, closed], ctx({ available: null }))).toEqual([open, closed]);
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
  it('ranks by rating', () => {
    const low = movie({ ratings: { rt: 60 } });
    const high = movie({ ratings: { rt: 95 } });
    const mid = movie({ ratings: { rt: 80 } });
    expect(rank([low, high, mid]).map((r) => r.movie.id)).toEqual([high.id, mid.id, low.id]);
  });

  it('lets audiences lift a movie critics were cool on', () => {
    // (60% + IMDb 7.7 as 94%) / 2 = 77 beats (97% + IMDb 5.4 as 48%) / 2 = 72.5.
    const crowdPleaser = movie({ ratings: { rt: 60, imdb: 7.7 } });
    const criticsDarling = movie({ ratings: { rt: 97, imdb: 5.4 } });
    expect(rank([criticsDarling, crowdPleaser]).map((r) => r.movie.id)).toEqual([crowdPleaser.id, criticsDarling.id]);
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
    expect(shownYesterday).toBeCloseTo(fresh - 4, 5);
  });

  it('demotes a pick more steeply for each evening it was shown, for a month', () => {
    // Evenings turn over at 4 am local time; in UTC, every show here is at 8 pm or 7 pm.
    vi.stubEnv('TZ', 'UTC');
    try {
      const a = movie({ ratings: { rt: 90 } });
      const fresh = rank([a])[0]!.score;
      const shownOn = (...daysAgo: number[]) =>
        rank([a], {}, daysAgo.map((d) => ({ movieId: a.id, kind: 'shown' as const, createdAt: NOW - d * DAY })))[0]!.score;
      expect(shownOn(1, 2)).toBeCloseTo(fresh - 12, 5);
      expect(shownOn(1, 2, 3)).toBeCloseTo(fresh - 24, 5);
      // Twice on one evening is one evening.
      expect(shownOn(1, 1 + 1 / 24)).toBeCloseTo(fresh - 4, 5);
      expect(shownOn(1, 2, 3, 4, 5, 6, 7)).toBeCloseTo(fresh - 112, 5);
      expect(shownOn(31, 40)).toBeCloseTo(fresh, 5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('lets a strong pick passed over evening after evening fall below weaker ones', () => {
    // Rated 75 and 55: twenty points apart, more than a penalty with a ceiling would ever close.
    const strong = movie({ ratings: { rt: 100 } });
    const weaker = movie({ ratings: { rt: 60 } });
    const aWeek = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ movieId: strong.id, kind: 'shown' as const, createdAt: NOW - d * DAY }));
    expect(rank([strong, weaker], {}, aWeek)[0]!.movie.id).toBe(weaker.id);
  });

  it('keeps a movie down longer each time it is skipped', () => {
    const a = movie({ ratings: { rt: 90 } });
    const fresh = rank([a])[0]!.score;
    const skippedOn = (...daysAgo: number[]) =>
      rank([a], {}, daysAgo.map((d) => ({ movieId: a.id, kind: 'skipped' as const, createdAt: NOW - d * DAY })))[0]!.score;
    expect(skippedOn(20)).toBeCloseTo(fresh, 5);
    // Skipped twice: four weeks from the last time.
    expect(skippedOn(20, 50)).toBeCloseTo(fresh - 15, 5);
    expect(skippedOn(30, 50)).toBeCloseTo(fresh, 5);
    // Skips older than three months are forgotten.
    expect(skippedOn(20, 100)).toBeCloseTo(fresh, 5);
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
    // The watchlist's bonus beats a 2-point rating gap even with the daily jitter (±1.5 each).
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

  it('favours unwatched Seerr requests and says so', () => {
    // A request's bonus beats a 4-point rating gap even with the daily jitter (±1.5 each).
    const top = movie({ ratings: { rt: 94 } });
    const requested = movie({ ratings: { rt: 90 } });
    const ranked = rankMovies([top, requested], {}, [], { now: NOW, seed: 'test', requested: new Set([requested.id]) });
    expect(ranked.map((r) => r.movie.id)).toEqual([requested.id, top.id]);
    expect(ranked[0]!.reasons[0]).toEqual({ kind: 'requested', label: 'You requested this' });
    expect(ranked[1]!.reasons.some((r) => r.kind === 'requested')).toBe(false);
  });

  it('counts a request on the watchlist once', () => {
    const m = movie({ ratings: { rt: 80 } });
    const score = (opts: { watchlist?: Set<number>; requested?: Set<number> }) =>
      rankMovies([m], {}, [], { now: NOW, seed: 'test', ...opts })[0]!;
    const plain = score({});
    const requested = score({ requested: new Set([m.id]) });
    const both = score({ requested: new Set([m.id]), watchlist: new Set([m.id]) });
    expect(requested.score).toBeGreaterThan(plain.score);
    expect(both.score).toBe(requested.score);
    expect(both.reasons.slice(0, 2).map((r) => r.kind)).toEqual(['requested', 'watchlist']);
  });

  it('favours movies that just arrived, and says when', () => {
    // Two days in, the bonus is enough to beat a 6-point rating gap even with the shuffle.
    const fresh = movie({ ratings: { rt: 82 }, addedAt: new Date(NOW - 2 * DAY).toISOString() });
    const old = movie({ ratings: { rt: 88 }, addedAt: '2020-01-01T00:00:00Z' });
    const ranked = rank([old, fresh]);
    expect(ranked.map((r) => r.movie.id)).toEqual([fresh.id, old.id]);
    expect(ranked[0]!.reasons).toContainEqual({ kind: 'added', label: 'Added 2 days ago' });
    expect(ranked[1]!.reasons.some((r) => r.kind === 'added')).toBe(false);
  });

  it('lets the arrival bonus fade over a few weeks', () => {
    const m = movie({ ratings: { rt: 80 } });
    const bonus = (days: number) =>
      rank([{ ...m, addedAt: new Date(NOW - days * DAY).toISOString() }])[0]!.score - rank([m])[0]!.score;
    expect(bonus(0)).toBeGreaterThan(10);
    expect(bonus(21)).toBeCloseTo(bonus(0) / Math.E, 0);
    expect(bonus(60)).toBeLessThan(bonus(0) / 10);
    // The chip only shows while the bonus is worth mentioning.
    expect(rank([{ ...m, addedAt: new Date(NOW - 20 * DAY).toISOString() }])[0]!.reasons.some((r) => r.kind === 'added')).toBe(false);
  });

  it('counts from when the file arrived, not from when Radarr added the movie', () => {
    // Requested before its release: in Radarr for three months, in the library for two days.
    const m = movie({
      ratings: { rt: 80 },
      addedAt: new Date(NOW - 90 * DAY).toISOString(),
      arrivedAt: new Date(NOW - 2 * DAY).toISOString(),
    });
    const [ranked] = rank([m]);
    expect(ranked!.reasons).toContainEqual({ kind: 'added', label: 'Added 2 days ago' });
    expect(ranked!.score).toBe(rank([{ ...m, addedAt: null }])[0]!.score);
    expect(ranked!.score).toBeGreaterThan(rank([{ ...m, addedAt: null, arrivedAt: null }])[0]!.score);
  });

  it('explains the pick', () => {
    const m = movie({ genres: ['Action'], themes: { heist: 2 }, ratings: { rt: 92 } });
    const labels = rank([m], { genre: 'Action', theme: 'heist' })[0]!.reasons.map((r) => r.label);
    expect(labels).toEqual(['Action', 'Heists & Cons', '92% on Rotten Tomatoes']);
  });

  it('says when audiences rate a pick highly', () => {
    const m = movie({ ratings: { rt: 60, imdb: 7.7 } });
    expect(rank([m])[0]!.reasons).toContainEqual({ kind: 'rating', label: '7.7 on IMDb' });
  });

  it('lets a requested movie that just arrived lead one rated well above it', () => {
    // 23.5 points apart: more than the request's and a two-day-old arrival's bonuses add up to (19), less than they
    // count for in the picks, with room for the daily jitter (±1.5 each).
    const wanted = movie({ ratings: { rt: 60, imdb: 7 }, arrivedAt: new Date(NOW - 2 * DAY).toISOString() });
    const better = movie({ ratings: { rt: 95, imdb: 7.6 } });
    const ranked = rankMovies([better, wanted], {}, [], { now: NOW, seed: 'test', requested: new Set([wanted.id]) });
    expect(ranked.map((r) => r.movie.id)).toEqual([wanted.id, better.id]);
  });

  it('keeps what each part of the score added', () => {
    // A requested heist that arrived two days ago and was shown yesterday.
    const m = movie({ themes: { heist: 4 }, ratings: { rt: 80, imdb: 7 }, arrivedAt: new Date(NOW - 2 * DAY).toISOString() });
    const shown: FeedbackEvent[] = [{ movieId: m.id, kind: 'shown', createdAt: NOW - DAY }];
    const [r] = rankMovies([m], { theme: 'heist' }, shown, { now: NOW, seed: 'test', requested: new Set([m.id]) });
    const parts = r!.parts!;
    expect(parts.quality).toBe(qualityScore(m.ratings));
    expect(parts.answers).toBeGreaterThan(0);
    expect(parts.wanted).toBeGreaterThan(0);
    expect(parts.arrival).toBeGreaterThan(0);
    expect(parts.shown).toBeLessThan(0);
    expect([parts.season, parts.saga, parts.taste, parts.skip]).toEqual([0, 0, 0, 0]);
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    expect(Math.round(total * 10) / 10).toBe(r!.score);
  });
});

describe('the daily shuffle', () => {
  afterEach(() => vi.unstubAllEnvs());
  // Equally rated, so the shuffle alone decides their order.
  const tied = Array.from({ length: 10 }, () => movie({ ratings: { rt: 80 } }));
  const order = (iso: string) => rankMovies(tied, {}, [], { now: Date.parse(iso), seed: 'test' }).map((r) => r.movie.id);

  it('keeps the same order all evening, also where UTC midnight falls in it', () => {
    vi.stubEnv('TZ', 'America/New_York');
    // 7:59 pm and 8:01 pm on an October evening in New York are 23:59 and 00:01 UTC.
    expect(order('2026-10-08T19:59:00-04:00')).toEqual(order('2026-10-08T20:01:00-04:00'));
    expect(order('2026-10-08T18:00:00-04:00')).toEqual(order('2026-10-09T02:00:00-04:00'));
    expect(order('2026-10-08T20:00:00-04:00')).not.toEqual(order('2026-10-09T20:00:00-04:00'));
  });

  it('turns over at 4 am in the server’s time zone', () => {
    vi.stubEnv('TZ', 'Europe/Bucharest');
    expect(pickingDay(Date.parse('2026-10-09T03:59:00+03:00'))).toBe('2026-10-08');
    expect(pickingDay(Date.parse('2026-10-09T04:01:00+03:00'))).toBe('2026-10-09');
  });
});

describe('Surprise me', () => {
  afterEach(() => vi.unstubAllEnvs());
  // Four points apart, far enough that the daily jitter can't reorder them, listed best first.
  const library = Array.from({ length: 20 }, (_, i) => movie({ ratings: { rt: 99 - i * 4, imdb: 8 - i / 5 } }));
  const best = library.map((m) => m.id);
  const surprise = (seed: string, iso = '2026-10-08T20:00:00Z') => {
    const opts = { now: Date.parse(iso), seed };
    return surpriseOrder(rankMovies(library, {}, [], opts), opts).map((r) => r.movie.id);
  };

  it('draws the first pick from the ten best, not always the best one', () => {
    vi.stubEnv('TZ', 'UTC');
    const firsts = Array.from({ length: 50 }, (_, profile) => surprise(String(profile))[0]!);
    expect(firsts.every((id) => best.slice(0, 10).includes(id))).toBe(true);
    expect(new Set(firsts).size).toBeGreaterThan(5);
  });

  it('keeps the order all evening, and draws again the next', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(surprise('1', '2026-10-08T19:00:00Z')).toEqual(surprise('1', '2026-10-08T23:00:00Z'));
    expect(surprise('1', '2026-10-09T20:00:00Z')).not.toEqual(surprise('1', '2026-10-08T20:00:00Z'));
  });

  it('only reorders the ten best', () => {
    const order = surprise('1');
    expect(order.slice(0, 10)).not.toEqual(best.slice(0, 10));
    expect(order.slice(0, 10).sort((a, b) => a - b)).toEqual(best.slice(0, 10));
    expect(order.slice(10)).toEqual(best.slice(10, 12));
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
    // And one with neither theme, so both answers narrow the list.
    const movies = [
      ...[100, 95, 90, 85].map((rt) => movie({ themes: { space: 2, aliens: 2 }, ratings: { rt } })),
      movie({ ratings: { rt: 50 } }),
    ];
    const res = wizardOptions(movies, 'theme', {}, { image });
    const leads = res.options.map((o) => o.images[0]);
    expect(leads).toHaveLength(2);
    expect(new Set(leads).size).toBe(2);
    expect(res.options.every((o) => o.images.length === 3)).toBe(true);
  });

  it('computes themes within the chosen genre', () => {
    const movies = [
      ...Array.from({ length: 8 }, () => movie({ genres: ['Horror'], themes: { zombies: 2 } })),
      ...Array.from({ length: 4 }, () => movie({ genres: ['Comedy'], themes: { heist: 2 } })),
      ...Array.from({ length: 6 }, () => movie({ genres: ['Horror'], themes: { vampires: 2 } })),
    ];
    const res = wizardOptions(movies, 'theme', { genre: 'Horror' }, { image });
    expect(res.total).toBe(14);
    expect(res.options.map((o) => o.id)).toEqual(['zombies', 'vampires']);
    expect(res.skip).toBe(false);
  });

  it('skips a theme or mood question with only one real answer', () => {
    const movies = [
      ...Array.from({ length: 8 }, () => movie({ moods: { edge: 3 } })),
      ...Array.from({ length: 8 }, () => movie()),
    ];
    expect(wizardOptions(movies, 'mood', {}, { image }).skip).toBe(true);
  });

  it("doesn't offer an answer that matches every movie left", () => {
    // All of these are Edge of Your Seat, so that answer would narrow nothing.
    const movies = [
      ...Array.from({ length: 8 }, () => movie({ moods: { edge: 3, dark: 3 } })),
      ...Array.from({ length: 7 }, () => movie({ moods: { edge: 3, light: 3 } })),
    ];
    const res = wizardOptions(movies, 'mood', {}, { image });
    expect(res.options.map((o) => o.id)).toEqual(['light', 'dark']);
    expect(res.skip).toBe(false);
  });

  it('keeps the time question when one shorter option exists', () => {
    const movies = [
      ...Array.from({ length: 8 }, () => movie({ runtime: 95 })),
      ...Array.from({ length: 8 }, () => movie({ runtime: 150 })),
    ];
    expect(wizardOptions(movies, 'time', {}, { image }).skip).toBe(false);
  });

  it('skips a step that would not narrow anything', () => {
    const movies = Array.from({ length: 16 }, () => movie({ runtime: 90 }));
    expect(wizardOptions(movies, 'time', {}, { image }).skip).toBe(true);
  });

  it('stops asking once the picks would show every movie left', () => {
    // Two real answers either way; only the number of movies left differs.
    const movies = (count: number) =>
      Array.from({ length: count }, (_, i) => movie({ moods: i % 2 ? { dark: 3 } : { light: 3 } }));
    expect(wizardOptions(movies(12), 'mood', {}, { image }).skip).toBe(true);
    expect(wizardOptions(movies(13), 'mood', {}, { image }).skip).toBe(false);
  });
});

describe('sagas in picks', () => {
  const image = (m: Movie) => m.posterUrl;
  const part = (id: number, n: number, parts: number, extra: Omit<Partial<Movie>, 'ratings'> & { ratings?: Partial<Ratings> } = {}) =>
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
    // Critics and audiences both at 80%.
    const [p1, p2] = [part(53, 1, 2), part(53, 2, 2, { ratings: { rt: 80, imdb: 7 } })];
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

describe('Just arrived', () => {
  const image = (m: Movie, kind: 'fanart' | 'poster') => (kind === 'fanart' ? m.fanartUrl : m.posterUrl);
  const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
  /** A movie whose file arrived `days` ago. */
  const arrived = (days: number, extra: Partial<Movie> & { ratings?: Partial<Ratings> } = {}) =>
    movie({ arrivedAt: ago(days), ...extra });
  const ids = (ranked: { movie: Movie }[]) => ranked.map((r) => r.movie.id).sort((a, b) => a - b);

  it('keeps the movies that arrived in the last 30 days, by their file first', () => {
    const recent = arrived(29);
    const older = arrived(31);
    // In Radarr for months as a request, but its file came last week.
    const requested = movie({ addedAt: ago(120), arrivedAt: ago(7) });
    // Without a file date, Radarr's added date counts.
    const undated = movie({ addedAt: ago(3) });
    const stale = movie({ addedAt: ago(90) });
    expect(ids(rank([recent, older, requested, undated, stale], { shelf: 'new' }))).toEqual(
      [recent.id, requested.id, undated.id].sort((a, b) => a - b),
    );
  });

  it('says when each one arrived, also after the new-arrival chip has gone', () => {
    const [late] = rank([arrived(25)], { shelf: 'new' });
    expect(late!.reasons).toContainEqual({ kind: 'added', label: 'Added 25 days ago' });
    const [early] = rank([arrived(2)], { shelf: 'new' });
    expect(early!.reasons.filter((r) => r.kind === 'added')).toEqual([{ kind: 'added', label: 'Added 2 days ago' }]);
  });

  it('brings in the first part of a saga whose sequel just arrived', () => {
    const saga = (part: number, days: number) => arrived(days, { saga: { id: 60, title: 'Dune', part, parts: 2 } });
    const [p1, p2] = [saga(1, 400), saga(2, 2)];
    const oldie = arrived(300);
    const library = [p1, p2, oldie, arrived(3), arrived(4)];
    const sagas = sagaState(library, new Set());
    const ranked = rankMovies(eligibleMovies(library, ctx({ sagas })), { shelf: 'new' }, [], { now: NOW, seed: 'test', sagas });
    const first = ranked.find((r) => r.movie.id === p1.id);
    expect(first?.reasons).toContainEqual({ kind: 'saga', label: 'Start of Dune' });
    expect(first?.reasons.some((r) => r.kind === 'added')).toBe(false);
    expect(ranked.some((r) => r.movie.id === p2.id)).toBe(false);
    // Only the first part comes along: other old movies stay out.
    expect(ranked.some((r) => r.movie.id === oldie.id)).toBe(false);
  });

  it('is offered on the first question once three movies arrived lately', () => {
    const movies = [arrived(1), arrived(2), arrived(3), ...Array.from({ length: 5 }, () => arrived(200))];
    const res = wizardOptions(movies, 'genre', {}, { image, now: NOW });
    expect(res.shelves).toEqual([expect.objectContaining({ id: 'new', label: 'Just arrived', count: 3 })]);
    // The genre cards feature other movies than the shortcut does.
    expect(res.options.map((o) => o.images[0])).not.toContain(res.shelves![0]!.images[0]);
  });

  it("isn't offered for fewer than three, or when most of the library just arrived", () => {
    const few = [arrived(1), arrived(2), ...Array.from({ length: 5 }, () => arrived(200))];
    expect(wizardOptions(few, 'genre', {}, { image, now: NOW }).shelves).toEqual([]);
    // A library imported last week isn't news.
    const fresh = [...Array.from({ length: 5 }, () => arrived(3)), ...Array.from({ length: 4 }, () => arrived(200))];
    expect(wizardOptions(fresh, 'genre', {}, { image, now: NOW }).shelves).toEqual([]);
    // Half of it is.
    const half = [...Array.from({ length: 4 }, () => arrived(3)), ...Array.from({ length: 4 }, () => arrived(200))];
    expect(wizardOptions(half, 'genre', {}, { image, now: NOW }).shelves).toHaveLength(1);
  });
});

describe('seasons', () => {
  afterEach(() => vi.unstubAllEnvs());
  const image = (m: Movie, kind: 'fanart' | 'poster') => (kind === 'fanart' ? m.fanartUrl : m.posterUrl);
  const OCTOBER = Date.parse('2026-10-20T20:00:00Z');
  const DECEMBER = Date.parse('2026-12-10T20:00:00Z');
  const ids = (ranked: { movie: Movie }[]) => ranked.map((r) => r.movie.id).sort((a, b) => a - b);
  const shelves = (movies: Movie[], now: number) =>
    (wizardOptions(movies, 'genre', {}, { image, now }).shelves ?? []).map((s) => [s.id, s.count]);

  it('gives Halloween the horror, ghosts, vampires and zombies, and the movies set on Halloween', () => {
    const spooky = [
      movie({ genres: ['Horror'] }),
      movie({ genres: ['Comedy'], themes: { supernatural: 2 } }),
      movie({ genres: ['Comedy'], themes: { vampires: 2 } }),
      movie({ genres: ['Action'], themes: { zombies: 2 } }),
      movie({ genres: ['Family'], keywords: ['halloween party'] }),
      movie({ genres: ['Family'], keywords: ['trick or treating'] }),
    ];
    // Sharks and dinosaurs are monsters, but not Halloween's.
    const others = [movie({ genres: ['Thriller'], themes: { monsters: 4 } }), movie({ genres: ['Drama'] })];
    const ranked = rankMovies([...spooky, ...others], { shelf: 'halloween' }, [], { now: OCTOBER, seed: 'test' });
    expect(ids(ranked)).toEqual(ids(spooky.map((movie) => ({ movie }))));
  });

  it('puts the movies set on Halloween first, and says so', () => {
    // Two points lower on Rotten Tomatoes, one lower in score: the +5 lifts it past the shuffle.
    const set = movie({ genres: ['Horror'], keywords: ['halloween'], ratings: { rt: 80 } });
    const plain = movie({ genres: ['Horror'], ratings: { rt: 82 } });
    const ranked = rankMovies([plain, set], { shelf: 'halloween' }, [], { now: OCTOBER, seed: 'test' });
    expect(ranked.map((r) => r.movie.id)).toEqual([set.id, plain.id]);
    expect(ranked[0]!.reasons).toContainEqual({ kind: 'season', label: 'Set on Halloween' });
    expect(ranked[1]!.reasons.some((r) => r.kind === 'season')).toBe(false);
  });

  it('gives Christmas the movies with Christmas in their keywords', () => {
    const festive = [movie({ keywords: ['christmas eve'] }), movie({ keywords: ['santa claus'] }), movie({ keywords: ['christmas'] })];
    const ranked = rankMovies([...festive, movie({ genres: ['Horror'] })], { shelf: 'christmas' }, [], { now: DECEMBER, seed: 'test' });
    expect(ids(ranked)).toEqual(ids(festive.map((movie) => ({ movie }))));
  });

  it('offers each season on the first question in its own month, until 4 am after its last night', () => {
    vi.stubEnv('TZ', 'Europe/Bucharest');
    const library = [
      ...Array.from({ length: 3 }, () => movie({ genres: ['Horror'] })),
      ...Array.from({ length: 3 }, () => movie({ keywords: ['christmas'] })),
    ];
    expect(shelves(library, Date.parse('2026-10-01T05:00:00+03:00'))).toEqual([['halloween', 3]]);
    expect(shelves(library, Date.parse('2026-10-31T23:00:00+02:00'))).toEqual([['halloween', 3]]);
    expect(shelves(library, Date.parse('2026-11-01T03:30:00+02:00'))).toEqual([['halloween', 3]]);
    expect(shelves(library, Date.parse('2026-11-01T05:00:00+02:00'))).toEqual([]);
    expect(shelves(library, Date.parse('2026-12-24T20:00:00+02:00'))).toEqual([['christmas', 3]]);
  });

  it('needs three movies of the season that the profile may watch, however much of the library they are', () => {
    const scary = Array.from({ length: 5 }, () => movie({ genres: ['Horror'], certification: 'R' }));
    const friendly = [movie({ themes: { supernatural: 2 }, certification: 'PG' }), movie({ keywords: ['halloween'], certification: 'G' })];
    const kids = ctx({ allowedCerts: new Set(RESTRICTION_CERTS.older_kid) });
    expect(shelves(eligibleMovies([...scary, ...friendly], kids), OCTOBER)).toEqual([]);
    const more = [...friendly, movie({ themes: { vampires: 2 }, certification: 'PG' })];
    expect(shelves(eligibleMovies([...scary, ...more], kids), OCTOBER)).toEqual([['halloween', 3]]);
    // A library of horror is all Halloween, and still gets the tile.
    expect(shelves(scary, OCTOBER)).toEqual([['halloween', 5]]);
  });

  it("doesn't bring in a first part that isn't the season's", () => {
    const part = (n: number, extra: Partial<Movie>) => movie({ genres: ['Comedy'], saga: { id: 70, title: 'Pals', part: n, parts: 2 }, ...extra });
    const [p1, p2] = [part(1, {}), part(2, { keywords: ['halloween'] })];
    const horror = movie({ genres: ['Horror'] });
    const library = [p1, p2, horror];
    const sagas = sagaState(library, new Set());
    const ranked = rankMovies(eligibleMovies(library, ctx({ sagas })), { shelf: 'halloween' }, [], { now: OCTOBER, seed: 'test', sagas });
    expect(ranked.map((r) => r.movie.id)).toEqual([horror.id]);
  });

  it('finds a holiday only as whole words of a keyword', () => {
    const cases: [string, string, boolean][] = [
      ['halloween party', 'halloween', true],
      ['Halloween Party', 'halloween', true],
      ['the night before halloween', 'halloween', true],
      ['trick or treating', 'halloween', true],
      ['halloweentown', 'halloween', false],
      ['trick-or-treating', 'halloween', false],
      ['  Christmas  ', 'christmas', true],
      ['a christmas story', 'christmas', true],
      ['santa claus', 'christmas', true],
      ['santa', 'christmas', false],
      ['christmastime', 'christmas', false],
    ];
    for (const [keyword, shelf, set] of cases) {
      const m = movie({ genres: ['Comedy'], keywords: [keyword] });
      const now = shelf === 'halloween' ? OCTOBER : DECEMBER;
      const [ranked] = rankMovies([m], { shelf }, [], { now, seed: 'test' });
      expect([keyword, matchesShelf(m, shelf, now), ranked?.parts?.season ?? 0]).toEqual([keyword, set, set ? 5 : 0]);
      if (shelf === 'halloween') expect(ranked?.reasons.some((r) => r.label === 'Set on Halloween') ?? false).toBe(set);
    }
  });

  /** The season test as it was before it kept each movie's keyword phrases, to compare the faster one with. */
  const referenceOnHoliday = (m: Movie, season: SeasonDef) =>
    m.keywords.some((k) => [...keywordPhrases(k)].some((p) => season.keywords.includes(p)));
  const referenceInSeason = (m: Movie, season: SeasonDef) =>
    referenceOnHoliday(m, season) ||
    Boolean(season.genres?.some((g) => m.genres.includes(g))) ||
    Boolean(season.themes?.some((t) => (m.themes[t] ?? 0) > 0));

  it('tells the same movies apart as before, on the shortcut, its first-question tile and its bonus', () => {
    const keywords = ['halloween party', 'trick or treating', 'christmas eve', 'santa claus', 'halloweentown', 'santa'];
    const library = [
      ...TAGGED_MOVIES.map(({ title, genres, keywords, overview, runtime }) =>
        movie({ title, genres, keywords, overview, runtime, ...tagMovie({ genres, keywords, overview, runtime }) }),
      ),
      ...keywords.map((k) => movie({ genres: ['Comedy'], keywords: [k] })),
      movie({ genres: ['Horror'], keywords: ['christmas'] }),
      movie({ genres: ['Drama'], themes: { zombies: 2 }, keywords: ['halloween'] }),
    ];
    // Mid-October has Halloween's tile, mid-November none, mid-December Christmas's.
    const months = [
      [Date.parse('2026-10-15T20:00:00Z'), 'halloween'],
      [Date.parse('2026-11-15T20:00:00Z'), null],
      [DECEMBER, 'christmas'],
    ] as const;
    for (const [now, tile] of months) {
      for (const season of SEASONS) {
        const want = library.filter((m) => referenceInSeason(m, season));
        expect(library.filter((m) => matchesShelf(m, season.id, now)).map((m) => m.id)).toEqual(want.map((m) => m.id));
        const ranked = rankMovies(library, { shelf: season.id }, [], { now, seed: 'test', limit: 1000 });
        expect(ranked.length).toBe(want.length);
        for (const r of ranked) expect(r.parts!.season).toBe(referenceOnHoliday(r.movie, season) ? 5 : 0);
      }
      const shown = shelves(library, now).filter(([id]) => id !== 'new');
      const season = tile ? SEASONS.find((s) => s.id === tile)! : null;
      expect(shown).toEqual(season ? [[season.id, library.filter((m) => referenceInSeason(m, season)).length]] : []);
    }
  });

  it("reads a movie's keywords once, however many requests ask about the season", () => {
    let reads = 0;
    const keywords = new Proxy(['halloween party', 'masks'], {
      get(target, prop, receiver) {
        reads++;
        return Reflect.get(target, prop, receiver);
      },
    });
    const m = movie({ genres: ['Comedy'], keywords });
    expect(matchesShelf(m, 'halloween', OCTOBER)).toBe(true);
    const first = reads;
    for (let i = 0; i < 3; i++) {
      matchesShelf(m, 'halloween', OCTOBER);
      rankMovies([m], { shelf: 'halloween' }, [], { now: OCTOBER, seed: 'test' });
    }
    expect(first).toBeGreaterThan(0);
    expect(reads).toBe(first);
  });
});

describe('watching together', () => {
  /** A member's taste from fixed likenesses, liking `because` best. */
  const taste = (name: string | undefined, likeness: Map<number, number>, because: Movie | null, confidence = 1) => ({
    name,
    confidence,
    affinity: (m: Movie) => likeness.get(m.id) ?? 0,
    because: () => because,
  });
  const [a, b, c] = [movie(), movie(), movie()];
  const alex = taste('Alex', new Map([[a.id, 1], [b.id, 0.5], [c.id, 0]]), null);
  const sam = taste('Sam', new Map([[a.id, 0], [b.id, 0.5], [c.id, 1]]), null);
  const kids = taste('Kids', new Map(), null, 0);
  // Over three movies one standard deviation apart, the one a person likes most gets 6 × 1.2247 points.
  const LIKED = 7.3485;

  it('blends tastes so that the movie someone likes least loses out to one both are fine with', () => {
    const points = tastePoints([a, b, c], [alex, sam]);
    expect(points.get(a.id)).toBeCloseTo(-LIKED / 2, 3);
    expect(points.get(b.id)).toBeCloseTo(0, 3);
    expect(points.get(c.id)).toBeCloseTo(-LIKED / 2, 3);
  });

  it("keeps one person's taste as it is, and leaves out a member with no history", () => {
    for (const tastes of [[alex], [alex, kids]]) {
      const points = tastePoints([a, b, c], tastes);
      expect(points.get(a.id)).toBeCloseTo(LIKED, 3);
      expect(points.get(c.id)).toBeCloseTo(-LIKED, 3);
    }
  });

  it("says whose watchlist or request a pick comes from", () => {
    const [requested, onOne, onBoth] = [movie(), movie(), movie()];
    const ranked = rankMovies([requested, onOne, onBoth], {}, [], {
      now: NOW,
      seed: 'test',
      requested: new Set([requested.id]),
      watchlist: new Set([onOne.id, onBoth.id]),
      wantedBy: new Map([
        [requested.id, { requested: ['Sam'], watchlist: [] }],
        [onOne.id, { requested: [], watchlist: ['Alex'] }],
        [onBoth.id, { requested: [], watchlist: ['Alex', 'Sam'] }],
      ]),
    });
    const reasons = (m: Movie) => ranked.find((r) => r.movie.id === m.id)!.reasons;
    expect(reasons(requested)).toContainEqual({ kind: 'requested', label: 'Sam requested this' });
    expect(reasons(onOne)).toContainEqual({ kind: 'watchlist', label: "On Alex's watchlist" });
    expect(reasons(onBoth)).toContainEqual({ kind: 'watchlist', label: "On Alex's and Sam's watchlists" });
  });

  it('names the person whose taste a pick follows most', () => {
    const [d, e] = [movie(), movie()];
    const heat = movie({ title: 'Heat' });
    const inception = movie({ title: 'Inception' });
    // Both like a; Sam likes it even more than the rest of the pool.
    const alexToo = taste('Alex', new Map([[a.id, 1], [b.id, 1], [d.id, 0], [e.id, 0]]), heat);
    const samToo = taste('Sam', new Map([[a.id, 1], [b.id, 0.6], [d.id, 0], [e.id, 0]]), inception);
    const together = rankMovies([a, b, d, e], {}, [], { now: NOW, seed: 'test', taste: [alexToo, samToo] });
    expect(together.find((r) => r.movie.id === a.id)!.reasons).toContainEqual({ kind: 'taste', label: 'Because Sam watched Inception' });
    const solo = rankMovies([a, b, d, e], {}, [], { now: NOW, seed: 'test', taste: { ...alexToo, name: undefined } });
    expect(solo.find((r) => r.movie.id === a.id)!.reasons).toContainEqual({ kind: 'taste', label: 'Because you watched Heat' });
  });
});

describe('formatRuntime', () => {
  it('writes a length one way, with minutes in two digits after the hours', () => {
    expect([45, 65, 105, 120, 181].map(formatRuntime)).toEqual(['45m', '1h 05m', '1h 45m', '2h', '3h 01m']);
  });
});
