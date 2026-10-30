import type { ServerSyncResult } from '@curatorr/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import { applyToJellyfin, importJellyfinUsers, jellyfinStateReader, revertInJellyfin } from './jellyfin.js';
import { applyToPlex, revertInPlex } from './plexSync.js';
import { importHomeUsers, plexStateReader } from './profiles.js';

/** A profile's watch history and watchlist read from the media server this recently are fresh enough. */
const SERVER_STATE_TTL_MS = 10 * 60 * 1000;
/** Reads under way, per store and profile, so status refetches and a profile pick share one. */
const reading = new WeakMap<Store, Map<number, Promise<void>>>();

/**
 * What happened on the media server after a mark:
 * - `synced`: Curatorr changed it (Undo will change it back)
 * - `already`: it already had it (watched / on the watchlist), nothing to undo
 * - `skipped`: nothing to do (sync off, no media server, profile not linked, movie not there)
 * - `failed`: the server couldn't be reached; the mark is still saved in Curatorr
 */
export type { ServerSyncResult };

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

/**
 * Refreshes a profile's watch history and watchlist from the media server, if they are stale (or `force`). Plex and
 * Jellyfin each read and store their own; what's common happens here: freshness, one read at a time per profile, and
 * following movies taken off the server's watchlist while marks update it (`syncToServer`).
 */
export async function syncServerState(store: Store, row: ProfileRow, log: FastifyBaseLogger, force = false) {
  // Before the first library sync there's nothing to match them with, and an empty read would pass for fresh for
  // ten minutes. The status calls made while that sync runs read them once the library is in.
  if (!store.movies().length) return;
  const server = store.mediaServer();
  const read =
    server === 'plex' ? plexStateReader(store, row, log) : server === 'jellyfin' ? jellyfinStateReader(store, row, log) : null;
  if (!read) return;
  if (!force && row.watched_synced_at && Date.now() - row.watched_synced_at < SERVER_STATE_TTL_MS) return;

  let pending = reading.get(store);
  if (!pending) reading.set(store, (pending = new Map()));
  let sync = pending.get(row.id);
  if (!sync) {
    sync = readAndFollow(store, row, log, read).finally(() => pending.delete(row.id));
    pending.set(row.id, sync);
  }
  await sync;
}

async function readAndFollow(
  store: Store,
  row: ProfileRow,
  log: FastifyBaseLogger,
  read: () => Promise<number[] | null>,
) {
  // Before the server is asked: a movie Curatorr adds while the answer is on its way wasn't taken off there.
  const before = store.watchlistIds(row.id);
  const watchlist = await read();
  // While marks update the server, its watchlist and Curatorr's are one, so what was taken off there goes here too.
  if (!watchlist || !store.get('app').syncToServer) return;
  const removed = store.followWatchlistRemovals(row.id, before, watchlist);
  if (removed.length) log.info({ profile: row.name, removed: removed.length }, 'taken off the media server watchlist');
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
