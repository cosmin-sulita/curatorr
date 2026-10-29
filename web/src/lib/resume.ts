import { pickingDay, type AppStatus } from '@curatorr/shared';
import type { QueryClient } from '@tanstack/react-query';
import { keys, refreshPicking, refreshQuestions } from './api';
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
  let hidden: { at: number; turnover: number | null } | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // The server's turnover, as the app knew it when it went away.
      hidden ??= { at: Date.now(), turnover: qc.getQueryData<AppStatus>(keys.status)?.turnover ?? null };
      return;
    }
    if (hidden === null) return;
    const since = hidden;
    hidden = null;
    const now = Date.now();
    if (nightIsOver(since, now)) startOver(qc);
    else if (now - since.at >= LONG_BREAK_MS) refreshPicking(qc);
  });
}

/** Whether the night the app went away in is over: past the server's turnover, or the phone's 4 am without one. */
export function nightIsOver(since: { at: number; turnover: number | null }, now: number) {
  return since.turnover != null ? now >= since.turnover : pickingDay(since.at) !== pickingDay(now);
}

function startOver(qc: QueryClient) {
  if (PICKING.test(window.location.pathname) && window.location.pathname !== '/ask/genre') {
    navigate('/', { replace: true, animate: false });
  }
  // Last night's picks loaded ahead go. A pick still on screen takes its own along as it closes (see PickScreen), and
  // dropping it before would only fetch it again.
  refreshQuestions(qc);
}
