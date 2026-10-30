import { HttpError } from '../http.js';
import type { JellyfinUser } from '../integrations/jellyfin.js';
import type { Store } from '../store.js';

/**
 * How Settings sign-in keeps Curatorr from locking a Jellyfin administrator out. Jellyfin can disable an account after
 * a few wrong passwords in a row, so Curatorr passes on two in a row at most (fewer where Jellyfin disables it sooner),
 * then waits until the person has signed in to Jellyfin itself. The count lives in the `jellyfinMisses` setting, so a
 * restart forgets nothing.
 */

/** Wrong passwords Settings sign-in passes on to Jellyfin before the person has signed in to Jellyfin itself. */
export const SIGN_IN_TRIES = 2;

/**
 * How many wrong passwords in a row Settings sign-in may pass on for an account: two, but never so many that
 * Jellyfin would disable it, with room left for wrong ones typed in Jellyfin's own apps meanwhile.
 */
export function passwordTries(lockoutAfter: number | null | undefined): number {
  return lockoutAfter == null ? SIGN_IN_TRIES : Math.min(Math.max(lockoutAfter - 2, 0), SIGN_IN_TRIES);
}

/**
 * Counts a Settings sign-in as a wrong password until Jellyfin says otherwise, or turns it down when the account has
 * had its tries. `account` is the user as Jellyfin has them now, or null when that read failed. Nothing in it waits,
 * so sign-ins sent together are counted one by one.
 */
export function takeTry(store: Store, userId: string, name: string, account: JellyfinUser | null) {
  const misses = store.get('jellyfinMisses');
  let missed = misses[userId];
  // Signing in to Jellyfin itself shows the person knows the password, so the count starts again. Jellyfin's
  // date is compared with the one it gave when the count began, so a clock that's off can't start it again.
  const since = missed?.lastLoginAt;
  if (missed && account?.lastLoginAt != null && (since == null || account.lastLoginAt > since)) missed = undefined;
  const after = account?.lockoutAfter;
  const tries = passwordTries(after);
  if (tries === 0 && after != null) {
    // Not a matter of wrong passwords: one could already disable the account, whatever happens in Jellyfin.
    throw new HttpError(
      403,
      `Jellyfin disables ${name}'s account after ${after} wrong password${after === 1 ? '' : 's'}, so Curatorr ` +
        "doesn't pass on passwords for it. Sign in as another administrator, or allow more tries in Jellyfin.",
    );
  }
  // Where Jellyfin disables accounts, wrong passwords typed in its own apps bring that closer too.
  const count = Math.max(missed?.count ?? 0, account?.lockoutAfter != null ? account.wrongPasswords : 0);
  if (count >= tries) {
    throw new HttpError(429, `Too many wrong passwords for ${name}. Sign in to Jellyfin itself once, then try again here.`);
  }
  const lastLoginAt = missed ? missed.lastLoginAt : (account?.lastLoginAt ?? null);
  store.set('jellyfinMisses', { ...misses, [userId]: { count: count + 1, at: Date.now(), lastLoginAt } });
}

/** The sign-in wasn't an answer about the password (Jellyfin couldn't be reached, say), so it doesn't count. */
export function giveBackTry(store: Store, userId: string) {
  const { [userId]: missed, ...others } = store.get('jellyfinMisses');
  if (!missed) return;
  store.set('jellyfinMisses', missed.count > 1 ? { ...others, [userId]: { ...missed, count: missed.count - 1 } } : others);
}

/** The right password: the account starts afresh. */
export function forgetTries(store: Store, userId: string) {
  const { [userId]: _, ...others } = store.get('jellyfinMisses');
  store.set('jellyfinMisses', others);
}
