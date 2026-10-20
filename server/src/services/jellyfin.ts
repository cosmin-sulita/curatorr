import type { FastifyBaseLogger } from 'fastify';
import { HttpError } from '../http.js';
import { JellyfinClient, jellyfinRestriction, type JellyfinUser } from '../integrations/jellyfin.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import { findByIds, indexByIds } from './library.js';
import type { ServerMark, ServerSyncResult } from './mediaServer.js';

/** As with Plex, a watch history younger than this is fresh enough. */
const WATCHED_TTL_MS = 10 * 60 * 1000;

/** Saves a Jellyfin user's profile. Their picture comes through Curatorr: phones may not reach Jellyfin. */
export function saveJellyfinProfile(store: Store, user: JellyfinUser): number {
  return store.upsertJellyfinProfile({
    jellyfinUserId: user.id,
    name: user.name,
    avatarUrl: user.imageTag ? `/api/avatar/${user.id}?tag=${encodeURIComponent(user.imageTag)}` : null,
    isAdmin: user.admin,
    restrictionProfile: jellyfinRestriction(user.maxParentalRating, user.admin),
  });
}

/** Creates or updates a profile for each Jellyfin user who can sign in, and drops every other profile. */
export async function importJellyfinUsers(store: Store) {
  const jellyfin = store.get('jellyfin');
  if (!jellyfin) throw new HttpError(400, 'Connect Jellyfin first');
  // A read that fails throws here, before any profile changes.
  const users = (await JellyfinClient.connected(jellyfin).users()).filter((u) => !u.disabled);
  for (const user of users) saveJellyfinProfile(store, user);
  store.keepOnlyJellyfinProfiles(users.map((u) => u.id));
  return store.profileRows(true);
}

/** Syncs under way per profile, so status refetches and a profile pick share one read. */
const syncing = new Map<number, Promise<void>>();

/** Refreshes what a Jellyfin profile watched, its favourites and the movies it can open, if they are stale. */
export async function syncJellyfinState(store: Store, row: ProfileRow, log: FastifyBaseLogger, force = false) {
  if (!store.get('jellyfin') || row.jellyfin_user_id == null) return;
  if (!force && row.watched_synced_at && Date.now() - row.watched_synced_at < WATCHED_TTL_MS) return;
  let sync = syncing.get(row.id);
  if (!sync) {
    sync = readState(store, row, log).finally(() => syncing.delete(row.id));
    syncing.set(row.id, sync);
  }
  await sync;
}

async function readState(store: Store, row: ProfileRow, log: FastifyBaseLogger) {
  // Before Jellyfin is asked: a movie Curatorr adds while the answer is on its way wasn't taken off in Jellyfin.
  const before = store.watchlistIds(row.id);
  try {
    // One read: every movie the person can open, with their marks.
    const items = await JellyfinClient.connected(store.get('jellyfin')!).movies({ userId: row.jellyfin_user_id! });
    const index = indexByIds(items);
    const watched: { movieId: number; viewedAt: number | null }[] = [];
    const watchlist: number[] = [];
    for (const movie of store.movies()) {
      const item = findByIds(index, movie);
      if (item?.played) watched.push({ movieId: movie.id, viewedAt: item.lastPlayedAt });
      if (item?.favorite) watchlist.push(movie.id);
    }
    store.replaceJellyfinState(row.id, { watched, watchlist, available: items }, Date.now());
    const removed = store.followWatchlistRemovals(row.id, before, watchlist);
    log.info(
      {
        profile: row.name,
        watched: watched.length,
        watchlist: watchlist.length,
        movies: items.length,
        removed: removed.length,
      },
      'Jellyfin state synced',
    );
  } catch (err) {
    log.warn({ err, profile: row.name }, 'Jellyfin state sync failed');
  }
}

/** "Seen it" marks the movie played in Jellyfin, "Watchlist" makes it a favourite, for the profile's user. */
export async function applyToJellyfin(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  const jellyfin = store.get('jellyfin');
  const userId = profile.jellyfin_user_id;
  if (!jellyfin || userId == null || !movie.jellyfinId) return 'skipped';
  try {
    if (kind === 'seen') {
      if (store.watchedIds(profile.id).has(movie.id)) return 'already';
      await JellyfinClient.connected(jellyfin).setPlayed(userId, movie.jellyfinId, true);
      store.addWatched(profile.id, movie.id);
      return 'synced';
    }
    if (store.watchlistIds(profile.id).has(movie.id)) return 'already';
    await JellyfinClient.connected(jellyfin).setFavorite(userId, movie.jellyfinId, true);
    store.addToWatchlist(profile.id, movie.id);
    return 'synced';
  } catch (err) {
    log.warn({ err, movie: movie.title, profile: profile.name, kind }, 'could not update Jellyfin');
    return 'failed';
  }
}

/** Undoes what `applyToJellyfin` did, or takes a movie out of the favourites (see `revertMark`). */
export async function revertInJellyfin(
  store: Store,
  profile: ProfileRow,
  movie: StoredMovie,
  kind: ServerMark,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  const jellyfin = store.get('jellyfin');
  const userId = profile.jellyfin_user_id;
  if (!jellyfin || userId == null || !movie.jellyfinId) return 'skipped';
  try {
    if (kind === 'seen') {
      await JellyfinClient.connected(jellyfin).setPlayed(userId, movie.jellyfinId, false);
      store.removeWatched(profile.id, movie.id);
    } else {
      await JellyfinClient.connected(jellyfin).setFavorite(userId, movie.jellyfinId, false);
      store.removeFromWatchlist(profile.id, movie.id);
    }
    return 'synced';
  } catch (err) {
    log.warn({ err, movie: movie.title, profile: profile.name, kind }, 'could not undo the change in Jellyfin');
    return 'failed';
  }
}
