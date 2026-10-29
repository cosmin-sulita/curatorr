// Quality: half what critics think, half what audiences think.
import type { Ratings } from './types.js';

/** A missing critics' or audience score counts as this, pulling a movie with only one toward the middle. */
const MISSING_SCORE = 50;

/** An audience rating out of 10 as a percentage, roughly the share who liked it: 5.0 is 40%, 7.0 is 80%. */
function audiencePercent(rating: number) {
  return Math.min(100, Math.max(0, (rating - 3) * 20));
}

/**
 * The Rotten Tomatoes critics' score averaged with the audience's IMDb rating (TMDB's, which runs
 * about 0.3 higher, when there's none), so a crowd-pleaser the critics panned still gets its chance.
 */
export function qualityScore(r: Ratings): number {
  const critics = r.rt != null && r.rt > 0 ? r.rt : MISSING_SCORE;
  const audience =
    r.imdb != null && r.imdb > 0
      ? audiencePercent(r.imdb)
      : r.tmdb != null && r.tmdb > 0
        ? audiencePercent(r.tmdb - 0.3)
        : MISSING_SCORE;
  return (critics + audience) / 2;
}
