import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

const MINUTE = 60_000;

describe("Radarr's webhook", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let ctx: Awaited<ReturnType<typeof buildApp>>['ctx'];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'curatorr-webhook-'));
    ({ app, ctx } = await buildApp({ configDir: dir, demo: false, logger: false }));
    await app.ready();
    // Only the delay before a sync is faked; the app itself runs on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const send = (eventType: string, token = ctx.store.get('radarrWebhook').token) =>
    app.inject({
      method: 'POST',
      url: `/api/radarr/webhook?token=${encodeURIComponent(token)}`,
      payload: { eventType, movie: { id: 7, title: 'Dune: Part Two', year: 2024 }, isUpgrade: false },
    });

  it("records Radarr's Test without syncing", async () => {
    const run = vi.spyOn(ctx.library, 'run');
    expect((await send('Test')).statusCode).toBe(200);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(run).not.toHaveBeenCalled();
    expect(ctx.store.get('radarrWebhook')).toMatchObject({ event: 'Test', title: 'Dune: Part Two' });
    expect(ctx.store.get('radarrWebhook').at).toBeGreaterThan(Date.now() - MINUTE);
  });

  it('syncs once, two minutes after a burst of imports and deletions', async () => {
    const run = vi.spyOn(ctx.library, 'run');
    for (const event of ['Download', 'Download', 'MovieFileDelete', 'MovieDelete']) {
      expect((await send(event)).statusCode).toBe(200);
    }
    vi.advanceTimersByTime(MINUTE);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("doesn't sync for events that leave the library as it is", async () => {
    const run = vi.spyOn(ctx.library, 'run');
    for (const event of ['Grab', 'Rename', 'MovieAdded', 'Health']) await send(event);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(run).not.toHaveBeenCalled();
  });

  it('takes events without a movie, as Radarr sends for its health checks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/radarr/webhook?token=${encodeURIComponent(ctx.store.get('radarrWebhook').token)}`,
      payload: { eventType: 'Health', movie: null, level: 'warning', message: 'Indexers unavailable', type: 'IndexerStatusCheck' },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.store.get('radarrWebhook')).toMatchObject({ event: 'Health', title: null });
  });

  it('stops answering to the old address once a new one is made', async () => {
    const old = ctx.store.get('radarrWebhook').token;
    // Nobody has connected Plex or Jellyfin, so everyone may change the settings.
    const res = await app.inject({ method: 'POST', url: '/api/settings/webhook' });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(token).not.toBe(old);
    expect((await send('Test', old)).statusCode).toBe(401);
    expect((await send('Test', token)).statusCode).toBe(200);
  });

  it('shows the owner the address and what Radarr last sent', async () => {
    await send('Download');
    const settings = (await app.inject({ method: 'GET', url: '/api/settings' })).json() as {
      webhook: { token: string; event: string; title: string };
    };
    expect(settings.webhook).toMatchObject({
      token: ctx.store.get('radarrWebhook').token,
      event: 'Download',
      title: 'Dune: Part Two',
    });
  });
});
