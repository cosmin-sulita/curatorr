import type { FastifyBaseLogger } from 'fastify';
import { addToWatchlist, PlexServerClient, removeFromWatchlist } from '../integrations/plex.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import type { ServerMark, ServerSyncResult } from './mediaServer.js';
import { ensurePlexIds } from './plexLibrary.js';

/** "Seen it" marks the movie watched in Plex, "Watchlist" adds it to the Plex Watchlist (legacy agents have none). */
export async function applyToPlex(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  if (!store.plexConfigured() || !movie.plexRatingKey) return 'skipped';
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
    const guid = (await ensurePlexIds(store, [movie])).get(movie.id)?.plexGuid;
    if (!guid) return 'skipped'; // legacy agent: not on Plex Discover, so no Watchlist
    await addToWatchlist(plex.clientId, profile.user_token, guid);
    store.addToWatchlist(profile.id, movie.id);
    return 'synced';
  } catch (err) {
    log.warn({ err, movie: movie.title, profile: profile.name, kind }, 'could not update Plex');
    return 'failed';
  }
}

/** Undoes what `applyToPlex` did, or takes a movie off the Plex Watchlist (see `revertMark`). */
export async function revertInPlex(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
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
