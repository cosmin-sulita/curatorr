// Helpers for the tests of shared and server. Not exported from index.ts, so the app never bundles them.
import type { Movie, Ratings } from './types.js';

export const DAY = 86_400_000;

export const noRatings: Ratings = { rt: null, imdb: null, tmdb: null, metacritic: null };

/** A movie's fields to set, with only some of its ratings. */
export type MovieFields = Omit<Partial<Movie>, 'ratings'> & { ratings?: Partial<Ratings> };

/**
 * Makes movies with every field at a plain default: numbered in the order they're made (unless given an `id`), with
 * `defaults` over those and each call's fields over both. Each test file makes its own, so its numbers start at 1.
 */
export function movieMaker(defaults: MovieFields = {}) {
  let nextId = 1;
  return (fields: MovieFields = {}): Movie => {
    const id = fields.id ?? nextId++;
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
      ...defaults,
      ...fields,
      ratings: { ...noRatings, ...defaults.ratings, ...fields.ratings },
    };
  };
}
