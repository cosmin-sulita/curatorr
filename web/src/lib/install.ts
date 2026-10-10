import { useSyncExternalStore } from 'react';
import { isIOS, isMobileDevice } from './format';

/**
 * The "Add to Home Screen" tip on phones. A browser tab can't tell whether Curatorr is already on the home screen
 * (iOS keeps the installed app's storage apart from Safari's), so the tip stays in the browser until it's
 * dismissed. The installed app never shows it.
 */

/** Chromium's offer to install the app, which TypeScript's DOM types leave out. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** 'share' for the Share → Add to Home Screen steps (iOS), 'prompt' for an Install button (Android). */
export type InstallHint = 'share' | 'prompt' | null;

const KEY = 'curatorr:installHint';

function wasDismissed() {
  try {
    return localStorage.getItem(KEY) === 'dismissed';
  } catch {
    return false;
  }
}

let dismissed = wasDismissed();
let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Opened from the home screen rather than in a browser tab. */
function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own flag, which older versions set instead.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Android browsers offer to install once the app qualifies, possibly before the first render: keep that offer. */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // The tip stands in for Chrome's own install banner. Computers, and phones that dismissed the tip, keep the banner.
    if (dismissed || !isMobileDevice()) return;
    e.preventDefault();
    offer = e as InstallPromptEvent;
    notify();
  });
  // Installed from the browser's menu instead.
  window.addEventListener('appinstalled', () => {
    offer = null;
    notify();
  });
}

export function dismissInstallHint() {
  dismissed = true;
  try {
    localStorage.setItem(KEY, 'dismissed');
  } catch {
    // Storage blocked: the tip comes back next time, which is harmless.
  }
  notify();
}

/** Opens the browser's install dialog. Saying no there counts as dismissing the tip. */
export async function install() {
  const event = offer;
  if (!event) return;
  // An offer only works once.
  offer = null;
  notify();
  await event.prompt();
  if ((await event.userChoice).outcome === 'dismissed') dismissInstallHint();
}

function currentHint(): InstallHint {
  if (dismissed || isInstalled()) return null;
  if (isIOS()) return 'share';
  return offer ? 'prompt' : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useInstallHint = () => useSyncExternalStore(subscribe, currentHint);
