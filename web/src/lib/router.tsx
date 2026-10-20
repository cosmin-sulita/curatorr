import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

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

// When the screen last changed: the second tap of a double tap mustn't act on the screen the first one opened.
let arrivedAt = 0;
window.addEventListener('popstate', () => {
  arrivedAt = performance.now();
});

/** True for a moment after moving to another screen (Back included), so the taps that matter can wait it out. */
export const justArrived = (ms = 300) => performance.now() - arrivedAt < ms;

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else {
    window.history.pushState(null, '', to);
    arrivedAt = performance.now();
  }
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return { path: url.pathname, search: url.searchParams, href };
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** Builds `path?query`, dropping empty values. */
export function withQuery(path: string, params: Record<string, string | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
