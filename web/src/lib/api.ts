import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppStatus,
  Criteria,
  FeedbackKind,
  LikeSeed,
  MediaServer,
  MovieDTO,
  Profile,
  RecommendationsResponse,
  WizardOptionsResponse,
  WizardStep,
} from '@curatorr/shared';
import { withQuery } from './router';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** True when the server could not be reached at all (offline, container down). */
export const isNetworkError = (err: unknown) => err instanceof TypeError;

export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; keepalive?: boolean } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    keepalive: init.keepalive,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? res.statusText), data);
  return data as T;
}

export const errorMessage = (err: unknown) =>
  isNetworkError(err) ? "Can't reach Curatorr. Check your connection." : err instanceof Error ? err.message : String(err);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => api<AppStatus>('/api/status'),
    refetchInterval: (q) => (q.state.data?.library.syncing ? 2_000 : false),
    refetchOnWindowFocus: true,
    // Many components read the status; refetching on each mount would also bounce the
    // "can't reach Curatorr" screen back to the splash in a loop while offline.
    refetchOnMount: false,
    retryOnMount: false,
  });
}

/** `locked`: the profile's Plex PIN hasn't been entered on this device yet. */
export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: () => api<(Profile & { locked: boolean })[]>('/api/profiles') });
}

const criteriaParams = (c: Criteria) => ({ genre: c.genre, theme: c.theme, mood: c.mood, time: c.time, shelf: c.shelf });

// Each query's options live in one place, so loading a screen ahead of time uses the very key the screen reads.

/** The questions are kept a while after leaving them, so coming back from a pick shows them at once. */
const KEEP_QUESTIONS = 30 * 60_000;

export const wizardQuery = (step: WizardStep, criteria: Criteria) =>
  queryOptions({
    queryKey: ['wizard', step, criteria],
    queryFn: () => api<WizardOptionsResponse>(withQuery(`/api/wizard/${step}`, criteriaParams(criteria))),
    staleTime: 60_000,
    gcTime: KEEP_QUESTIONS,
  });

export function useWizardOptions(step: WizardStep, criteria: Criteria) {
  return useQuery(wizardQuery(step, criteria));
}

/** With `like` (a movie id), picks resemble that movie instead of matching the answers. */
export const recommendationsQuery = (criteria: Criteria, like?: string | null) =>
  queryOptions({
    queryKey: ['recommendations', criteria, like ?? null],
    queryFn: () =>
      api<RecommendationsResponse>(withQuery('/api/recommendations', { ...criteriaParams(criteria), like })),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export function useRecommendations(criteria: Criteria, like?: string | null) {
  return useQuery(recommendationsQuery(criteria, like));
}

/** Movies to start "Something like…" from: recently watched, or titles matching `q`. */
export const likeSeedsQuery = (q: string) =>
  queryOptions({
    queryKey: ['like', q],
    queryFn: () => api<LikeSeed[]>(withQuery('/api/like', { q })),
    staleTime: 60_000,
    // The genre question waits for these (for the "Something like…" card's posters).
    gcTime: KEEP_QUESTIONS,
  });

export function useLikeSeeds(q: string, enabled = true) {
  return useQuery({
    ...likeSeedsQuery(q),
    // Keep the last results on screen while the next search loads.
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * What happened on the media server for "Seen it" / "Watchlist": changed it, it already matched,
 * nothing to do (no media server, sync off), or the server couldn't be reached.
 */
export type ServerSyncResult = 'synced' | 'already' | 'skipped' | 'failed';

/**
 * `keepalive` lets the request finish while the page is being left (e.g. opening the media server).
 * Watching together, `profileIds` says who Seen it, Never or Watchlist is for; other marks are for everyone.
 * `ids` are the rows saved, one per person.
 */
export function sendFeedback(movieId: number, kind: FeedbackKind, opts: { keepalive?: boolean; profileIds?: number[] } = {}) {
  return api<{ id: number; ids: number[]; server?: ServerSyncResult }>('/api/feedback', {
    json: opts.profileIds ? { movieId, kind, profileIds: opts.profileIds } : { movieId, kind },
    keepalive: opts.keepalive,
  });
}

export function undoFeedback(id: number) {
  return api<{ ok: true; server?: ServerSyncResult }>('/api/feedback/' + id, { method: 'DELETE' });
}

/** Undoes a mark saved for several people: whether the media server failed for any of them. */
export async function undoAll(ids: number[]): Promise<{ server?: ServerSyncResult }> {
  const results = await Promise.all(ids.map(undoFeedback));
  return { server: results.some((r) => r.server === 'failed') ? 'failed' : results[0]?.server };
}

/**
 * Takes a movie off the watchlist, and the media server's; watching together, off the watchlists of whoever
 * `profileIds` names. `onWatchlistOf` says who among those watching still has it there.
 */
export function removeFromWatchlist(movieId: number, profileIds?: number[]) {
  return api<{ server: ServerSyncResult; onWatchlistOf: number[] }>(`/api/watchlist/${movieId}`, {
    method: 'DELETE',
    json: profileIds ? { profileIds } : undefined,
  });
}

/**
 * A movie on one of the profile's lists. `id` is its mark's, for Restore. A movie that's only on the media server's
 * watchlist has no mark, so no `id`; its `createdAt` is when Curatorr first saw it there, if it knows.
 */
export type HiddenMovie =
  | { id: number; kind: 'seen' | 'never' | 'later'; createdAt: number; movie: MovieDTO }
  | { id: null; kind: 'later'; createdAt: number | null; movie: MovieDTO };

export function useHidden() {
  return useQuery({ queryKey: ['hidden'], queryFn: () => api<HiddenMovie[]>('/api/hidden') });
}

/** Everything below depends on who is watching. */
function newViewers(qc: ReturnType<typeof useQueryClient>) {
  qc.removeQueries({ queryKey: ['wizard'] });
  qc.removeQueries({ queryKey: ['recommendations'] });
  qc.removeQueries({ queryKey: ['like'] });
  qc.removeQueries({ queryKey: ['hidden'] });
  // The first question, and the "Something like…" posters it waits for, load before the screen changes. The new
  // status comes after them, since on "Who's watching?" at / it's what changes the screen.
  return Promise.all([qc.prefetchQuery(wizardQuery('genre', {})), qc.prefetchQuery(likeSeedsQuery(''))]).then(() =>
    qc.invalidateQueries({ queryKey: ['status'] }),
  );
}

export function useSelectProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pin }: { id: number; pin?: string }) =>
      api<Profile>(`/api/profiles/${id}/select`, { json: pin ? { pin } : {} }),
    onSuccess: () => newViewers(qc),
  });
}

