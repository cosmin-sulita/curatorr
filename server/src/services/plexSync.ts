import type { FastifyBaseLogger } from 'fastify';
import { addToWatchlist, PlexServerClient, removeFromWatchlist } from '../integrations/plex.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import { ensurePlexIds } from './recommend.js';

/**
 * What happened in Plex:
 * - `synced`: Curatorr changed Plex (Undo will change it back)
 * - `already`: Plex already had it (watched / on the Watchlist), nothing to undo
 * - `skipped`: nothing to do (sync off, no Plex, profile not linked, legacy agent)
 * - `failed`: Plex couldn't be reached; the mark is still saved in Curatorr
 */
export type PlexSyncResult = 'synced' | 'already' | 'skipped' | 'failed';

/** Marks that are mirrored to Plex: "Seen it" → watched, "Later" → Watchlist. */
export type PlexMark = 'seen' | 'later';

export const isPlexMark = (kind: string): kind is PlexMark => kind === 'seen' || kind === 'later';

const canSync = (store: Store) => store.plexConfigured() && store.get('app').syncToPlex;

export async function applyToPlex(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: PlexMark,
  log: FastifyBaseLogger,
): Promise<PlexSyncResult> {
  if (!canSync(store) || !movie.plexRatingKey) return 'skipped';
  const plex = store.get('plex');
  try {
    if (kind === 'seen') {
      if (!profile.server_token) return 'skipped';
      if (store.watchedIds(profile.id).has(movie.id)) return 'already';
      await new PlexServerClient(plex.serverUrl!, plex.clientId, profile.server_token).scrobble(movie.plexRatingKey);
      store.addWatched(profile.id, movie.id);
      return 'synced';
    }

    if (!profile.user_token) return 'skipped';
    if (store.watchlistIds(profile.id).has(movie.id)) return 'already';
    await ensurePlexIds(store, [movie]);
    if (!movie.plexGuid) return 'skipped'; // legacy agent: not on Plex Discover, so no Watchlist
    await addToWatchlist(plex.clientId, profile.user_token, movie.plexGuid);
    store.addToWatchlist(profile.id, movie.id);
    return 'synced';
  } catch (err) {
    log.warn({ err, movie: movie.title, profile: profile.name, kind }, 'could not update Plex');
    return 'failed';
  }
}

/** Undoes what `applyToPlex` did. Only call it for marks that came back `synced`. */
export async function revertInPlex(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: PlexMark,
  log: FastifyBaseLogger,
): Promise<PlexSyncResult> {
  if (!store.plexConfigured() || !movie.plexRatingKey) return 'skipped';
  const plex = store.get('plex');
  try {
    if (kind === 'seen') {
      if (!profile.server_token) return 'skipped';
      await new PlexServerClient(plex.serverUrl!, plex.clientId, profile.server_token).unscrobble(movie.plexRatingKey);
      store.removeWatched(profile.id, movie.id);
      return 'synced';
    }
    if (!profile.user_token || !movie.plexGuid) return 'skipped';
    await removeFromWatchlist(plex.clientId, profile.user_token, movie.plexGuid);
    store.removeFromWatchlist(profile.id, movie.id);
    return 'synced';
  } catch (err) {
    log.warn({ err, movie: movie.title, profile: profile.name, kind }, 'could not undo the change in Plex');
    return 'failed';
  }
}
