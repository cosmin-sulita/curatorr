import { randomBytes } from 'node:crypto';
import { dayStart } from '@curatorr/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './http.js';
import { toProfile, type ProfileRow, type Store } from './store.js';

const PROFILE_COOKIE = 'curatorr_profile';
const ADMIN_COOKIE = 'curatorr_admin';
/** PIN-protected profiles whose PIN was entered on this device, and until when it holds. */
const UNLOCKED_COOKIE = 'curatorr_unlocked';
/** The others watching with this device's profile tonight, and when the group ends. */
const TOGETHER_COOKIE = 'curatorr_together';
/** Plex sign-ins started in this browser, which only it may finish. */
const PLEX_PINS_COOKIE = 'curatorr_plex_pins';
const YEAR_S = 365 * 24 * 60 * 60;
/** How long a PIN entered for the device's own profile holds, while the device stays on that profile. */
export const PIN_HOLDS_MS = YEAR_S * 1000;
const ADMIN_TTL_S = 30 * 24 * 60 * 60;
/** Longer than plex.tv keeps a sign-in PIN. */
const PLEX_PIN_TTL_S = 30 * 60;

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

/**
 * Every sign-in to settings and every PIN entered belongs to the current session epoch. Settings → Sign out all
 * other devices starts a new one, and cookies from before it stop counting. Until then there is none (''), which is
 * also what cookies from before epochs existed carry, so nobody was signed out by the update that brought them.
 */
const epochOf = (store: Store) => store.get('sessionEpoch') ?? '';

export const newSessionEpoch = () => randomBytes(12).toString('base64url');

/** Signs in the Plex owner (by plex.tv account id) or a Jellyfin administrator (by user id). */
export function setAdminCookie(reply: FastifyReply, store: Store, accountId: number | string) {
  const epoch = epochOf(store);
  reply.setCookie(ADMIN_COOKIE, [accountId, Date.now(), ...(epoch ? [epoch] : [])].join('.'), cookieOptions(ADMIN_TTL_S));
}

/** The account signed in to settings on this device, while its sign-in holds. */
export function adminId(req: FastifyRequest, store: Store): string | null {
  const value = readSigned(req, ADMIN_COOKIE);
  if (!value) return null;
  const [id, issued, epoch = ''] = value.split('.');
  if (!id || !(Date.now() - Number(issued) < ADMIN_TTL_S * 1000)) return null;
  return epoch === epochOf(store) ? id : null;
}

export function clearAdminCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_COOKIE, { path: '/' });
}

/** The Plex sign-in PINs this browser started. */
export function plexPinsHere(req: FastifyRequest): number[] {
  return (readSigned(req, PLEX_PINS_COOKIE)?.split(',') ?? []).map(Number).filter(Number.isInteger);
}

/**
 * Remembers that this browser started a Plex sign-in. plex.tv hands the token to whoever asks with the PIN's
 * id, so only the browser that started it may finish it. A few at most: one sign-in is under way at a time.
 */
export function rememberPlexPin(req: FastifyRequest, reply: FastifyReply, id: number) {
  reply.setCookie(PLEX_PINS_COOKIE, [...plexPinsHere(req), id].slice(-3).join(','), cookieOptions(PLEX_PIN_TTL_S));
}

/**
 * The protected profiles whose PIN was entered on this device, and until when it holds (ms): `epoch|id:until,…`.
 * A cookie from before PINs had an end lists ids only (`1,2`); they hold until the device next picks a profile,
 * which writes the new kind.
 */
export function unlocksHere(req: FastifyRequest, store: Store): Map<number, number> {
  const value = readSigned(req, UNLOCKED_COOKIE);
  const unlocks = new Map<number, number>();
  if (!value) return unlocks;
  const now = Date.now();
  const bar = value.indexOf('|');
  if (bar < 0) {
    if (epochOf(store)) return unlocks;
    for (const id of value.split(',').map(Number)) if (Number.isInteger(id)) unlocks.set(id, now + PIN_HOLDS_MS);
    return unlocks;
  }
  if (value.slice(0, bar) !== epochOf(store)) return unlocks;
  for (const entry of value.slice(bar + 1).split(',')) {
    const [id, until] = entry.split(':').map(Number);
    if (Number.isInteger(id) && until! > now) unlocks.set(id!, until!);
  }
  return unlocks;
}

/** Saves which protected profiles' PINs hold on this device, and until when. */
export function setUnlocks(req: FastifyRequest, reply: FastifyReply, store: Store, unlocks: Map<number, number>) {
  if (!unlocks.size) {
    if (req.cookies[UNLOCKED_COOKIE]) reply.clearCookie(UNLOCKED_COOKIE, { path: '/' });
    return;
  }
  const value = `${epochOf(store)}|${[...unlocks].map(([id, until]) => `${id}:${until}`).join(',')}`;
  const lastsS = Math.ceil((Math.max(...unlocks.values()) - Date.now()) / 1000);
  reply.setCookie(UNLOCKED_COOKIE, value, cookieOptions(lastsS));
}

