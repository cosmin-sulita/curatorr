import { useEffect, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Picks up new versions without closing the app. iOS freezes a home-screen app in the background
 * instead of reloading it, so the browser's own check (on page load) rarely runs: check again each
 * time the app comes back to the foreground, and hourly while it stays open.
 */

const HOUR_MS = 60 * 60 * 1000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let ready = false;
// Whether the user has tapped or typed since the app last came to the foreground.
let touched = false;
// Mounted screens holding input that a reload would lose (see useDeferUpdates).
let holds = 0;
const listeners = new Set<() => void>();

// Reloading before the user has done anything just looks like the app opening; otherwise ask first.
const canReloadNow = () => !touched && holds === 0;

/** Switches to the waiting version; the page reloads once it takes over. */
export const applyUpdate = () => void updateSW?.();

export function startUpdateChecks() {
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => (touched = true), { capture: true, passive: true });
  }

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (canReloadNow()) return applyUpdate();
      ready = true;
      listeners.forEach((l) => l());
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Curatorr may be out of reach right now (away from home): the next check tries again.
      const check = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        touched = false;
        if (!ready) check();
        else if (canReloadNow()) applyUpdate();
      });
      setInterval(() => document.visibilityState === 'visible' && !ready && check(), HOUR_MS);
    },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** True while a new version waits for the user to tap Update (or for the app's next return). */
export const useUpdateReady = () => useSyncExternalStore(subscribe, () => ready);

/** For screens with input that isn't in the URL, or a sign-in in progress: updates wait to be tapped. */
export function useDeferUpdates() {
  useEffect(() => {
    holds++;
    return () => {
      holds--;
    };
  }, []);
}
