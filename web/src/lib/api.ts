import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppStatus,
  Criteria,
  FeedbackKind,
  LikeSeed,
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

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: () => api<Profile[]>('/api/profiles') });
}

const criteriaParams = (c: Criteria) => ({ genre: c.genre, theme: c.theme, mood: c.mood, time: c.time });

export function useWizardOptions(step: WizardStep, criteria: Criteria) {
  return useQuery({
    queryKey: ['wizard', step, criteria],
    queryFn: () => api<WizardOptionsResponse>(withQuery(`/api/wizard/${step}`, criteriaParams(criteria))),
    staleTime: 60_000,
  });
}

/** With `like` (a movie id), picks resemble that movie instead of matching the answers. */
export function useRecommendations(criteria: Criteria, like?: string | null) {
  return useQuery({
    queryKey: ['recommendations', criteria, like ?? null],
    queryFn: () =>
      api<RecommendationsResponse>(withQuery('/api/recommendations', { ...criteriaParams(criteria), like })),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Movies to start "Something like…" from: recently watched, or titles matching `q`. */
export function useLikeSeeds(q: string) {
  return useQuery({
    queryKey: ['like', q],
    queryFn: () => api<LikeSeed[]>(withQuery('/api/like', { q })),
    staleTime: 60_000,
    // Keep the last results on screen while the next search loads.
    placeholderData: keepPreviousData,
  });
}

/**
 * What happened in Plex for "Seen it" / "Watchlist": changed it, it already matched,
 * nothing to do (no Plex, sync off), or Plex couldn't be reached.
 */
export type PlexSyncResult = 'synced' | 'already' | 'skipped' | 'failed';

/** `keepalive` lets the request finish while the page is being left (e.g. opening Plex). */
export function sendFeedback(movieId: number, kind: FeedbackKind, opts: { keepalive?: boolean } = {}) {
  return api<{ id: number; plex?: PlexSyncResult }>('/api/feedback', {
    json: { movieId, kind },
    keepalive: opts.keepalive,
  });
}

export function undoFeedback(id: number) {
  return api<{ ok: true; plex?: PlexSyncResult }>('/api/feedback/' + id, { method: 'DELETE' });
}

export interface HiddenMovie {
  id: number;
  kind: 'seen' | 'never' | 'later';
  createdAt: number;
  movie: MovieDTO;
}

export function useHidden() {
  return useQuery({ queryKey: ['hidden'], queryFn: () => api<HiddenMovie[]>('/api/hidden') });
}

export function useSelectProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pin }: { id: number; pin?: string }) =>
      api<Profile>(`/api/profiles/${id}/select`, { json: pin ? { pin } : {} }),
    onSuccess: () => {
      // Everything below depends on who is watching.
      qc.removeQueries({ queryKey: ['wizard'] });
      qc.removeQueries({ queryKey: ['recommendations'] });
      qc.removeQueries({ queryKey: ['like'] });
      qc.removeQueries({ queryKey: ['hidden'] });
      return qc.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsResponse {
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
  app: { includeWatched: boolean; syncIntervalHours: number; syncToPlex: boolean; boostRequests: boolean };
  sync: { at: number | null; movies: number; matchedInPlex: number; error: string | null; syncing: boolean };
  profiles: (Profile & { hidden: boolean; plexUser: boolean })[];
}

export function useSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsResponse>('/api/settings'),
    enabled,
    refetchInterval: (q) => (q.state.data?.sync.syncing ? 2_000 : false),
  });
}

export interface PlexServerOption {
  name: string;
  machineId: string;
  connections: { url: string; local: boolean; relay: boolean; ok: boolean; ms: number | null }[];
}

export interface PlexLibrary {
  key: string;
  title: string;
}
