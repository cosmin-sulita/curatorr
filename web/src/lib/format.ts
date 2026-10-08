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

const MOBILE = /android|iphone|ipad|ipod/i;

/** Opens a movie in the Plex app on phones, falling back to Plex Web. */
export function openInPlex(appUrl: string | null, webUrl: string | null) {
  if (!webUrl) return;
  if (appUrl && MOBILE.test(navigator.userAgent)) {
    const fallback = window.setTimeout(() => {
      if (document.visibilityState === 'visible') window.location.href = webUrl;
    }, 1500);
    document.addEventListener('visibilitychange', () => window.clearTimeout(fallback), { once: true });
    window.location.href = appUrl;
    return;
  }
  window.open(webUrl, '_blank', 'noopener');
}

export function vibrate(ms = 12) {
  navigator.vibrate?.(ms);
}
