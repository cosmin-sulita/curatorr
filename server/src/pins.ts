import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * PINs Curatorr keeps itself, for Jellyfin profiles: stored as `scrypt$salt$hash`, so the database never holds
 * the PIN. Four digits are few, so it's the wrong-guess limit (`Guesses`) that keeps them from being tried.
 */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(pin, salt, 32).toString('base64url')}`;
}

export function pinMatches(pin: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const given = scryptSync(pin, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(given, expected);
}
