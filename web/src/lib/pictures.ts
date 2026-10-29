// Loading pictures: the size each place shows, and loading them the one way the service worker keeps (with CORS).

/** How soon a picture is wanted: for a screen that's opening, or ahead of a tap that may never come. */
export type Priority = 'high' | 'low';

/**
 * Pictures load with CORS, which TMDB allows, so the service worker keeps them at their real size: browsers count an
 * opaque copy as megabytes of storage. Every way of loading one must do the same, since the browser keeps the two
 * kinds of copy apart: a picture loaded both ways would download twice, and what's loaded ahead wouldn't be used.
 */
export const CROSS_ORIGIN = 'anonymous';

/**
 * TMDB widths for the places a picture shows: what a 3× phone screen needs there, no more. Decoding costs memory by a
 * picture's size, not by how small it shows: a 500 px poster in a 40-point fan takes 7× what a 185 px one does, and a
 * long theme list holds about a hundred of them. The mood cards, and the pick's poster, rail and backdrop, use the
 * stored sizes (w1280 backdrops, w500 posters).
 */
export const PICTURE = { fan: 'w185', tile: 'w780', grid: 'w342' } as const;

/**
 * The same TMDB picture at another width. Pictures from elsewhere (Radarr's proxy, the demo's drawings) stay as they
 * are.
 */
export function sized<T extends string | null | undefined>(url: T, width: string): T {
  return (url ? url.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//, `$1${width}/`) : url) as T;
}

/**
 * A picture from somewhere that doesn't allow CORS fails to load with it: asks for it again without, once, rather
 * than losing it. False when it was already asked for without, so the picture is missing.
 */
export function retryWithoutCors(img: HTMLImageElement) {
  if (!img.crossOrigin) return false;
  img.removeAttribute('crossorigin');
  return true;
}

/** Every picture loads through here, the way the screens load it, so what's loaded ahead is what they show. */
export function loadImage(src: string, priority?: Priority) {
  const img = new Image();
  img.crossOrigin = CROSS_ORIGIN;
  if (priority) img.fetchPriority = priority;
  img.src = src;
  return img;
}

/** True when the browser already holds this image (it completes at once), so it needn't fade in. */
export function isCached(src: string | null | undefined) {
  if (!src) return false;
  const probe = loadImage(src);
  return probe.complete && probe.naturalWidth > 0;
}

/** Loads and decodes images ahead of showing them. Done when they all are, or after `capMs` at the latest. */
export function preloadImages(urls: (string | null | undefined)[], capMs: number) {
  const all = Promise.all(urls.flatMap((src) => (src ? [loadImage(src, 'high').decode().catch(() => {})] : [])));
  return Promise.race([all, new Promise((resolve) => setTimeout(resolve, capMs))]);
}

/**
 * Starts loading pictures without waiting for them, so a screen that shows them later has them at once. Those wanted
 * for a screen that's opening are decoded too, so they paint on its first frame.
 */
export function warmImages(urls: (string | null | undefined)[], priority: Priority) {
  for (const src of urls) {
    if (!src) continue;
    const img = loadImage(src, priority);
    if (priority === 'high') img.decode().catch(() => {});
  }
}