/** Watching together tonight. A protected profile answers 403 `needPin` with its `profileId`; retry with its PIN. */
export function useSelectTogether() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, pin }: { ids: number[]; pin?: { id: number; pin: string } }) =>
      api<Profile[]>('/api/profiles/together', { json: pin ? { ids, pin } : { ids } }),
    onSuccess: () => newViewers(qc),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsResponse {
  /** The media server Curatorr uses, or is being set up with. */
  server: MediaServer | null;
  radarr: { url: string; hasApiKey: boolean } | null;
  /** The last read of Seerr: requested movies in the library, for how many profiles. */
  seerr: {
    url: string;
    hasApiKey: boolean;
    at: number | null;
    requests: number;
    profiles: number;
    error: string | null;
  } | null;
  plex: {
    signedIn: boolean;
    ownerName: string | null;
    serverName: string | null;
    serverUrl: string | null;
    machineId: string | null;
    sectionIds: string[];
  };
  jellyfin: {
    url: string;
    /** Where Watch on Jellyfin goes, when that's another address. */
    publicUrl: string | null;
    serverName: string;
    ownerName: string;
    libraryIds: string[];
  } | null;
  app: { includeWatched: boolean; syncIntervalHours: number; syncToServer: boolean; boostRequests: boolean };
  sync: { at: number | null; movies: number; matched: number; error: string | null; syncing: boolean };
  /** Radarr's webhook: the secret in its address, and when Radarr last called, with what. */
  webhook: { token: string; at: number | null; event: string | null; title: string | null };
  /** `serverUser`: the profile stands for a user on the media server. */
  profiles: (Profile & { hidden: boolean; serverUser: boolean })[];
}

export function useSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsResponse>('/api/settings'),
    enabled,
    refetchInterval: (q) => (q.state.data?.sync.syncing ? 2_000 : false),
    // Back from Radarr after pressing Test, its call shows without a reload.
    refetchOnWindowFocus: true,
  });
}

export interface PlexServerOption {
  name: string;
  machineId: string;
  connections: { url: string; local: boolean; relay: boolean; ok: boolean; ms: number | null }[];
}

/** A Plex or Jellyfin library that can hold movies. */
export interface ServerLibrary {
  key: string;
  title: string;
}
