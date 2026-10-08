import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './http.js';
import type { ProfileRow, Store } from './store.js';

const PROFILE_COOKIE = 'curatorr_profile';
const ADMIN_COOKIE = 'curatorr_admin';
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

export function setAdminCookie(reply: FastifyReply, ownerId: number) {
  reply.setCookie(ADMIN_COOKIE, `${ownerId}.${Date.now()}`, cookieOptions(ADMIN_TTL_S));
}

export function clearAdminCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_COOKIE, { path: '/' });
}

export function currentProfile(req: FastifyRequest, store: Store): ProfileRow | null {
  const value = readSigned(req, PROFILE_COOKIE);
  if (!value) return null;
  const row = store.profileRow(Number(value));
  return row && !row.hidden ? row : null;
}

export function requireProfile(req: FastifyRequest, store: Store): ProfileRow {
  const row = currentProfile(req, store);
  if (!row) throw new HttpError(401, 'Pick a profile first', { needProfile: true });
  return row;
}

/**
 * Admin rights are needed for settings. Before setup is complete, and when no
 * Plex owner exists to verify against, everyone is admin (like the *arr apps
 * without authentication). Otherwise the server owner must have signed in with Plex.
 */
export function isAdmin(req: FastifyRequest, store: Store): boolean {
  if (store.demo || !store.get('setupComplete')) return true;
  const { ownerId } = store.get('plex');
  if (!ownerId) return true;
  const value = readSigned(req, ADMIN_COOKIE);
  if (!value) return false;
  const [id, issued] = value.split('.').map(Number);
  return id === ownerId && Date.now() - (issued ?? 0) < ADMIN_TTL_S * 1000;
}

export function requireAdmin(req: FastifyRequest, store: Store) {
  if (!isAdmin(req, store)) throw new HttpError(403, 'Sign in with Plex as the server owner', { needAdmin: true });
}
