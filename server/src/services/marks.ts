// What a pick's buttons save, and how each is undone: one place for the rules the routes and watching together share.
import { isMark, type FeedbackKind, type ServerSyncResult } from '@curatorr/shared';
import type { FastifyBaseLogger } from 'fastify';
import { transaction } from '../db.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';
import { applyMark, isServerMark, revertMark } from './mediaServer.js';

/** How long shown picks and skips count. */
const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Shows and skips only matter for a while. Plays started from Curatorr are kept: they're part of a profile's taste. */
export function pruneFeedback(store: Store, now = Date.now()) {
  store.pruneFeedback(now - FEEDBACK_RETENTION_MS);
}

/** What the media server did for a change made for several people: the worst news first. */
export function overall(results: ServerSyncResult[]): ServerSyncResult {
  for (const r of ['failed', 'synced', 'already'] as const) if (results.includes(r)) return r;
  return 'skipped';
}

/**
 * Saves `kind` for each of `rows`, together and at one moment, so ranking for a group counts a shared row once. Seen it
 * and Watchlist then go to each one's media server account, remembering where Curatorr changed it so Undo changes it
 * back. Answers the rows' ids, in the order of `rows`, and what the media server did, for the kinds it hears of.
 */
export async function saveFeedback(
  store: Store,
  rows: ProfileRow[],
  movie: StoredMovie,
  kind: FeedbackKind,
  log: FastifyBaseLogger,
  at = Date.now(),
): Promise<{ ids: number[]; server?: ServerSyncResult }> {
  const ids = transaction(store.db, () => rows.map((row) => store.addFeedback(row.id, movie.id, kind, at)));
  if (!isServerMark(kind)) return { ids };
  const results = await Promise.all(
    rows.map(async (row, i) => {
      const result = await applyMark(store, row, movie, kind, log);
      if (result === 'synced') store.setFeedbackSynced(ids[i]!);
      return result;
    }),
  );
  return { ids, server: overall(results) };
}

/**
 * Undoes one row of `row`'s feedback. A shown, skipped or played pick just goes. A mark goes with every mark of its kind
 * for the movie, and the media server is changed back only where Curatorr changed it: answers what it did then.
 */
export async function undoFeedback(
  store: Store,
  row: ProfileRow,
  entry: { id: number; movieId: number; kind: FeedbackKind },
  log: FastifyBaseLogger,
): Promise<ServerSyncResult | undefined> {
  if (!isMark(entry.kind)) {
    store.deleteFeedback(row.id, entry.id);
    return undefined;
  }
  const { serverSynced } = store.deleteMarks(row.id, entry.movieId, entry.kind);
  const movie = store.movie(entry.movieId);
  if (!serverSynced || !movie || !isServerMark(entry.kind)) return 'skipped';
  return revertMark(store, row, movie, entry.kind, log);
}

/**
 * Takes a movie off `row`'s watchlist: its Watchlist marks, and the media server's entry when Curatorr put it there, or
 * any entry while the owner lets marks update the server.
 */
export async function takeOffWatchlist(
  store: Store,
  row: ProfileRow,
  movie: StoredMovie,
  log: FastifyBaseLogger,
): Promise<ServerSyncResult> {
  const { serverSynced } = store.deleteMarks(row.id, movie.id, 'later');
  const onServer = store.watchlistIds(row.id).has(movie.id);
  if (!onServer || !(serverSynced || store.get('app').syncToServer)) return 'skipped';
  return revertMark(store, row, movie, 'later', log);
}
