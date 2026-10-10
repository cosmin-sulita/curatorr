import { tagMovie } from '@curatorr/shared';
import { normalizeBaseUrl, request, requestJson } from '../http.js';
import type { StoredMovie } from '../store.js';

interface RadarrRating {
  value?: number;
}

interface RadarrImage {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}

/** The subset of Radarr's /api/v3/movie resource that Curatorr uses. */
export interface RadarrMovie {
  id: number;
  title: string;
  year?: number;
  overview?: string;
  runtime?: number;
  certification?: string;
  genres?: string[];
  keywords?: string[];
  tmdbId?: number;
  imdbId?: string;
  hasFile?: boolean;
  added?: string;
  /** Set when the movie has a file; `dateAdded` is when Radarr imported it. */
  movieFile?: { dateAdded?: string };
  youTubeTrailerId?: string;
  images?: RadarrImage[];
  ratings?: {
    imdb?: RadarrRating;
    tmdb?: RadarrRating;
    metacritic?: RadarrRating;
    rottenTomatoes?: RadarrRating;
  };
  collection?: { title?: string; tmdbId?: number };
}

/** A Radarr collection; `movies` lists every part, owned or not. */
export interface RadarrCollection {
  tmdbId: number;
  title: string;
  movies?: { tmdbId: number; title: string; year?: number }[];
}

const SERVICE = 'Radarr';

export class RadarrClient {
  readonly baseUrl: string;

  constructor(
    url: string,
    private readonly apiKey: string,
  ) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  private headers() {
    return { 'X-Api-Key': this.apiKey, Accept: 'application/json' };
  }

  status() {
    return requestJson<{ version: string; appName?: string; instanceName?: string }>(
      SERVICE,
      `${this.baseUrl}/api/v3/system/status`,
      { headers: this.headers(), timeoutMs: 8_000 },
    );
  }

  movies() {
    return requestJson<RadarrMovie[]>(SERVICE, `${this.baseUrl}/api/v3/movie`, {
      headers: this.headers(),
      timeoutMs: 120_000,
    });
  }

  /** Collections with all their parts (Radarr 4.3+). */
  collections() {
    return requestJson<RadarrCollection[]>(SERVICE, `${this.baseUrl}/api/v3/collection`, {
      headers: this.headers(),
      timeoutMs: 60_000,
    });
  }

  /** Fetches a MediaCover image. `path` is the `url` Radarr reports, e.g. /MediaCover/12/poster.jpg. */
  image(path: string) {
    return request(SERVICE, new URL(path, `${this.baseUrl}/`).toString(), { headers: { 'X-Api-Key': this.apiKey } });
  }
}

/** Swaps TMDB's /original/ size for a smaller rendition. */
export function tmdbSized(url: string | undefined, size: string): string | null {
  if (!url) return null;
  return url.replace(/\/t\/p\/original\//, `/t/p/${size}/`);
}

function rating(r: RadarrRating | undefined): number | null {
  return r?.value && r.value > 0 ? r.value : null;
}

/** A Radarr date in one ISO format, so stored dates compare as text; null when missing or invalid. */
function isoDate(value: string | undefined): string | null {
  const t = value ? Date.parse(value) : NaN;
  return t > 0 ? new Date(t).toISOString() : null;
}

/** Maps a Radarr movie to Curatorr's shape, including derived theme/mood tags. */
export function fromRadarr(r: RadarrMovie): StoredMovie {
  const poster = r.images?.find((i) => i.coverType === 'poster');
  const fanart = r.images?.find((i) => i.coverType === 'fanart');
  const genres = r.genres ?? [];
  const keywords = (r.keywords ?? []).map((k) => k.toLowerCase());
  const overview = r.overview ?? '';
  const runtime = r.runtime && r.runtime > 0 ? r.runtime : null;

  const posterProxy = poster?.url ? `/api/image/${r.id}/poster` : null;
  const fanartProxy = fanart?.url ? `/api/image/${r.id}/fanart` : null;

  return {
    id: r.id,
    tmdbId: r.tmdbId ?? null,
    imdbId: r.imdbId || null,
    title: r.title,
    year: r.year || null,
    overview,
    runtime,
    certification: r.certification?.trim() || null,
    genres,
    keywords,
    ...tagMovie({ genres, keywords, overview, runtime }),
    ratings: {
      rt: rating(r.ratings?.rottenTomatoes),
      imdb: rating(r.ratings?.imdb),
      tmdb: rating(r.ratings?.tmdb),
      metacritic: rating(r.ratings?.metacritic),
    },
    posterUrl: tmdbSized(poster?.remoteUrl, 'w500') ?? posterProxy,
    fanartUrl: tmdbSized(fanart?.remoteUrl, 'w1280') ?? fanartProxy,
    posterPath: poster?.url ?? null,
    fanartPath: fanart?.url ?? null,
    trailerId: r.youTubeTrailerId || null,
    plexRatingKey: null,
    plexSlug: null,
    plexGuid: null,
    // Part numbers are filled in by assignSagas once all collections are known.
    saga: r.collection?.tmdbId
      ? { id: r.collection.tmdbId, title: sagaTitle(r.collection.title ?? r.title), part: 0, parts: 0 }
      : null,
    addedAt: r.added ?? null,
    arrivedAt: isoDate(r.movieFile?.dateAdded),
  };
}

/** "The Matrix Collection" → "The Matrix". */
export function sagaTitle(title: string) {
  return title.replace(/\s+collection$/i, '').trim() || title;
}

// Release order; unknown years (unannounced parts) go last.
const byRelease = (a: { year?: number | null; tmdbId?: number | null }, b: typeof a) =>
  (a.year || Infinity) - (b.year || Infinity) || (a.tmdbId ?? 0) - (b.tmdbId ?? 0);

/**
 * Numbers each movie's part within its collection, counting every part in release
 * order, owned or not. Without collection data (older Radarr) only the owned parts
 * are counted.
 */
export function assignSagas(movies: StoredMovie[], collections: RadarrCollection[] | null) {
  const byId = new Map((collections ?? []).map((c) => [c.tmdbId, c]));
  const groups = new Map<number, StoredMovie[]>();
  for (const m of movies) {
    if (!m.saga) continue;
    groups.set(m.saga.id, [...(groups.get(m.saga.id) ?? []), m]);
  }

  for (const [id, owned] of groups) {
    const collection = byId.get(id);
    const order = collection?.movies?.length ? [...collection.movies].sort(byRelease).map((p) => p.tmdbId) : null;
    if (order && owned.every((m) => m.tmdbId != null && order.includes(m.tmdbId))) {
      for (const m of owned) {
        m.saga = { id, title: sagaTitle(collection!.title), part: order.indexOf(m.tmdbId!) + 1, parts: order.length };
      }
    } else {
      [...owned].sort(byRelease).forEach((m, i) => {
        m.saga = { ...m.saga!, part: i + 1, parts: owned.length };
      });
    }
  }
}
