import { NO_PREFERENCE, STEP_ORDER, type WizardStep } from '@curatorr/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { firstPictures, recommendationsQuery, wizardQuery } from './api';
import { answersBefore, criteriaFrom, isStep, nextUrl } from './criteria';
import { warmImages } from './pictures';
import { justArrived, navigate, navigationDirection } from './router';

export { SURPRISE_URL, answersBefore, criteriaFrom, isStep, nextUrl } from './criteria';

// Moving on, when the next screen's answers aren't loaded yet (see useLookAhead): when the tapped answer starts
// saying it's loading, and the longest the old screen stays before the next shows its own spinner.
const SLOW = 300;
const MAX_WAIT = 1500;
/** How many answers load ahead at once (see useLookAhead). */
const AHEAD_AT_ONCE = 3;

/**
 * Loads what `url` shows and returns where to go: a question with no real choice is passed over with "no preference",
 * as its own screen would do, so it never shows. The screen's first pictures start loading, but nothing waits for
 * them: one still loading fades in. `ahead` (before any tap) leaves a question's pictures for the touch and only
 * starts a pick's poster, the reveal itself, or for "Surprise me" every poster, since the shuffle deals them.
 */
export async function prepare(qc: QueryClient, url: string, { ahead = false } = {}): Promise<string> {
  const { pathname, searchParams } = new URL(url, window.location.origin);
  if (pathname === '/pick') {
    const { picks } = await qc.fetchQuery(recommendationsQuery(criteriaFrom(searchParams), searchParams.get('like')));
    const first = picks[0]?.movie;
    const surprise = STEP_ORDER.every((s) => searchParams.get(s) === NO_PREFERENCE);
    if (!ahead) warmImages([first?.posterUrl, first?.fanartUrl], 'high');
    else warmImages(surprise ? picks.map((p) => p.movie.posterUrl) : [first?.posterUrl], 'low');
    return url;
  }
  const step = /^\/ask\/([a-z]+)$/.exec(pathname)?.[1];
  if (!isStep(step)) return url;
  const answers = answersBefore(step, criteriaFrom(searchParams));
  const data = await qc.fetchQuery(wizardQuery(step, answers));
  if (data.skip) return prepare(qc, nextUrl(step, answers, NO_PREFERENCE), { ahead });
  if (!ahead) warmImages(firstPictures(data), 'high');
  return url;
}

/**
 * Loads what each of a question's answers leads to (`urls`, see `prepare`) while it's on screen, so tapping one moves
 * on at once. A few at a time, in `urls`' order: over HTTP/1.1 a browser opens six connections to Curatorr, and a tap
 * on an answer that isn't loaded yet must not queue behind the rest. Runs again when `key` changes (another question,
 * or its answers refreshed after a mark), and what's left of the old list stops.
 */
export function useLookAhead(urls: string[], key: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const queue = [...urls];
    const next = (): Promise<void> | void => {
      const url = queue.shift();
      if (stopped || !url) return;
      return prepare(qc, url, { ahead: true })
        .catch(() => {})
        .then(next);
    };
    for (let i = 0; i < AHEAD_AT_ONCE; i++) void next();
    return () => {
      stopped = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Where a screen slides in from: the right going forward, the left going back. Not at all when the browser already
 * animated the move, and with reduced motion it only fades (starting off to the side would jump into place). Screens
 * animate to `ENTERED`.
 */
export function useEntrance() {
  const reduceMotion = useReducedMotionConfig();
  const direction = navigationDirection();
  if (direction === 'none') return false;
  if (reduceMotion) return { opacity: 0 };
  // A transform, not motion's x: the browser then runs the slide on its own, while the new screen keeps the page busy.
  return { opacity: 0, transform: `translateX(${direction === 'back' ? -28 : 28}px)` };
}

/**
 * Where an entrance ends. Motion leaves `translateX(0px)` behind once a slide to `none` is over, and any transform
 * would hold the screen's fixed descendants, so it's `none` again at rest.
 */
export const ENTERED = { opacity: 1, transform: 'none', transitionEnd: { transform: 'none' } };

/** The answer that was tapped, while its screen loads; `slow` once that takes a moment. */
export interface Going {
  id: string;
  slow: boolean;
}

/** The tapped answer stays pressed while the next screen loads, and says it's loading once that takes a moment. */
export type Tapped = 'pressed' | 'slow' | null;
export const tapped = (going: Going | null, id: string): Tapped =>
  going?.id === id ? (going.slow ? 'slow' : 'pressed') : null;

/**
 * Moves on once the next screen's answers are in (see `prepare`; loaded ahead, they already are), so it arrives with
 * them instead of a spinner. `before` runs just before moving, so a tap left behind (Back pressed meanwhile) changes
 * nothing. `warm` starts loading a screen from the moment a finger lands on its answer, before the tap completes.
 */
export function useAdvance() {
  const qc = useQueryClient();
  const [going, setGoing] = useState<Going | null>(null);
  const busy = useRef(false);

  const go = (id: string, url: string, before?: () => void) => {
    if (busy.current || justArrived()) return;
    busy.current = true;
    // Back, or the logo, pressed meanwhile wins. A search typed meanwhile only changes the query, which doesn't.
    const from = window.location.pathname;
    setGoing({ id, slow: false });
    const slow = window.setTimeout(() => setGoing((g) => g && { ...g, slow: true }), SLOW);
    // A server that's slow or down doesn't hold the tap: the next screen shows its own spinner or error.
    let giveUp = 0;
    const late = new Promise<string>((resolve) => (giveUp = window.setTimeout(() => resolve(url), MAX_WAIT)));
    void Promise.race([prepare(qc, url).catch(() => url), late]).then((to) => {
      window.clearTimeout(slow);
      window.clearTimeout(giveUp);
      busy.current = false;
      setGoing(null);
      if (window.location.pathname !== from) return;
      before?.();
      navigate(to);
    });
  };

  const warm = (url: string) => void prepare(qc, url).catch(() => {});

  return { go, going, warm };
}
