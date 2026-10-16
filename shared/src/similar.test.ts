import { describe, expect, it } from 'vitest';
import { sagaState } from './sagas.js';
import type { RankOptions } from './scoring.js';
import { rankSimilar } from './similar.js';
import type { FeedbackEvent, Movie, Ratings } from './types.js';

const noRatings: Ratings = { rt: null, imdb: null, tmdb: null, metacritic: null };

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
    jellyfinId: null,
    saga: null,
    addedAt: null,
    arrivedAt: null,
    ...partial,
    ratings: { ...noRatings, ...partial.ratings },
  };
}

const NOW = Date.parse('2026-10-08T20:00:00Z');

/** Ranks `eligible` by likeness to `liked`; the library is everything given. */
function like(
  liked: Movie,
  eligible: Movie[],
  { feedback = [], others = [], ...opts }: { feedback?: FeedbackEvent[]; others?: Movie[] } & Partial<RankOptions> = {},
) {
  return rankSimilar(eligible, liked, [liked, ...eligible, ...others], feedback, { now: NOW, seed: 'test', ...opts });
}

const ids = (ranked: { movie: Movie }[]) => ranked.map((r) => r.movie.id);

describe('rankSimilar', () => {
  it('prefers a rare shared keyword to a common one', () => {
    const liked = movie({ keywords: ['time loop', 'based on novel or book'] });
    const rare = movie({ keywords: ['time loop'], ratings: { rt: 60 } });
    const common = movie({ keywords: ['based on novel or book'], ratings: { rt: 95 } });
    const others = Array.from({ length: 10 }, () => movie({ genres: ['Drama'], keywords: ['based on novel or book'] }));
    expect(ids(like(liked, [common, rare], { others }))).toEqual([rare.id, common.id]);
  });

  it('counts a shared theme above a shared genre, whatever the ratings', () => {
    const liked = movie({ themes: { heist: 4 } });
    const sameTheme = movie({ genres: ['Drama'], themes: { heist: 4 }, ratings: { rt: 60 } });
    const sameGenre = movie({ ratings: { rt: 100 } });
    const ranked = like(liked, [sameGenre, sameTheme]);
    expect(ids(ranked)).toEqual([sameTheme.id, sameGenre.id]);
    expect(ranked.map((r) => r.tier)).toEqual([0, 1]);
  });

  it('leaves out the liked movie and the rest of its saga', () => {
    const saga = { id: 9, title: 'Back to the Future', parts: 3 };
    const liked = movie({ keywords: ['time travel'], saga: { ...saga, part: 1 } });
    const sequel = movie({ keywords: ['time travel'], saga: { ...saga, part: 2 } });
    const other = movie({ keywords: ['time travel'] });
    const sagas = sagaState([liked, sequel], new Set([liked.id]));
    expect(ids(like(liked, [liked, sequel, other], { sagas }))).toEqual([other.id]);
  });

  it('drops movies with nothing in common', () => {
    const liked = movie({ genres: ['Horror'], keywords: ['ghost'] });
    const unrelated = movie({ genres: ['Comedy'], keywords: ['wedding'] });
    expect(like(liked, [unrelated])).toEqual([]);
  });

  it('explains a pick with shared themes and keywords, without repeating what a theme covers', () => {
    const liked = movie({ keywords: ['heist', 'casino', 'las vegas'], themes: { heist: 6 }, moods: { light: 3 } });
    const pick = movie({ keywords: ['las vegas', 'casino', 'heist'], themes: { heist: 4 }, moods: { light: 2 } });
    expect(like(liked, [pick])[0]!.reasons).toEqual([
      { kind: 'theme', label: 'Heists & Cons' },
      { kind: 'keyword', label: 'Las vegas' },
      { kind: 'mood', label: 'Light & Fun' },
    ]);
  });

  it('still applies skips, the watchlist and requests', () => {
    const liked = movie({ keywords: ['zombie', 'outbreak'], themes: { zombies: 6 } });
    const [a, b] = [movie({ keywords: ['zombie', 'outbreak'] }), movie({ keywords: ['zombie', 'outbreak'] })];
    const skipped = like(liked, [a!, b!], { feedback: [{ movieId: a!.id, kind: 'skipped', createdAt: NOW - 1000 }] });
    expect(ids(skipped)[0]).toBe(b!.id);
    const wanted = like(liked, [a!, b!], { watchlist: new Set([b!.id]) });
    expect(ids(wanted)[0]).toBe(b!.id);
    expect(wanted[0]!.reasons[0]).toEqual({ kind: 'watchlist', label: 'On your watchlist' });
    const requested = like(liked, [a!, b!], { requested: new Set([a!.id]) });
    expect(ids(requested)[0]).toBe(a!.id);
    expect(requested[0]!.reasons[0]).toEqual({ kind: 'requested', label: 'You requested this' });
  });

  it('treats one small thing in common as a loose match', () => {
    const keywords = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
    const liked = movie({ keywords, themes: { heist: 6, space: 6 } });
    const twin = movie({ keywords, themes: { heist: 6, space: 6 } });
    const faint = movie({
      genres: ['Drama'],
      keywords: Array.from({ length: 16 }, (_, i) => `other ${i}`),
      themes: { heist: 2 },
    });
    const ranked = like(liked, [faint, twin]);
    expect(ranked.map((r) => [r.movie.id, r.tier])).toEqual([
      [twin.id, 0],
      [faint.id, 1],
    ]);
  });

  it('only pads with loose matches when there are few strong ones', () => {
    const liked = movie({ themes: { heist: 6 } });
    const loose = Array.from({ length: 3 }, () => movie({ ratings: { rt: 100 } }));
    const few = like(liked, [...loose, movie({ themes: { heist: 6 } })]);
    expect(few.map((r) => r.tier)).toEqual([0, 1, 1, 1]);

    const strong = Array.from({ length: 6 }, () => movie({ themes: { heist: 6 } }));
    const many = like(liked, [...loose, ...strong]);
    expect(ids(many).sort()).toEqual(strong.map((m) => m.id).sort());
  });

  it("doesn't match movies on TMDB's tone words", () => {
    // The Woman in the Yard and a Jack Ryan movie: both "absurd" and "suspense" on TMDB, and both Edge of Your Seat.
    const liked = movie({
      genres: ['Horror', 'Mystery'],
      keywords: ['absurd', 'suspense', 'widow', 'psychological horror', 'isolated farmhouse'],
      themes: { supernatural: 2, psychological: 2 },
      moods: { edge: 5 },
    });
    const spy = movie({
      genres: ['Action', 'Thriller'],
      keywords: ['absurd', 'suspense', 'jack ryan'],
      themes: { spies: 2 },
      moods: { edge: 5 },
    });
    const ghost = movie({
      genres: ['Horror'],
      keywords: ['ghost', 'haunted house'],
      themes: { supernatural: 4 },
      moods: { edge: 5 },
    });
    const others = Array.from({ length: 30 }, () => movie({ genres: ['Drama'], keywords: ['family', 'friendship'] }));
    const ranked = like(liked, [spy, ghost], { others });
    expect(ranked.map((r) => [r.movie.id, r.tier])).toEqual([
      [ghost.id, 0],
      [spy.id, 1],
    ]);
    expect(ranked[1]!.reasons).not.toContainEqual({ kind: 'keyword', label: 'Absurd' });
  });

  it("doesn't rank a movie TMDB knows little about above one that shares more", () => {
    const keywords = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'];
    const liked = movie({ genres: ['Crime'], keywords, themes: { heist: 6 } });
    const thin = movie({ genres: ['Crime'], themes: { heist: 6 } });
    const rich = movie({
      genres: ['Crime'],
      keywords: [...keywords.slice(0, 4), ...Array.from({ length: 8 }, (_, i) => `rich ${i}`)],
      themes: { heist: 6 },
    });
    // A typical movie here has ten keywords.
    const others = Array.from({ length: 10 }, (_, i) =>
      movie({ genres: ['Drama'], keywords: Array.from({ length: 10 }, (_, j) => `other ${i}-${j}`) }),
    );
    expect(ids(like(liked, [thin, rich], { others }))).toEqual([rich.id, thin.id]);
  });
});
