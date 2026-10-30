import type { FastifyBaseLogger } from 'fastify';
import type { Store } from '../store.js';
import { saveFeedback } from './marks.js';
import { syncServerState } from './mediaServer.js';

/** A movie played together counts as watched by everyone once one account shows it within this long. */
const SETTLE_WINDOW_MS = 12 * 60 * 60 * 1000;
/** How often the pending ones are checked. */
const CHECK_EVERY_MS = 10 * 60 * 1000;
/** Watch tapped again on the same movie, by the same group, this soon is the same evening's play. */
const TOGETHER_AGAIN_MS = 6 * 60 * 60 * 1000;

/** Remembers that a group started playing a movie at `at`, once per evening, for `settleTogether`. */
export function startedTogether(store: Store, movieId: number, profileIds: number[], at = Date.now()) {
  store.recordTogether(movieId, profileIds, at, at - TOGETHER_AGAIN_MS);
}

/**
 * A group plays a movie on one account, so the others' profiles would keep suggesting it. For each movie a
 * group started playing in the last 12 hours, reads the members' watch history, and once one of them shows
 * it watched since then, marks it seen for the rest, on their media server accounts too unless the owner
 * turned that off. Movies nobody finished within 12 hours are let go.
 */
export async function settleTogether(store: Store, log: FastifyBaseLogger, now = Date.now()) {
  for (const pending of store.pendingTogether()) {
    const movie = store.movie(pending.movieId);
    const members = pending.profileIds.flatMap((id) => store.profileRow(id) ?? []);
    if (now - pending.startedAt > SETTLE_WINDOW_MS || !movie || members.length < 2) {
      store.closeTogether(pending.id, now);
      continue;
    }
    // Fresh histories, not the ten-minute-old ones the app would make do with.
    await Promise.all(members.map((m) => syncServerState(store, m, log, true).catch(() => {})));
    const watchedAt = (profileId: number) => store.watchHistory(profileId).find((w) => w.movieId === movie.id)?.viewedAt;
    if (!members.some((m) => (watchedAt(m.id) ?? 0) >= pending.startedAt)) continue;

    const marked: string[] = [];
    for (const m of members) {
      const markedSeen = store.feedback(m.id).some((e) => e.kind === 'seen' && e.movieId === movie.id);
      if (watchedAt(m.id) != null || markedSeen) continue;
      await saveFeedback(store, [m], movie, 'seen', log, now);
      marked.push(m.name);
    }
    store.closeTogether(pending.id, now);
    log.info({ movie: movie.title, marked }, 'watched together: marked watched for the rest of the group');
  }
}

/** Checks the movies played together every 10 minutes. The timer doesn't keep the process alive. */
export function scheduleTogether(store: Store, log: FastifyBaseLogger) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    settleTogether(store, log)
      .catch((err) => log.warn({ err }, 'could not settle movies watched together'))
      .finally(() => (running = false));
  }, CHECK_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
