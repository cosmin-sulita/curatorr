import { STEP_ORDER, type Criteria, type WizardStep } from '@curatorr/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { preloadImages } from '../components/ui';
import { recommendationsQuery, wizardQuery } from './api';
import { justArrived, navigate, withQuery } from './router';

// Moving on: how long the next question may wait for its first pictures (about a screenful of them), and a pick
// for its poster (as long as the shuffle waits for its cards), when the tapped answer starts saying it's loading,
// and the longest the old screen stays before the next shows its own spinner.
const IMAGE_WAIT = 250;
const FIRST_IMAGES = 18;
const POSTER_WAIT = 600;
const SLOW = 300;
const MAX_WAIT = 1500;

// Every wizard answer lives in the address, so the phone's back gesture steps back through the questions.

export const isStep = (s: string | undefined): s is WizardStep => STEP_ORDER.includes(s as WizardStep);

export function criteriaFrom(search: URLSearchParams): Criteria {
  return {
    genre: search.get('genre'),
    theme: search.get('theme'),
    mood: search.get('mood'),
    time: search.get('time'),
    shelf: search.get('shelf'),
  };
}

/** Answers given before `step`; later answers are dropped when going back. */
export function answersBefore(step: WizardStep, c: Criteria): Criteria {
  const out: Criteria = {};
  for (const s of STEP_ORDER) {
    if (s === step) break;
    out[s] = c[s] ?? null;
  }
  return out;
}

export function nextUrl(step: WizardStep, c: Criteria, value: string) {
  const answers = { ...answersBefore(step, c), [step]: value };
  const index = STEP_ORDER.indexOf(step);
  const next = STEP_ORDER[index + 1];
  return withQuery(next ? `/ask/${next}` : '/pick', answers);
}

/**
 * Loads what `url` shows, so it can arrive whole, and returns where to go: a question with no real choice is
 * passed over with "no preference", as its own screen would do, so it never shows.
 */
export async function prepare(qc: QueryClient, url: string): Promise<string> {
  const { pathname, searchParams } = new URL(url, window.location.origin);
  if (pathname === '/pick') {
    const { picks } = await qc.fetchQuery(recommendationsQuery(criteriaFrom(searchParams), searchParams.get('like')));
    const first = picks[0]?.movie;
    // The poster is the reveal itself, so it's waited for; the backdrop fades in whenever it's ready.
    if (first?.fanartUrl) new Image().src = first.fanartUrl;
    await preloadImages([first?.posterUrl], POSTER_WAIT);
    return url;
  }
  const step = /^\/ask\/([a-z]+)$/.exec(pathname)?.[1];
  if (!isStep(step)) return url;
  const answers = answersBefore(step, criteriaFrom(searchParams));
  const data = await qc.fetchQuery(wizardQuery(step, answers));
  if (data.skip) return prepare(qc, nextUrl(step, answers, 'any'));
  const images = [...(data.shelves ?? []), ...data.options].flatMap((o) => o.images);
  await preloadImages(images.slice(0, FIRST_IMAGES), IMAGE_WAIT);
  return url;
}

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
 * Moves on once the next screen has loaded (see `prepare`), so it arrives with its answers instead of a spinner.
 * `before` runs just before moving, so a tap left behind (Back pressed meanwhile) changes nothing.
 */
export function useAdvance() {
  const qc = useQueryClient();
  const [going, setGoing] = useState<Going | null>(null);
  const busy = useRef(false);

  const go = (id: string, url: string, before?: () => void) => {
    if (busy.current || justArrived()) return;
    busy.current = true;
    const from = window.location.pathname + window.location.search;
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
      if (window.location.pathname + window.location.search !== from) return;
      before?.();
      navigate(to);
    });
  };

  return { go, going };
}
