import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankMovies } from './scoring.js';
import { tasteEvents, tasteProfile } from './taste.js';
import type { Movie, Ratings } from './types.js';

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
    genres: ['Horror'],
    keywords: [],
    themes: {},
    moods: {},
    posterUrl: null,
    fanartUrl: null,
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

const DAY = 86_400_000;
// 9 pm in UTC, so the 4 am turnover is well away from every event below.
const NOW = Date.parse('2026-10-08T21:00:00Z');

const zombie = (title?: string) => movie({ title, keywords: ['zombie', 'outbreak', 'survival'], themes: { zombies: 6 } });
const romance = (title?: string) =>
  movie({ title, genres: ['Romance'], keywords: ['wedding', 'love', 'paris'], themes: { romance: 6 } });
const watchedAt = (ms: Movie[], daysAgo: number) => ms.map((m) => ({ movieId: m.id, viewedAt: NOW - daysAgo * DAY }));

beforeEach(() => vi.stubEnv('TZ', 'UTC'));
afterEach(() => vi.unstubAllEnvs());

describe('tasteProfile', () => {
  it('likes movies like the ones watched', () => {
    const seen = Array.from({ length: 5 }, () => zombie());
    const [z, r] = [zombie(), romance()];
    const taste = tasteProfile([...seen, z, r], tasteEvents(watchedAt(seen, 10), []), NOW);
    expect(taste.affinity(z)).toBeGreaterThan(taste.affinity(r));
  });

  it('counts for nothing without history, and for more with more of it', () => {
    const library = Array.from({ length: 30 }, () => zombie());
    const confidence = (n: number) => tasteProfile(library, tasteEvents(watchedAt(library.slice(0, n), 5), []), NOW).confidence;
    expect(confidence(0)).toBe(0);
    expect(confidence(10)).toBeCloseTo(0.5, 5);
    expect(confidence(30)).toBeGreaterThan(confidence(10));
  });

  it('leans toward what was watched lately', () => {
    const longAgo = Array.from({ length: 5 }, () => romance());
    const lately = Array.from({ length: 5 }, () => zombie());
    const [z, r] = [zombie(), romance()];
    const events = tasteEvents([...watchedAt(longAgo, 400), ...watchedAt(lately, 7)], []);
    const taste = tasteProfile([...longAgo, ...lately, z, r], events, NOW);
    expect(taste.affinity(z)).toBeGreaterThan(taste.affinity(r));
  });

  it("leaves tonight's watches until tomorrow, so the picks stay put all evening", () => {
    const seen = Array.from({ length: 5 }, () => zombie());
    const events = tasteEvents(watchedAt(seen, 1 / 24), []);
    expect(tasteProfile(seen, events, NOW).confidence).toBe(0);
    expect(tasteProfile(seen, events, NOW + DAY).confidence).toBeGreaterThan(0);
  });

  it('explains a pick with the watched movie it resembles most', () => {
    const night = zombie('Night of the Living Dead');
    const notebook = romance('The Notebook');
    const pick = zombie();
    const taste = tasteProfile([night, notebook, pick], tasteEvents(watchedAt([night, notebook], 10), []), NOW);
    expect(taste.because(pick)?.title).toBe('Night of the Living Dead');
  });

  it("explains a pick only with a watched movie it may name, such as one everyone picking may see", () => {
    const dawn = movie({ title: 'Dawn of the Dead', certification: 'R', keywords: ['zombie', 'outbreak', 'survival'], themes: { zombies: 6 } });
    const shaun = movie({ title: 'Shaun of the Dead', certification: 'PG', keywords: ['zombie', 'pub'], themes: { zombies: 3 } });
    const pick = zombie();
    const library = [dawn, shaun, pick];
    const events = tasteEvents(watchedAt([dawn, shaun], 10), []);
    expect(tasteProfile(library, events, NOW).because(pick)?.title).toBe('Dawn of the Dead');
    const notR = (m: Movie) => m.certification !== 'R';
    const taste = tasteProfile(library, events, NOW, notR);
    expect(taste.because(pick)?.title).toBe('Shaun of the Dead');
    // What it likes stays the same.
    expect(taste.affinity(pick)).toBe(tasteProfile(library, events, NOW).affinity(pick));
  });
});

