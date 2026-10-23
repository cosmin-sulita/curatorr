import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AppStatus,
  Criteria,
  FeedbackKind,
  LikeSeed,
  ListedMovie,
  MediaServer,
  Profile,
  RecommendationsResponse,
  WizardOptionsResponse,
  WizardStep,
} from '@curatorr/shared';
import { PICTURE, sized, warmImages } from '../components/ui';
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

/** Curatorr didn't answer in time, like an address that leads nowhere from the network the phone is on. */
export const isTimeout = (err: unknown) => err instanceof DOMException && err.name === 'TimeoutError';

/** True when the server could not be reached at all (offline, container down), or didn't answer in time. */
export const isNetworkError = (err: unknown) => err instanceof TypeError || isTimeout(err);

/**
 * How long a read waits for an answer. Away from home, Curatorr's address can lead nowhere, and a request would wait
 * for minutes. Changes wait as long as they take, since they may already have been made.
 */
const READ_TIMEOUT_MS = 15_000;

/** `timeout`: how long to wait for an answer, in ms; null waits as long as it takes. Reads default to READ_TIMEOUT_MS. */
export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; keepalive?: boolean; timeout?: number | null } = {},
): Promise<T> {
  const method = init.method ?? (init.json !== undefined ? 'POST' : 'GET');
  const timeout = init.timeout === undefined ? (method === 'GET' ? READ_TIMEOUT_MS : null) : init.timeout;
  const signal = timeout ? AbortSignal.timeout(timeout) : undefined;
  // Some browsers report the timeout as a plain abort: say what happened the same way everywhere.
  const timedOut = () => new DOMException("Curatorr didn't answer in time", 'TimeoutError');
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      keepalive: init.keepalive,
      signal,
    });
  } catch (err) {
    throw signal?.aborted ? timedOut() : err;
  }
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // An answer cut off by the timeout isn't an empty one.
    if (signal?.aborted) throw timedOut();
    data = {};
  }
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? res.statusText), data);
  return data as T;
}

export const errorMessage = (err: unknown) =>
  isNetworkError(err) ? "Can't reach Curatorr. Check your connection." : err instanceof Error ? err.message : String(err);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The launch screen waits this long for the status before saying Curatorr can't be reached. It's quick to answer at
 * home, so a longer wait means the phone is somewhere the address doesn't lead.
 */
const STATUS_TIMEOUT_MS = 6_000;

/** Whether this device had a profile when the app last asked: what the next launch loads first (loadFirstScreen). */
const HAD_PROFILE = 'curatorr:hadProfile';

function rememberProfile(status: AppStatus) {
  try {
    localStorage.setItem(HAD_PROFILE, status.profile ? '1' : '0');
  } catch {
    // Storage blocked: the next launch loads its first screen after the status, as it would anyway.
  }
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const status = await api<AppStatus>('/api/status', { timeout: STATUS_TIMEOUT_MS });
      rememberProfile(status);
      return status;
    },
    refetchInterval: (q) => (q.state.data?.library.syncing ? 2_000 : false),
    refetchOnWindowFocus: true,
    // Many components read the status; refetching on each mount would also bounce the
    // "can't reach Curatorr" screen back to the splash in a loop while offline.
    refetchOnMount: false,
    retryOnMount: false,
  });
}

/** `locked`: the profile's Plex PIN hasn't been entered on this device yet. */
export const profilesQuery = queryOptions({
  queryKey: ['profiles'],
  queryFn: () => api<(Profile & { locked: boolean })[]>('/api/profiles'),
});

export function useProfiles() {
  return useQuery(profilesQuery);
}

const criteriaParams = (c: Criteria) => ({ genre: c.genre, theme: c.theme, mood: c.mood, time: c.time, shelf: c.shelf });

// Each query's options live in one place, so loading a screen ahead of time uses the very key the screen reads.

/** The questions are kept a while after leaving them, so coming back from a pick shows them at once. */
const KEEP_QUESTIONS = 30 * 60_000;
/**
 * Long enough that a question loaded ahead still counts when it's tapped after a while: only marks (which refresh the
 * questions) and library syncs change the answers.
 */
const FRESH_QUESTIONS = 5 * 60_000;
/** About a screenful of a question's pictures: what starts loading as it opens. */
const FIRST_PICTURES = 18;

export const wizardQuery = (step: WizardStep, criteria: Criteria) =>
  queryOptions({
    queryKey: ['wizard', step, criteria],
    queryFn: () => api<WizardOptionsResponse>(withQuery(`/api/wizard/${step}`, criteriaParams(criteria))),
    staleTime: FRESH_QUESTIONS,
    gcTime: KEEP_QUESTIONS,
  });

/**
 * The size a question shows its answers' pictures at: the first question's tiles, the themes' poster fans (PosterFan
 * sizes every fan to PICTURE.fan), the mood cards as stored. The screens and what loads them ahead both go through
 * here, so what's loaded ahead is what shows.
 */
export const questionPicture = <T extends string | undefined>(step: WizardStep, url: T): T =>
  step === 'genre' ? sized(url, PICTURE.tile) : step === 'theme' ? sized(url, PICTURE.fan) : url;

/** The pictures a question shows first: the first question's shortcuts, then the answers'. */
export const firstPictures = (d: WizardOptionsResponse) =>
  [...(d.shelves ?? []), ...d.options]
    .flatMap((o) => o.images)
    .slice(0, FIRST_PICTURES)
    .map((url) => questionPicture(d.step, url));

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
  | { id: number; kind: 'seen' | 'never' | 'later'; createdAt: number; movie: ListedMovie }
  | { id: null; kind: 'later'; createdAt: number | null; movie: ListedMovie };

export function useHidden() {
  return useQuery({ queryKey: ['hidden'], queryFn: () => api<HiddenMovie[]>('/api/hidden') });
}

/** Everything below depends on who is watching. */
function newViewers(qc: QueryClient) {
  qc.removeQueries({ queryKey: ['wizard'] });
  qc.removeQueries({ queryKey: ['recommendations'] });
  qc.removeQueries({ queryKey: ['like'] });
  qc.removeQueries({ queryKey: ['hidden'] });
  // The first question loads before the screen changes. The new status comes after it, since on "Who's watching?"
  // at / it's what changes the screen.
  return loadFirstQuestion(qc).then(() => qc.invalidateQueries({ queryKey: ['status'] }));
}

/**
 * The first question, and the "Something like…" posters it waits for, with their pictures starting as soon as they're
 * known. A failure is left for the screen to show.
 */
function loadFirstQuestion(qc: QueryClient) {
  const question = qc.fetchQuery(wizardQuery('genre', {})).then((d) => warmImages(firstPictures(d), 'high'));
  const seeds = qc.fetchQuery(likeSeedsQuery('')).then((s) => {
    const posters = s.flatMap((m) => (m.posterUrl ? [sized(m.posterUrl, PICTURE.fan)] : [])).slice(0, 3);
    warmImages(posters, 'high');
  });
  return Promise.all([question, seeds].map((p) => p.catch(() => {})));
}

/**
 * At launch, the first screen loads alongside the status instead of after it: the first question when this device had
 * a profile last time, "Who's watching?" otherwise. A guess that's wrong (the profile is gone) only costs a request.
 */
export function loadFirstScreen(qc: QueryClient) {
  let had: string | null = null;
  try {
    had = localStorage.getItem(HAD_PROFILE);
  } catch {
    // Storage blocked: the first screen loads after the status.
  }
  if (had === '1') void loadFirstQuestion(qc);
  else if (had === '0') void qc.prefetchQuery(profilesQuery);
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