/** Whether the profile has a PIN: its Plex Home PIN, or with Jellyfin one an administrator set in Curatorr. */
export function hasPin(store: Store, row: ProfileRow): boolean {
  if (row.plex_user_id != null) return Boolean(row.pin_protected) && store.plexConfigured();
  return row.jellyfin_user_id != null && row.pin_hash != null && store.get('jellyfin') != null;
}

/**
 * Whether this device must enter the profile's PIN before using it. Like Plex's own apps, a protected profile
 * asks on each device; here it asks again once the device has moved to another profile (or, for someone watching
 * together, once the group is over). The owner's profile, or with Jellyfin an administrator's, also opens where
 * that same account has signed in to settings.
 */
export function pinNeededHere(req: FastifyRequest, store: Store, row: ProfileRow): boolean {
  if (!hasPin(store, row)) return false;
  if (unlocksHere(req, store).has(row.id)) return false;
  return !(row.is_admin && adminId(req, store) === String(row.plex_user_id ?? row.jellyfin_user_id));
}

/**
 * A Plex Home user whose tokens Plex stopped accepting (or who never had any): it would silently stop syncing, so
 * picking the profile links it anew, with its PIN if it has one, as it did the first time.
 */
export function needsPlexLink(store: Store, row: ProfileRow): boolean {
  return store.plexConfigured() && row.plex_user_id != null && !row.server_token;
}

/** A profile as the app sees it, with whether it has a PIN here. */
export const profileFor = (store: Store, row: ProfileRow) => toProfile(row, hasPin(store, row));

export function currentProfile(req: FastifyRequest, store: Store): ProfileRow | null {
  const value = readSigned(req, PROFILE_COOKIE);
  if (!value) return null;
  const row = store.profileRow(Number(value));
  if (!row || row.hidden) return null;
  if (needsPlexLink(store, row)) return null;
  // A PIN added in Plex since this device picked the profile: it asks, as for a new device.
  if (pinNeededHere(req, store, row)) return null;
  return row;
}

export function requireProfile(req: FastifyRequest, store: Store): ProfileRow {
  const row = currentProfile(req, store);
  if (!row) throw new HttpError(401, 'Pick a profile first', { needProfile: true });
  return row;
}

/** A group watching together lasts the evening: until the 4 am turnover that also reshuffles the picks. */
export function togetherUntil(now: number) {
  // Thirty hours on is the next day whichever way the clocks change; its turnover is the one after tonight's.
  return dayStart(dayStart(now) + 30 * 60 * 60 * 1000);
}

/** Starts watching together: `memberIds` join this device's profile until the evening is over. */
export function setTogetherCookie(reply: FastifyReply, memberIds: number[], now = Date.now()) {
  const until = togetherUntil(now);
  reply.setCookie(TOGETHER_COOKIE, `${memberIds.join(',')}|${until}`, cookieOptions(Math.ceil((until - now) / 1000)));
}

export function clearTogetherCookie(reply: FastifyReply) {
  reply.clearCookie(TOGETHER_COOKIE, { path: '/' });
}

function togetherIds(req: FastifyRequest): number[] {
  const [ids, until] = readSigned(req, TOGETHER_COOKIE)?.split('|') ?? [];
  if (!ids || !(Number(until) > Date.now())) return [];
  return ids.split(',').map(Number).filter(Number.isInteger);
}

/**
 * This device's profile, then whoever is watching with it tonight. Members who were removed, hidden,
 * whose Plex sign-in stopped working or who got a PIN this device hasn't entered drop out, which leaves
 * the profile on its own.
 */
export function currentGroup(req: FastifyRequest, store: Store): ProfileRow[] {
  const profile = currentProfile(req, store);
  if (!profile) return [];
  const others = togetherIds(req).flatMap((id) => {
    const row = id === profile.id ? undefined : store.profileRow(id);
    if (!row || row.hidden || needsPlexLink(store, row)) return [];
    if (pinNeededHere(req, store, row)) return [];
    return [row];
  });
  return [profile, ...others];
}

export function requireGroup(req: FastifyRequest, store: Store): ProfileRow[] {
  const group = currentGroup(req, store);
  if (!group.length) throw new HttpError(401, 'Pick a profile first', { needProfile: true });
  return group;
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
  const id = adminId(req, store);
  if (!id) return false;
  return id === owner.id || (owner.server === 'jellyfin' && store.isJellyfinAdmin(id));
}

export function requireAdmin(req: FastifyRequest, store: Store) {
  if (isAdmin(req, store)) return;
  const jellyfin = store.owner()?.server === 'jellyfin';
  const message = jellyfin ? 'Sign in as a Jellyfin administrator' : 'Sign in with Plex as the server owner';
  throw new HttpError(403, message, { needAdmin: true });
}
