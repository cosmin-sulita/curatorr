import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { PLEX_HOSTS } from '../integrations/plex.js';

const OWNER = 5001;
const STRANGER = 9009;

describe('setup', () => {
  let server: Server;
  let base: string;
  const originalTv = PLEX_HOSTS.tv;
  /** Plex tokens that reached the fake Plex server's /identity. */
  const tokensSeen: string[] = [];
  /** API keys that reached a fake Radarr or Seerr, and where. */
  const keysSeen: { path: string; key: string | undefined }[] = [];
  const cleanups: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const token = req.headers['x-plex-token'] as string | undefined;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      // plex.tv: PIN 1 was approved by the owner, PIN 2 by someone else.
      const pin = /^\/api\/v2\/pins\/(\d+)$/.exec(url.pathname);
      if (pin) return json(200, { id: Number(pin[1]), authToken: pin[1] === '1' ? 'owner-token' : 'stranger-token' });
      if (url.pathname === '/api/v2/user') {
        return json(200, token === 'owner-token' ? { id: OWNER, title: 'Owner' } : { id: STRANGER, title: 'Stranger' });
      }
      // A Plex Media Server, or someone pretending to be one.
      if (url.pathname === '/identity') {
        if (token) tokensSeen.push(token);
        return json(200, { MediaContainer: { machineIdentifier: 'elsewhere', version: '1' } });
      }
      // Radarr and Seerr, under whatever address they were given.
      if (url.pathname.endsWith('/api/v3/system/status') || url.pathname.endsWith('/api/v1/auth/me')) {
        keysSeen.push({ path: url.pathname, key: req.headers['x-api-key'] as string | undefined });
        return json(200, { version: '5.0', id: 1 });
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    PLEX_HOSTS.tv = base;
  });

  afterEach(async () => {
    tokensSeen.length = 0;
    keysSeen.length = 0;
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  afterAll(() => {
    PLEX_HOSTS.tv = originalTv;
    server.close();
  });

  async function freshInstall() {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-setup-'));
    const { app, ctx } = await buildApp({ configDir: dir, demo: false, logger: false });
    cleanups.push(async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });
    return { app, store: ctx.store };
  }

  const claim = (app: Awaited<ReturnType<typeof freshInstall>>['app'], pin: number, cookie = '') =>
    app.inject({ method: 'POST', url: `/api/plex/pin/${pin}/claim`, headers: { cookie }, payload: { purpose: 'setup' } });

  it('lets whoever opens a fresh install set it up, until someone signs in with Plex', async () => {
    const { app, store } = await freshInstall();
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(200);

    const signedIn = await claim(app, 1);
    expect(signedIn.json()).toMatchObject({ status: 'ok' });
    expect(store.get('plex').ownerId).toBe(OWNER);
    const cookie = String(signedIn.headers['set-cookie']).split(';')[0]!;

    // From now on setup belongs to the owner, even though it isn't finished.
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).statusCode).toBe(200);
  });

  it("never sends the owner's Plex token to an address a stranger picks mid-setup", async () => {
    const { app, store } = await freshInstall();
    store.update('plex', { adminToken: 'owner-token', ownerId: OWNER, ownerName: 'Owner' });

    const res = await app.inject({ method: 'POST', url: '/api/setup/plex/server', payload: { machineId: 'm', url: base } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ needAdmin: true });
    expect(tokensSeen).toEqual([]);

    // Signing in with another Plex account doesn't take setup over either.
    expect((await claim(app, 2)).statusCode).toBe(403);
    expect(store.get('plex').ownerId).toBe(OWNER);
  });

  it('lets the owner carry on setting up from another device', async () => {
    const { app, store } = await freshInstall();
    store.update('plex', { adminToken: 'old-owner-token', ownerId: OWNER, ownerName: 'Owner' });

    const res = await claim(app, 1);
    expect(res.json()).toMatchObject({ status: 'ok' });
    expect(store.get('plex').adminToken).toBe('owner-token');
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).statusCode).toBe(200);
  });

  it('sends a saved API key only to the address it was saved for', async () => {
    // Set up without Plex: there's no owner to sign in, so anyone can reach these routes.
    const { app, store } = await freshInstall();
    store.set('radarr', { url: `${base}/radarr`, apiKey: 'RADARR-KEY' });
    store.set('seerr', { url: `${base}/seerr`, apiKey: 'SEERR-KEY' });

    const radarr = await app.inject({ method: 'POST', url: '/api/setup/radarr', payload: { url: `${base}/elsewhere` } });
    const seerr = await app.inject({ method: 'PUT', url: '/api/settings/seerr', payload: { url: `${base}/elsewhere` } });
    expect([radarr.statusCode, seerr.statusCode]).toEqual([400, 400]);
    expect(keysSeen).toEqual([]);
    expect(store.get('radarr')!.url).toBe(`${base}/radarr`);

    // The same address keeps the saved key, and a new address works with its key.
    expect((await app.inject({ method: 'POST', url: '/api/setup/radarr', payload: { url: `${base}/radarr` } })).statusCode).toBe(200);
    const moved = await app.inject({ method: 'POST', url: '/api/setup/radarr', payload: { url: `${base}/moved`, apiKey: 'NEW-KEY' } });
    expect(moved.statusCode).toBe(200);
    expect(keysSeen).toEqual([
      { path: '/radarr/api/v3/system/status', key: 'RADARR-KEY' },
      { path: '/moved/api/v3/system/status', key: 'NEW-KEY' },
    ]);
  });
});
