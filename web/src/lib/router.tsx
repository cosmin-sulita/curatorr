import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export { withQuery } from './url';

/**
 * A deliberately tiny history router. Every wizard answer lives in the URL,
 * so the phone's back gesture steps back through the questions.
 */

const NAV_EVENT = 'curatorr:navigate';

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener(NAV_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAV_EVENT, callback);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

/** How the latest move happened: forward, back, or with an animation of the browser's own (Safari's swipe back). */
export type Direction = 'forward' | 'back' | 'none';

// Each entry's place in history, to tell Back from forward when the browser moves through it.
const placeOf = (state: unknown) => (state as { idx?: number } | null)?.idx ?? 0;
let place = placeOf(window.history.state);
let direction: Direction = 'forward';
// When the screen last changed: the second tap of a double tap mustn't act on the screen the first one opened.
let arrivedAt = 0;

window.addEventListener('popstate', (e) => {
  arrivedAt = performance.now();
  const idx = placeOf(e.state);
  const animated = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
  direction = animated ? 'none' : idx < place ? 'back' : 'forward';
  place = idx;
});

/** True for a moment after moving to another screen (Back included), so the taps that matter can wait it out. */
export const justArrived = (ms = 300) => performance.now() - arrivedAt < ms;

/** Pure, so it's safe to read while rendering. */
export const navigationDirection = () => direction;

/**
 * `back`: the move goes back to an earlier screen, like the logo going home, so it slides in as Back does.
 * `animate: false`: the screen just changes, as when the app starts over on coming back the next day.
 */
export function navigate(to: string, opts: { replace?: boolean; back?: boolean; animate?: boolean } = {}) {
  if (to === snapshot()) return;
  if (opts.replace) window.history.replaceState({ idx: place }, '', to);
  else {
    window.history.pushState({ idx: ++place }, '', to);
    arrivedAt = performance.now();
  }
  direction = opts.animate === false ? 'none' : opts.back ? 'back' : 'forward';
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return { path: url.pathname, search: url.searchParams, href };
}

export function Link({
  to,
  back,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; back?: boolean }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to, { back });
  };
  return <a href={to} onClick={handle} {...rest} />;
}

