import type { FastifyBaseLogger } from 'fastify';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import { applyToPlex, revertInPlex } from './plexSync.js';
import { syncPlexState } from './profiles.js';

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

/** Refreshes a profile's watch history and watchlist from the media server, if they are stale. */
export async function syncServerState(store: Store, row: ProfileRow, log: FastifyBaseLogger, force = false) {
  if (store.mediaServer() === 'plex') await syncPlexState(store, row, log, force);
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
  if (store.mediaServer() === 'plex') return applyToPlex(store, profile, movie, kind, log);
  return 'skipped';
}

/** Undoes what `applyMark` did. Only call it for marks that came back `synced`. */
export async function revertMark(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  if (store.mediaServer() === 'plex') return revertInPlex(store, profile, movie, kind, log);
  return 'skipped';
}
