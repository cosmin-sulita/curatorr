import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JellyfinUser } from '../integrations/jellyfin.js';
import type { Store } from '../store.js';
import { tempStore } from '../testing.js';
import { forgetTries, giveBackTry, passwordTries, SIGN_IN_TRIES, takeTry } from './jellyfinSignIn.js';

const DAD = 'dad-id';

/** Dad as Jellyfin has him: by default it never locks him out and last saw him sign in at 1000. */
const account = (over: Partial<JellyfinUser> = {}): JellyfinUser => ({
  id: DAD,
  name: 'Dad',
  admin: true,
  disabled: false,
  maxParentalRating: null,
  imageTag: null,
  lastLoginAt: 1_000,
  lockoutAfter: null,
  wrongPasswords: 0,
  ...over,
});

/** The HTTP status takeTry answers with, or 'ok' when it lets the try through. */
function attempt(store: Store, user: JellyfinUser | null = account()) {
  try {
    takeTry(store, DAD, 'Dad', user);
    return 'ok';
  } catch (err) {
    return (err as { statusCode: number }).statusCode;
  }
}

describe('passwordTries', () => {
  it('allows two wrong passwords, leaving two spare before Jellyfin would disable the account', () => {
    expect(passwordTries(null)).toBe(SIGN_IN_TRIES);
    expect(passwordTries(undefined)).toBe(SIGN_IN_TRIES);
    expect([1, 2, 3, 4, 5, 10].map(passwordTries)).toEqual([0, 0, 1, 2, 2, 2]);
  });
});

describe('counting Settings sign-ins for a Jellyfin administrator', () => {
  let store: Store;
  let close: () => void;

  beforeEach(() => {
    ({ store, close } = tempStore('jellyfin-sign-in'));
  });
  afterEach(() => close());

  const count = () => store.get('jellyfinMisses')[DAD]?.count ?? 0;

  it('counts each try before any answer, and stops at the limit', () => {
    expect([attempt(store), attempt(store), attempt(store)]).toEqual(['ok', 'ok', 429]);
    expect(count()).toBe(2);
    expect(store.get('jellyfinMisses')[DAD]!.lastLoginAt).toBe(1_000);
  });

  it('starts again once Jellyfin saw the person sign in since the count began, and not on an older date', () => {
    attempt(store);
    attempt(store);
    // A clock that's off: Jellyfin's date going back doesn't count as a sign-in.
    expect(attempt(store, account({ lastLoginAt: 500 }))).toBe(429);
    expect(attempt(store, account({ lastLoginAt: 2_000 }))).toBe('ok');
    expect(store.get('jellyfinMisses')[DAD]).toMatchObject({ count: 1, lastLoginAt: 2_000 });
  });

  it("can't see a sign-in without Jellyfin's date, or when reading the account failed", () => {
    attempt(store, account({ lastLoginAt: null }));
    attempt(store, null);
    expect(attempt(store, account({ lastLoginAt: null }))).toBe(429);
    expect(attempt(store, null)).toBe(429);
  });

  it("counts the wrong passwords Jellyfin saw, but only where it disables accounts", () => {
    expect(attempt(store, account({ wrongPasswords: 5 }))).toBe('ok');
    forgetTries(store, DAD);
    expect(attempt(store, account({ lockoutAfter: 5, wrongPasswords: 1 }))).toBe('ok');
    expect(count()).toBe(2);
    expect(attempt(store, account({ lockoutAfter: 5, wrongPasswords: 1 }))).toBe(429);
  });

  it('turns down every try for an account Jellyfin disables after one or two, and counts none', () => {
    for (const lockoutAfter of [1, 2]) expect(attempt(store, account({ lockoutAfter }))).toBe(403);
    expect(store.get('jellyfinMisses')).toEqual({});
  });

  it("gives back a try Jellyfin didn't answer, and forgets them all on the right password", () => {
    attempt(store);
    attempt(store);
    giveBackTry(store, DAD);
    expect(count()).toBe(1);
    giveBackTry(store, DAD);
    expect(store.get('jellyfinMisses')).toEqual({});
    giveBackTry(store, DAD);
    expect(store.get('jellyfinMisses')).toEqual({});

    attempt(store);
    takeTry(store, 'mum-id', 'Mum', account({ id: 'mum-id', name: 'Mum' }));
    forgetTries(store, DAD);
    expect(Object.keys(store.get('jellyfinMisses'))).toEqual(['mum-id']);
  });
});
