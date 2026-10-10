import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './http.js';
import type { ProfileRow, Store } from './store.js';

const PROFILE_COOKIE = 'curatorr_profile';
const ADMIN_COOKIE = 'curatorr_admin';
/** PIN-protected profiles whose PIN was entered on this device. */
const UNLOCKED_COOKIE = 'curatorr_unlocked';
const YEAR_S = 365 * 24 * 60 * 60;
const ADMIN_TTL_S = 30 * 24 * 60 * 60;

const cookieOptions = (maxAge: number) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: 'auto' as const,
  signed: true,
  maxAge,
});

function readSigned(req: FastifyRequest, name: string): string | null {
  const raw = req.cookies[name];
  if (!raw) return null;
  const result = req.unsignCookie(raw);
  return result.valid ? result.value : null;
}

export function setProfileCookie(reply: FastifyReply, profileId: number) {
  reply.setCookie(PROFILE_COOKIE, String(profileId), cookieOptions(YEAR_S));
}

export function clearProfileCookie(reply: FastifyReply) {
  reply.clearCookie(PROFILE_COOKIE, { path: '/' });
}

/** Signs in the Plex owner (by plex.tv account id) or a Jellyfin administrator (by user id). */
export function setAdminCookie(reply: FastifyReply, accountId: number | string) {
  reply.setCookie(ADMIN_COOKIE, `${accountId}.${Date.now()}`, cookieOptions(ADMIN_TTL_S));
}

export function clearAdminCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_COOKIE, { path: '/' });
}

function unlockedHere(req: FastifyRequest): Set<number> {
  const value = readSigned(req, UNLOCKED_COOKIE);
  return new Set(value ? value.split(',').map(Number) : []);
}

/**
 * Whether this device must enter the profile's Plex PIN before using it. Like Plex's own apps, a
 * protected profile asks once on each device. The owner's profile also opens where the owner has
 * signed in to settings.
 */
export function pinNeededHere(req: FastifyRequest, store: Store, row: ProfileRow): boolean {
  if (!row.pin_protected || row.plex_user_id == null || !store.plexConfigured()) return false;
  if (unlockedHere(req).has(row.id)) return false;
  return !(row.is_admin && isAdmin(req, store));
}

/** Remembers on this device that the profile's PIN was entered. */
export function rememberPin(req: FastifyRequest, reply: FastifyReply, profileId: number) {
  const ids = unlockedHere(req).add(profileId);
  reply.setCookie(UNLOCKED_COOKIE, [...ids].join(','), cookieOptions(YEAR_S));
}

export function currentProfile(req: FastifyRequest, store: Store): ProfileRow | null {
  const value = readSigned(req, PROFILE_COOKIE);
  if (!value) return null;
  const row = store.profileRow(Number(value));
  if (!row || row.hidden) return null;
  // A Plex user whose tokens Plex stopped accepting would silently stop syncing: picking the
  // profile again links it anew (with the PIN, if it has one), as it did the first time.
  if (store.plexConfigured() && row.plex_user_id != null && !row.server_token) return null;
  return row;
}

export function requireProfile(req: FastifyRequest, store: Store): ProfileRow {
  const row = currentProfile(req, store);
  if (!row) throw new HttpError(401, 'Pick a profile first', { needProfile: true });
  return row;
}

/**
 * Admin rights are needed for setup and settings. Until someone signs in with Plex or connects
 * Jellyfin (a fresh install, or one set up without either) there is no owner to verify against, so
 * everyone is admin (like the *arr apps without authentication). From then on, even before setup is
 * complete, the Plex server owner, or with Jellyfin one of its administrators, must have signed in on
 * this device.
 */
export function isAdmin(req: FastifyRequest, store: Store): boolean {
  if (store.demo) return true;
  const owner = store.owner();
  if (!owner) return true;
  const value = readSigned(req, ADMIN_COOKIE);
  if (!value) return false;
  const [id, issued] = value.split('.');
  if (!id || Date.now() - Number(issued ?? 0) >= ADMIN_TTL_S * 1000) return false;
  return id === owner.id || (owner.server === 'jellyfin' && store.isJellyfinAdmin(id));
}

export function requireAdmin(req: FastifyRequest, store: Store) {
  if (isAdmin(req, store)) return;
  const jellyfin = store.owner()?.server === 'jellyfin';
  const message = jellyfin ? 'Sign in as a Jellyfin administrator' : 'Sign in with Plex as the server owner';
  throw new HttpError(403, message, { needAdmin: true });
}
