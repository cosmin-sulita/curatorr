import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../db.js';
import type { ProfileRow, Store } from '../store.js';
import { silentLog, storedMovieMaker, tempStore } from '../testing.js';
import { overall, saveFeedback, takeOffWatchlist, undoFeedback } from './marks.js';

const movie = storedMovieMaker();

describe('marks, without a media server', () => {
  let store: Store;
  let close: () => void;
  let a: ProfileRow;
  let b: ProfileRow;
  const up = movie({ title: 'Up' });

  beforeEach(() => {
    ({ store, close } = tempStore('marks'));
    store.replaceMovies([up], Date.now());
    a = store.profileRow(store.createLocalProfile('A', true))!;
    b = store.profileRow(store.createLocalProfile('B', false))!;
  });

  afterEach(() => close());

  it('saves a row for each person at one moment, in their order, and tells nothing of a server for a skip', async () => {
    const res = await saveFeedback(store, [a, b], up, 'skipped', silentLog, 1_000);
    expect(res.server).toBeUndefined();
    expect(res.ids).toHaveLength(2);
    expect(store.feedback(a.id)).toEqual([expect.objectContaining({ movieId: up.id, kind: 'skipped', createdAt: 1_000 })]);
    expect(store.feedback(b.id)).toEqual([expect.objectContaining({ movieId: up.id, kind: 'skipped', createdAt: 1_000 })]);
  });

  it('says the server was skipped for a mark it would hear of', async () => {
    expect((await saveFeedback(store, [a], up, 'seen', silentLog)).server).toBe('skipped');
  });

  it("undoes a pick's event row by row, and a mark with every mark of its kind", async () => {
    const [skip] = (await saveFeedback(store, [a], up, 'skipped', silentLog)).ids;
    await saveFeedback(store, [a], up, 'skipped', silentLog);
    expect(await undoFeedback(store, a, { id: skip!, movieId: up.id, kind: 'skipped' }, silentLog)).toBeUndefined();
    expect(store.feedback(a.id).filter((e) => e.kind === 'skipped')).toHaveLength(1);

    const [never] = (await saveFeedback(store, [a], up, 'never', silentLog)).ids;
    await saveFeedback(store, [a], up, 'never', silentLog);
    expect(await undoFeedback(store, a, { id: never!, movieId: up.id, kind: 'never' }, silentLog)).toBe('skipped');
    expect(store.feedback(a.id).filter((e) => e.kind === 'never')).toEqual([]);
  });

  it("takes a movie off the watchlist, but leaves the server's own entry while marks don't update the server", async () => {
    store.update('app', { syncToServer: false });
    await saveFeedback(store, [a], up, 'later', silentLog);
    store.addToWatchlist(a.id, up.id);
    expect(await takeOffWatchlist(store, a, up, silentLog)).toBe('skipped');
    expect(store.feedback(a.id).filter((e) => e.kind === 'later')).toEqual([]);
    expect(store.watchlistIds(a.id).has(up.id)).toBe(true);
  });

  it('tells the worst of several servers’ answers', () => {
    expect(overall(['skipped', 'synced', 'failed'])).toBe('failed');
    expect(overall(['already', 'synced'])).toBe('synced');
    expect(overall(['skipped', 'already'])).toBe('already');
    expect(overall([])).toBe('skipped');
  });

  it('rolls back an outer transaction when an inner one fails', () => {
    expect(() =>
      transaction(store.db, () => {
        store.addFeedback(a.id, up.id, 'never');
        transaction(store.db, () => {
          store.addFeedback(b.id, up.id, 'never');
          throw new Error('nope');
        });
      }),
    ).toThrow('nope');
    expect([...store.feedback(a.id), ...store.feedback(b.id)]).toEqual([]);
  });
});
