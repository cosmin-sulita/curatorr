import { describe, expect, it } from 'vitest';
import { sagaState } from './sagas.js';
import type { RankOptions } from './scoring.js';
import { libraryIndex, rankSimilar } from './similar.js';
import { tagMovie } from './tagger.js';
import { TAGGED_MOVIES } from './tagger.fixtures.js';
import type { FeedbackEvent, Movie } from './types.js';
import { DAY, movieMaker } from './testing.js';

const movie = movieMaker();

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

  it('lets likeness decide the order, leaving ratings and requests to break near-ties', () => {
    const keywords = Array.from({ length: 20 }, (_, i) => `k${i}`);
    const own = (name: string, n: number) => Array.from({ length: n }, (_, i) => `${name} ${i}`);
    const liked = movie({ genres: ['Crime'], keywords, themes: { heist: 6 } });
    const close = movie({
      genres: ['Crime'],
      keywords: [...keywords.slice(0, 6), ...own('close', 6)],
      themes: { heist: 6 },
    });
    // Half as alike, but requested, just arrived and acclaimed.
    const wanted = movie({
      genres: ['Crime'],
      keywords: [...keywords.slice(0, 2), ...own('wanted', 10)],
      themes: { heist: 3 },
      ratings: { rt: 100, imdb: 8.5 },
      arrivedAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
    });
    const others = Array.from({ length: 10 }, (_, i) => movie({ genres: ['Drama'], keywords: own(`other ${i}`, 12) }));
    const ranked = like(liked, [wanted, close], { others, requested: new Set([wanted.id]) });
    expect(ranked.map((r) => [r.movie.id, r.tier])).toEqual([
      [close.id, 0],
      [wanted.id, 0],
    ]);
  });
});

describe('"Something like…" over a whole library', () => {
  // The tagging fixtures as a library, with ratings, a saga, new arrivals and some history to rank by.
  const library = TAGGED_MOVIES.map((t, i) =>
    movie({
      title: t.title,
      genres: t.genres,
      keywords: t.keywords,
      overview: t.overview,
      runtime: t.runtime,
      ...tagMovie(t),
      ratings: { rt: 40 + ((i * 37) % 60), imdb: 5 + ((i * 13) % 40) / 10 },
      saga: i % 9 === 0 ? { id: 77, title: 'Saga', part: i / 9 + 1, parts: 8 } : null,
      arrivedAt: i % 5 === 0 ? new Date(NOW - i * DAY).toISOString() : null,
    }),
  );
  const feedback: FeedbackEvent[] = library.flatMap((m, i): FeedbackEvent[] =>
    i % 7 === 0
      ? [{ movieId: m.id, kind: 'skipped' as const, createdAt: NOW - 2 * DAY }]
      : i % 4 === 0
        ? [{ movieId: m.id, kind: 'shown' as const, createdAt: NOW - 5 * DAY }]
        : [],
  );
  const opts = {
    now: NOW,
    seed: 'test',
    watchlist: new Set([library[3]!.id, library[10]!.id]),
    requested: new Set([library[5]!.id]),
    sagas: sagaState(library, new Set([library[0]!.id])),
  };

  /** One line per pick: enough to show a change to the list, its order, scores, matches or chips. */
  const lists = (liked: Movie) =>
    rankSimilar(library, liked, library, feedback, opts).map(
      (r) => `${r.movie.title} | ${r.tier ? 'loose' : 'strong'} | ${r.score} | ${r.reasons.map((x) => x.label).join(', ')}`,
    );

  // Tuning the ranking (its constants, matches or chips) shows here as a reviewed change to these lists.
  it('keeps its picks, scores, matches and chips from a few movies', () => {
    expect([0, 12, 25].map((i) => [library[i]!.title, ...lists(library[i]!)])).toMatchInlineSnapshot(`
      [
        [
          "Jaws",
          "The Revenant | strong | 120 | Animal attack, Based on novel or book, Edge of Your Seat",
          "Luca | strong | 115 | On your watchlist, Added 10 days ago, Monsters & Creatures",
          "The Lord of the Rings: The Return of the King | strong | 95.1 | Monsters & Creatures, Based on novel or book",
          "Superman | strong | 92.4 | Monsters & Creatures",
          "28 Weeks Later | loose | 123.3 | Edge of Your Seat",
          "Finding Nemo | loose | 101.6 | Shark",
          "Twisters | loose | 98.9 | Dying and death, Edge of Your Seat",
          "Gone Girl | loose | 75.3 | Based on novel or book, Edge of Your Seat",
          "True Grit | loose | 68.7 | Based on novel or book, Dark & Heavy",
          "Split | loose | 65.9 | Edge of Your Seat",
          "The Shawshank Redemption | loose | 65 | Based on novel or book, Dark & Heavy",
          "Get Out | loose | 60.7 | Edge of Your Seat",
        ],
        [
          "Ocean's Eleven",
          "Heat | strong | 120.8 | Heists & Cons, Ex-con, Remake, Edge of Your Seat",
          "True Grit | loose | 44.5 | Remake",
          "Paddington 2 | loose | 40.9 | On your watchlist, Light & Fun",
          "The Third Man | loose | 38.1 | Next in Saga, Edge of Your Seat",
          "Luca | loose | 35.4 | On your watchlist, Added 10 days ago, Light & Fun",
          "Oscar Shaw | loose | 35.3 | Edge of Your Seat",
          "Gone Girl | loose | 35 | Edge of Your Seat",
          "The Wild Robot | loose | 35 | Light & Fun",
          "Snow White | loose | 34.3 | Remake",
          "The Revenant | loose | 34.1 | Remake, Edge of Your Seat",
          "Contagion | loose | 33.8 | Edge of Your Seat",
          "John Wick | loose | 33.7 | Edge of Your Seat",
        ],
        [
          "The Lord of the Rings: The Return of the King",
          "The Prestige | strong | 121.7 | Magic & Wizards, Obsession, Based on novel or book",
          "Gladiator II | strong | 119 | Myths & Dragons, Something Epic",
          "Superman | strong | 114.5 | Monsters & Creatures, Something Epic",
          "Heat | strong | 107 | Honor, Obsession, Something Epic",
          "Paddington 2 | strong | 99.3 | On your watchlist, Live action and animation, Based on novel or book",
          "Encanto | strong | 96 | Magic & Wizards",
          "Luca | strong | 78.4 | On your watchlist, Added 10 days ago, Monsters & Creatures",
          "Jaws | strong | 62.7 | Added today, Monsters & Creatures, Based on novel or book",
        ],
      ]
    `);
  });

  it("ranks from what the library's index worked out, without reading each candidate's keywords again", () => {
    let reads = 0;
    const counted = (keywords: string[]) =>
      new Proxy(keywords, {
        get(target, prop, receiver) {
          reads++;
          return Reflect.get(target, prop, receiver);
        },
      });
    const liked = movie({ keywords: ['heist', 'bank robbery'] });
    const eligible = Array.from({ length: 30 }, (_, i) => movie({ keywords: counted(['heist', `clue ${i}`]) }));
    const all = [liked, ...eligible];
    libraryIndex(all); // worked out once per library, which the store keeps until the next sync
    reads = 0;
    expect(rankSimilar(eligible, liked, all, [], { now: NOW, seed: 'test' })).toHaveLength(12);
    expect(reads).toBe(0);
  });
});