describe('tasteEvents', () => {
  it('counts a movie once, by its strongest sign', () => {
    const [a, b] = [movie(), movie()];
    const events = tasteEvents(
      [{ movieId: a.id, viewedAt: NOW - DAY }],
      [
        { movieId: a.id, kind: 'seen', createdAt: NOW },
        { movieId: b.id, kind: 'seen', createdAt: NOW },
        { movieId: b.id, kind: 'skipped', createdAt: NOW },
      ],
    );
    expect(events).toEqual([
      { movieId: a.id, at: NOW - DAY, weight: 1 },
      { movieId: b.id, at: NOW, weight: 0.3 },
    ]);
  });

  it('counts the watch "Seen it" made on the media server as the mark, not as a watch', () => {
    const [a, b] = [movie(), movie()];
    // Plex dates it when Curatorr marks it, in whole seconds, so just before the mark; another server's clock may run ahead.
    const events = tasteEvents(
      [
        { movieId: a.id, viewedAt: NOW - 1000 },
        { movieId: b.id, viewedAt: NOW + 2 * 60_000 },
      ],
      [
        { movieId: a.id, kind: 'seen', createdAt: NOW, serverSynced: true },
        { movieId: b.id, kind: 'seen', createdAt: NOW, serverSynced: true },
      ],
    );
    expect(events).toEqual([
      { movieId: a.id, at: NOW, weight: 0.3 },
      { movieId: b.id, at: NOW, weight: 0.3 },
    ]);
  });

  it('still counts a real watch of a movie marked "Seen it"', () => {
    const [rewatched, watchedFirst] = [movie(), movie()];
    const events = tasteEvents(
      [
        { movieId: rewatched.id, viewedAt: NOW + 3 * DAY },
        // Watched in Plex just before the tap, so the mark had nothing to change there.
        { movieId: watchedFirst.id, viewedAt: NOW - 5 * 60_000 },
      ],
      [
        { movieId: rewatched.id, kind: 'seen', createdAt: NOW, serverSynced: true },
        { movieId: watchedFirst.id, kind: 'seen', createdAt: NOW },
      ],
    );
    expect(events).toEqual([
      { movieId: rewatched.id, at: NOW + 3 * DAY, weight: 1 },
      { movieId: watchedFirst.id, at: NOW - 5 * 60_000, weight: 1 },
    ]);
  });
});

describe('ranking with taste', () => {
  // 30 zombie movies watched: taste counts three quarters, worth ±4.5 points between two candidates.
  const seen = Array.from({ length: 30 }, (_, i) => zombie(i === 0 ? 'Dawn of the Dead' : undefined));
  const z = { ...zombie(), ratings: { ...noRatings, rt: 80 } };
  const r = { ...romance(), ratings: { ...noRatings, rt: 82 } };
  const tasteOf = (watches = seen) => tasteProfile([...seen, z, r], tasteEvents(watchedAt(watches, 3), []), NOW);

  it('puts what the profile tends to watch first, and says why', () => {
    const ranked = rankMovies([r, z], {}, [], { now: NOW, seed: 'test', taste: tasteOf() });
    expect(ranked.map((x) => x.movie.id)).toEqual([z.id, r.id]);
    expect(ranked[0]!.reasons[0]).toEqual({ kind: 'taste', label: 'Because you watched Dawn of the Dead' });
    expect(ranked[1]!.reasons.some((x) => x.kind === 'taste')).toBe(false);
  });

  it('changes nothing without history', () => {
    const without = rankMovies([r, z], {}, [], { now: NOW, seed: 'test' });
    expect(rankMovies([r, z], {}, [], { now: NOW, seed: 'test', taste: tasteOf([]) })).toEqual(without);
  });

  it('keeps the personal chips first and the rating last', () => {
    const ranked = rankMovies([r, z], {}, [], { now: NOW, seed: 'test', taste: tasteOf(), requested: new Set([z.id]) });
    expect(ranked[0]!.reasons.map((x) => x.kind)).toEqual(['requested', 'taste', 'rating']);
  });
});
