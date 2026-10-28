import { describe, expect, it } from 'vitest';
import { emptySagaState, sagaState } from './sagas.js';
import {
  NEXT_PART_BONUS,
  addedReasons,
  personalAdjustment,
  profileSignals,
  qualityScore,
  topRanked,
  wantedReasons,
  type RankOptions,
  type RankedMovie,
} from './scoring.js';
import { libraryIndex, norm, rankSimilar, signature, type Signature } from './similar.js';
import { keywordPhrases, tagMovie } from './tagger.js';
import { TAGGED_MOVIES } from './tagger.fixtures.js';
import { moodById, themeById, type MoodDef, type ThemeDef } from './taxonomy.js';
import type { FeedbackEvent, Movie, Reason } from './types.js';
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
  /** Today's ranking, kept to prove the faster one gives the same lists: it works out every candidate's chips. */
  function referenceRankSimilar(
    eligible: Movie[],
    liked: Movie,
    library: Movie[],
    feedback: FeedbackEvent[],
    opts: RankOptions,
  ) {
    const { idf, entries, typicalNorm } = libraryIndex(library);
    const signatureOf = (m: Movie) => entries.get(m.id)?.sig ?? signature(m, idf);
    const usable = (m: Movie) =>
      new Set([...signature(m, idf).keys()].filter((k) => k.startsWith('k:')).map((k) => k.slice(2)));
    const similarityOf = (a: Signature, b: Signature) => {
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      let dot = 0;
      for (const [feature, w] of small) dot += w * (large.get(feature) ?? 0);
      const n = Math.max(norm(a), typicalNorm) * Math.max(norm(b), typicalNorm);
      return n ? dot / n : 0;
    };
    const sharedTags = (a: Record<string, number>, b: Record<string, number>) =>
      Object.keys(b)
        .filter((id) => (a[id] ?? 0) > 0)
        .sort((x, y) => Math.min(a[y]!, b[y]!) - Math.min(a[x]!, b[x]!));
    const termsOf = (def: ThemeDef | MoodDef | undefined) =>
      [...(def?.strong ?? []), ...(def?.weak ?? [])].map((t) => t.toLowerCase());
    const tagReasons = (shared: { themes: string[]; moods: string[]; keywords: string[] }): Reason[] => {
      const covered = new Set([
        ...shared.themes.flatMap((id) => termsOf(themeById.get(id))),
        ...shared.moods.flatMap((id) => termsOf(moodById.get(id))),
      ]);
      const keywords = shared.keywords.filter((k) => ![...keywordPhrases(k)].some((p) => covered.has(p)));
      return [
        ...shared.themes.slice(0, 2).map((id): Reason => ({ kind: 'theme', label: themeById.get(id)?.label ?? id })),
        ...keywords.slice(0, 2).map((k): Reason => ({ kind: 'keyword', label: k[0]!.toUpperCase() + k.slice(1) })),
        ...shared.moods.slice(0, 1).map((id): Reason => ({ kind: 'mood', label: moodById.get(id)?.label ?? id })),
      ].slice(0, 4);
    };
    const likedSig = signatureOf(liked);
    const likedKeywords = usable(liked);
    const signals = profileSignals(feedback, opts);
    const sagas = opts.sagas ?? emptySagaState();
    const candidates = eligible.flatMap((m) => {
      if (m.id === liked.id || (liked.saga && m.saga?.id === liked.saga.id)) return [];
      const sim = similarityOf(likedSig, signatureOf(m));
      return sim > 0 ? [{ m, sim }] : [];
    });
    const best = Math.max(0, ...candidates.map((c) => c.sim));
    const ranked = candidates.map(({ m, sim }): RankedMovie => {
      const shared = {
        themes: sharedTags(liked.themes, m.themes),
        moods: sharedTags(liked.moods, m.moods),
        keywords: [...usable(m)]
          .filter((k) => likedKeywords.has(k))
          .sort((x, y) => (idf.get(y) ?? 0) - (idf.get(x) ?? 0)),
      };
      const quality = qualityScore(m.ratings);
      const adj = personalAdjustment(m, signals, opts);
      let score = 100 * (sim / best) + 0.3 * quality + adj.delta;
      const sagaReasons: Reason[] = [];
      if (sagas.next.has(m.id) && m.saga) {
        score += NEXT_PART_BONUS;
        sagaReasons.push({ kind: 'saga', label: `Next in ${m.saga.title}` });
      }
      const strong = sim >= 0.4 * best && (shared.themes.length > 0 || shared.keywords.length >= 2);
      return {
        movie: m,
        score: Math.round(score * 10) / 10,
        quality,
        tier: strong ? 0 : 1,
        reasons: [
          ...wantedReasons(adj, opts.wantedBy?.get(m.id)),
          ...sagaReasons,
          ...addedReasons(adj),
          ...tagReasons(shared),
        ],
      };
    });
    return topRanked(ranked, opts.limit);
  }

  const DAY = 86_400_000;
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

  it('gives the same picks, scores, matches and chips as before, from every movie', () => {
    for (const liked of library) {
      for (const limit of [undefined, 1000]) {
        const want = referenceRankSimilar(library, liked, library, feedback, { ...opts, limit });
        expect(rankSimilar(library, liked, library, feedback, { ...opts, limit })).toEqual(want);
      }
    }
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
