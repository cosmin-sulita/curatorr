import { pickingDay } from '@curatorr/shared';
import type { QueryClient } from '@tanstack/react-query';
import { navigate } from './router';

/** Away from the app this long, what it shows is fetched again on coming back. */
const LONG_BREAK_MS = 30 * 60_000;

/** The screens of an evening's picking, which the next evening starts over from the first question. */
const PICKING = /^\/(ask\/[a-z]+|pick|like)$/;

/**
 * Like an iPhone app, Curatorr stays where it was while it's in the background, sometimes for days. On coming back:
 * - after the night is over (the 4 am turnover, when picks reshuffle and groups end), it starts again at the first
 *   question, quietly, as if it had just opened;
 * - after a long break the same evening (the movie got watched, say), the questions and the picks on screen are
 *   fetched again where they are.
 * The status refreshes on coming back anyway (see useStatus), and with it who's watching.
 */
export function refreshOnReturn(qc: QueryClient) {
  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt ??= Date.now();
      return;
    }
    if (hiddenAt === null) return;
    const since = hiddenAt;
    hiddenAt = null;
    const now = Date.now();
    if (pickingDay(since) !== pickingDay(now)) startOver(qc);
    else if (now - since >= LONG_BREAK_MS) refetchPicking(qc);
  });
}

const QUESTIONS = ['wizard', 'like', 'hidden'];

function refetchPicking(qc: QueryClient) {
  for (const key of [...QUESTIONS, 'recommendations']) void qc.invalidateQueries({ queryKey: [key] });
}

function startOver(qc: QueryClient) {
  if (PICKING.test(window.location.pathname) && window.location.pathname !== '/ask/genre') {
    navigate('/', { replace: true, animate: false });
  }
  // Last night's picks, loaded ahead or shown: a pick still on screen takes its own along as it closes (see
  // PickScreen), and dropping it before would only fetch it again.
  qc.removeQueries({ queryKey: ['recommendations'], type: 'inactive' });
  for (const key of QUESTIONS) void qc.invalidateQueries({ queryKey: [key] });
}
