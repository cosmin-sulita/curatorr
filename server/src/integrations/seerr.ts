import type { Movie } from '@curatorr/shared';
import { normalizeBaseUrl, requestJson } from '../http.js';
import type { ProfileRow } from '../store.js';
import { jellyfinIdKey } from './jellyfin.js';

/** The account a Seerr user signs in with: a plex.tv account, or a Jellyfin user. */
interface SeerrAccount {
  plexId?: number | null;
  jellyfinUserId?: string | null;
}

/** The subset of a Seerr user that Curatorr uses. */
export interface SeerrUser extends SeerrAccount {
  id: number;
  displayName?: string;
}

/** The subset of Seerr's /api/v1/request resource that Curatorr uses. */
export interface SeerrRequest {
  id: number;
  /** 1 pending, 2 approved, 3 declined, 4 failed, 5 completed. */
  status: number;
  type?: 'movie' | 'tv';
  createdAt?: string;
  media?: { tmdbId?: number | null; mediaType?: 'movie' | 'tv' };
  requestedBy?: SeerrAccount & { id: number };
}

interface SeerrPage<T> {
  pageInfo?: { results?: number };
  results?: T[];
}

const SERVICE = 'Seerr';
const PAGE_SIZE = 100;
/** Stops a misbehaving server from paging forever; 10,000 requests is plenty for a household. */
const MAX_PAGES = 100;
const DECLINED = 3;

export class SeerrClient {
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

  /** The user the API key signs in as (the Seerr admin); fails on a wrong key. */
  me() {
    return requestJson<SeerrUser>(SERVICE, `${this.baseUrl}/api/v1/auth/me`, { headers: this.headers(), timeoutMs: 8_000 });
  }

  private async all<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ ...params, take: String(PAGE_SIZE), skip: String(page * PAGE_SIZE) });
      const body = await requestJson<SeerrPage<T>>(SERVICE, `${this.baseUrl}/api/v1/${path}?${query}`, {
        headers: this.headers(),
        timeoutMs: 30_000,
      });
      const results = body.results ?? [];
      out.push(...results);
      if (results.length < PAGE_SIZE || out.length >= (body.pageInfo?.results ?? 0)) break;
    }
    return out;
  }

  users() {
    return this.all<SeerrUser>('user');
  }

  /** Every movie request, by anyone. Older versions ignore `mediaType`, so callers filter too. */
  movieRequests() {
    return this.all<SeerrRequest>('request', { filter: 'all', mediaType: 'movie', sort: 'added' });
  }
}

export interface RequestEntry {
  profileId: number;
  movieId: number;
  requestedAt: number | null;
}

const plexAccount = (id: number) => `plex:${id}`;
const jellyfinAccount = (id: string) => `jellyfin:${jellyfinIdKey(id)}`;
const accountOf = (u: SeerrAccount | undefined) =>
  u?.plexId ? plexAccount(u.plexId) : u?.jellyfinUserId ? jellyfinAccount(u.jellyfinUserId) : undefined;

/**
 * Pairs movie requests with profiles by Plex or Jellyfin account and with library movies by TMDB id.
 * Declined requests, TV and movies not in the library are left out. A movie requested
 * more than once by the same person keeps the earliest request.
 */
export function matchRequests(
  profiles: Pick<ProfileRow, 'id' | 'plex_user_id' | 'jellyfin_user_id'>[],
  movies: Pick<Movie, 'id' | 'tmdbId'>[],
  users: SeerrUser[],
  requests: SeerrRequest[],
): RequestEntry[] {
  const profileByAccount = new Map<string, number>();
  for (const p of profiles) {
    if (p.plex_user_id != null) profileByAccount.set(plexAccount(p.plex_user_id), p.id);
    if (p.jellyfin_user_id != null) profileByAccount.set(jellyfinAccount(p.jellyfin_user_id), p.id);
  }
  // Request listings may leave out each requester's account; the user list has it.
  const accountByUser = new Map(users.map((u) => [u.id, accountOf(u)] as const));
  const movieByTmdb = new Map(movies.flatMap((m) => (m.tmdbId != null ? [[m.tmdbId, m.id]] : [])));

  const out = new Map<string, RequestEntry>();
  for (const r of requests) {
    if (r.status === DECLINED || (r.type ?? r.media?.mediaType) !== 'movie') continue;
    const account = (r.requestedBy && accountByUser.get(r.requestedBy.id)) ?? accountOf(r.requestedBy);
    const profileId = account ? profileByAccount.get(account) : undefined;
    const movieId = r.media?.tmdbId != null ? movieByTmdb.get(r.media.tmdbId) : undefined;
    if (profileId == null || movieId == null) continue;

    const parsed = r.createdAt ? Date.parse(r.createdAt) : NaN;
    const requestedAt = Number.isNaN(parsed) ? null : parsed;
    const key = `${profileId}:${movieId}`;
    const earlier = out.get(key);
    if (!earlier || (requestedAt != null && (earlier.requestedAt == null || requestedAt < earlier.requestedAt))) {
      out.set(key, { profileId, movieId, requestedAt });
    }
  }
  return [...out.values()];
}
