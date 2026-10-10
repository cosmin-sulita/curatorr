import type { MediaServer } from '@curatorr/shared';

export function runtime(minutes: number | null) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

export function relativeTime(epochMs: number | null) {
  if (!epochMs) return 'never';
  const diff = Date.now() - epochMs;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(epochMs).toLocaleDateString();
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The media server's name in the UI. Without one (the demo, say), Curatorr talks about Plex, as it always did. */
export const serverName = (server: MediaServer | null | undefined) => (server === 'jellyfin' ? 'Jellyfin' : 'Plex');

/** iPhones and iPads. iPadOS reports itself as a Mac, so also look for touch. */
export function isIOS() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Phones and tablets. */
export const isMobileDevice = () => /android/i.test(navigator.userAgent) || isIOS();

export interface WatchLink {
  href: string;
  newTab: boolean;
  /** For plex:// links: where to go if no app picks the link up. */
  fallback: string | null;
}

/**
 * The Watch button's link for this device. With Plex, phones get a watch.plex.tv link, which the
 * Plex apps claim as a universal/app link, opened in the same window because iOS hands those
 * to the app most reliably on a direct tap. Movies without one use the plex:// scheme. On
 * desktop it's Plex Web. Jellyfin's apps take no links, so every device gets its web app.
 */
export function watchLink(appUrl: string | null, webUrl: string | null): WatchLink | null {
  if (appUrl && isMobileDevice()) {
    return { href: appUrl, newTab: false, fallback: appUrl.startsWith('plex:') ? webUrl : null };
  }
  return webUrl ? { href: webUrl, newTab: true, fallback: null } : null;
}

/** After following a plex:// link: if no app opened within a moment, go to the fallback. */
export function fallBackIfStillHere(url: string) {
  const timer = window.setTimeout(() => {
    if (document.visibilityState === 'visible') window.location.href = url;
  }, 1500);
  document.addEventListener('visibilitychange', () => window.clearTimeout(timer), { once: true });
}

export function vibrate(ms = 12) {
  navigator.vibrate?.(ms);
}
