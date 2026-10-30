import type { FastifyBaseLogger } from 'fastify';
import { HttpError, UpstreamError } from '../http.js';
import {
  getHomeUsers,
  getWatchlist,
  ownAvatar,
  serverTokenFor,
  switchHomeUser,
  type PlexHomeUser,
} from '../integrations/plex.js';
import type { ProfileRow, Store } from '../store.js';
import { findByIds, indexByIds } from './matching.js';
import { fetchPlexItems } from './plexLibrary.js';

/** Creates/updates one profile per Plex Home user and links the ones that need no PIN. */
export async function importHomeUsers(store: Store, log: FastifyBaseLogger) {
  const plex = store.get('plex');
  if (!plex.adminToken) throw new HttpError(400, 'Sign in with Plex first');

  let users: PlexHomeUser[];
  try {
    users = await getHomeUsers(plex.clientId, plex.adminToken);
  } catch (err) {
    // A refresh that can't read Plex Home must not change anyone's profile, let alone delete it.
    if (store.profileRows({ includeHidden: true }).some((p) => p.plex_user_id != null)) throw err;
    log.warn({ err }, 'could not list Plex Home users; falling back to the owner only');
    users = [];
  }

  // Accounts without Plex Home only have the owner.
  if (!users.some((u) => u.admin) && plex.ownerId) {
    users.unshift({
      id: plex.ownerId,
      title: plex.ownerName ?? 'Owner',
      thumb: null,
      admin: true,
      guest: false,
      protected: false,
      restrictionProfile: null,
    });
  }

  // Plex gives everyone a thumb; people without a photo get null so the UI draws their blobatar.
  const real = await Promise.all(
    users.filter((u) => !u.guest).map(async (u) => ({ ...u, thumb: await ownAvatar(u.thumb) })),
  );
  store.removeLocalProfiles();
  for (const u of real) {
    const id = store.upsertPlexProfile({
      plexUserId: u.id,
      name: u.title,
      avatarUrl: u.thumb,
      isAdmin: u.admin,
      restrictionProfile: u.admin ? null : u.restrictionProfile,
      pinProtected: u.protected,
    });
    const row = store.profileRow(id)!;
    if (row.server_token) continue;
    if (u.admin) {
      await linkProfile(store, row).catch((err) => log.warn({ err, user: u.title }, 'could not link owner'));
    } else if (!u.protected) {
      await linkProfile(store, row).catch((err) => log.warn({ err, user: u.title }, 'could not link profile'));
    }
  }
  store.removeProfilesNotIn(real.map((u) => u.id));
  return store.profileRows({ includeHidden: true });
}

/** Switches to the profile's Plex Home user; plex.tv checks the PIN of a protected one. */
async function switchToUser(store: Store, row: ProfileRow, pin?: string) {
  const { clientId, adminToken } = store.get('plex');
  if (!adminToken || row.plex_user_id == null) throw new HttpError(400, 'Profile is not linked to Plex');
  try {
    return await switchHomeUser(clientId, adminToken, row.plex_user_id, pin);
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
      throw new HttpError(403, pin ? 'Wrong PIN, try again' : 'PIN required', { needPin: true, profileId: row.id });
    }
    throw err;
  }
}

/** Checks a protected profile's PIN with plex.tv, the way Plex does when switching to that user. */
export async function verifyPin(store: Store, row: ProfileRow, pin?: string) {
  if (!pin) throw new HttpError(403, 'PIN required', { needPin: true, profileId: row.id });
  await switchToUser(store, row, pin);
}

/** Obtains the Plex tokens a profile needs to read its own watch history. */
export async function linkProfile(store: Store, row: ProfileRow, pin?: string) {
  const plex = store.get('plex');
  if (!plex.adminToken || !plex.machineId) throw new HttpError(400, 'Plex is not configured');

  let userToken: string;
  if (row.is_admin) {
    userToken = plex.adminToken;
  } else {
    if (row.plex_user_id == null) throw new HttpError(400, 'Profile is not linked to Plex');
    userToken = await switchToUser(store, row, pin);
  }

  const serverToken = (await serverTokenFor(plex.clientId, userToken, plex.machineId)) ?? (row.is_admin ? userToken : null);
  if (!serverToken) throw new HttpError(403, `${row.name} has no access to ${plex.serverName ?? 'the Plex server'}`);
  store.setProfileTokens(row.id, userToken, serverToken);
  return store.profileRow(row.id)!;
}

/**
 * Reads a profile's Plex watch history and Watchlist, each on its own: managed users may have no Watchlist, which
 * mustn't stop their history. Answers the Watchlist read, or null without one. Null when the profile has no Plex
 * sign-in (see syncServerState).
 */
export function plexStateReader(store: Store, row: ProfileRow, log: FastifyBaseLogger) {
  if (!store.plexConfigured() || !row.server_token) return null;
  return async () => {
    const [, watchlist] = await Promise.all([syncWatched(store, row, log), syncWatchlist(store, row, log)]);
    return watchlist;
  };
}

async function syncWatchlist(store: Store, row: ProfileRow, log: FastifyBaseLogger): Promise<number[] | null> {
  if (!row.user_token) return null;
  try {
    const guids = await getWatchlist(store.get('plex').clientId, row.user_token);
    const byGuid = new Map(store.movies().flatMap((m) => (m.plexGuid ? [[m.plexGuid, m.id] as const] : [])));
    const movieIds = guids.flatMap((g) => byGuid.get(g) ?? []);
    store.replaceWatchlist(row.id, movieIds);
    log.info({ profile: row.name, watchlist: guids.length, inLibrary: movieIds.length }, 'watchlist synced');
    return movieIds;
  } catch (err) {
    log.warn({ err, profile: row.name }, 'watchlist sync failed');
    return null;
  }
}

async function syncWatched(store: Store, row: ProfileRow, log: FastifyBaseLogger) {
  try {
    const items = await fetchPlexItems(store, row.server_token!, { sharedOnly: true });
    const index = indexByIds(items.filter((i) => i.viewCount > 0));
    const entries = [];
    for (const movie of store.movies()) {
      const item = findByIds(index, movie);
      if (item) entries.push({ movieId: movie.id, viewedAt: item.lastViewedAt });
    }
    store.replaceWatched(row.id, entries, Date.now());
    log.info({ profile: row.name, watched: entries.length }, 'watch history synced');
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 401) {
      // Token revoked or expired: forget it so the profile gets re-linked next time.
      store.setProfileTokens(row.id, null, null);
    }
    log.warn({ err, profile: row.name }, 'watch history sync failed');
  }
}
