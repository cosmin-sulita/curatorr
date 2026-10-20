import type { FastifyBaseLogger } from 'fastify';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import { applyToJellyfin, importJellyfinUsers, revertInJellyfin, syncJellyfinState } from './jellyfin.js';
import { applyToPlex, revertInPlex } from './plexSync.js';
import { importHomeUsers, syncPlexState } from './profiles.js';

/**
 * What happened on the media server after a mark:
 * - `synced`: Curatorr changed it (Undo will change it back)
 * - `already`: it already had it (watched / on the watchlist), nothing to undo
 * - `skipped`: nothing to do (sync off, no media server, profile not linked, movie not there)
 * - `failed`: the server couldn't be reached; the mark is still saved in Curatorr
 */
export type ServerSyncResult = 'synced' | 'already' | 'skipped' | 'failed';

/** Marks that are mirrored to the media server: "Seen it" → watched, "Watchlist" → its watchlist. */
export type ServerMark = 'seen' | 'later';

export const isServerMark = (kind: string): kind is ServerMark => kind === 'seen' || kind === 'later';

/**
 * Reads the media server's users again: who has a PIN, their parental limits, who is an administrator.
 * A read that fails changes nobody's profile.
 */
export async function refreshProfiles(store: Store, log: FastifyBaseLogger) {
  const server = store.mediaServer();
  if (server === 'plex' && store.plexConfigured()) await importHomeUsers(store, log);
  if (server === 'jellyfin') await importJellyfinUsers(store);
}

/** Refreshes a profile's watch history and watchlist from the media server, if they are stale. */
export async function syncServerState(store: Store, row: ProfileRow, log: FastifyBaseLogger, force = false) {
  // Before the first library sync there's nothing to match them with, and an empty read would pass for fresh for
  // ten minutes. The status calls made while that sync runs read them once the library is in.
  if (!store.movies().length) return;
  const server = store.mediaServer();
  if (server === 'plex') await syncPlexState(store, row, log, force);
  if (server === 'jellyfin') await syncJellyfinState(store, row, log, force);
}

/** Mirrors a mark to the media server, unless the owner turned that off. */
export async function applyMark(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  if (!store.get('app').syncToServer) return 'skipped';
  const server = store.mediaServer();
  if (server === 'plex') return applyToPlex(store, profile, movie, kind, log);
  if (server === 'jellyfin') return applyToJellyfin(store, profile, movie, kind, log);
  return 'skipped';
}

/**
 * Undoes what `applyMark` did: only call it for marks that came back `synced`. The watchlist is the exception,
 * since someone can take a movie off it in Curatorr, whoever put it there.
 */
export async function revertMark(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  const server = store.mediaServer();
  if (server === 'plex') return revertInPlex(store, profile, movie, kind, log);
  if (server === 'jellyfin') return revertInJellyfin(store, profile, movie, kind, log);
  return 'skipped';
}
