import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PLEX_HOSTS } from '../integrations/plex.js';
import { adminCookie, cookieOf, cookiesOf, listen, tempApp } from '../testing.js';

const OWNER = 5001;
const STRANGER = 9009;

describe('setup', () => {
  let server: Server;
  let base: string;
  const originalTv = PLEX_HOSTS.tv;
  /** Plex tokens that reached the fake Plex server's /identity. */
  const tokensSeen: string[] = [];
  /** The id plex.tv gives the next PIN Curatorr asks for. */
  let nextPin = 1;
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
      if (url.pathname === '/api/v2/pins' && req.method === 'POST') return json(201, { id: nextPin, code: 'CODE' });
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
    base = await listen(server);
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
    const { app, ctx, close } = await tempApp('setup', { demo: false });
    cleanups.push(close);
    return { app, store: ctx.store };
  }

  type App = Awaited<ReturnType<typeof freshInstall>>['app'];
  /** Starts a Plex sign-in in a browser, then finishes it there once plex.tv has PIN `pin` approved. */
  async function claim(app: App, pin: number, cookie = '') {
    nextPin = pin;
    const started = await app.inject({ method: 'POST', url: '/api/plex/pin', headers: { cookie }, payload: {} });
    const browser = [cookie, cookiesOf(started)].filter(Boolean).join('; ');
    return app.inject({ method: 'POST', url: `/api/plex/pin/${pin}/claim`, headers: { cookie: browser }, payload: { purpose: 'setup' } });
  }

  it('lets whoever opens a fresh install set it up, until someone signs in with Plex', async () => {
    const { app, store } = await freshInstall();
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(200);

    const signedIn = await claim(app, 1);
    expect(signedIn.json()).toMatchObject({ status: 'ok' });
    expect(store.get('plex').ownerId).toBe(OWNER);
    const cookie = cookieOf(signedIn);

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

  it('only lets the browser that started a Plex sign-in finish it', async () => {
    const { app, store } = await freshInstall();
    store.update('plex', { adminToken: 'owner-token', ownerId: OWNER, ownerName: 'Owner' });
    // The owner starts signing in to settings on their phone, and approves the PIN on plex.tv...
    nextPin = 1;
    const phone = cookiesOf(await app.inject({ method: 'POST', url: '/api/plex/pin', payload: {} }));
    const login = (cookie: string) =>
      app.inject({ method: 'POST', url: '/api/plex/pin/1/claim', headers: { cookie }, payload: { purpose: 'login' } });

    // ...while another browser that learned the PIN's id tries to finish it.
    const stranger = await login('');
    expect(stranger.statusCode).toBe(404);
    expect(stranger.headers['set-cookie']).toBeUndefined();
    expect((await login(phone)).json()).toMatchObject({ status: 'ok' });
  });

  it('lets the owner carry on setting up from another device', async () => {
    const { app, store } = await freshInstall();
    store.update('plex', { adminToken: 'old-owner-token', ownerId: OWNER, ownerName: 'Owner' });

    const res = await claim(app, 1);
    expect(res.json()).toMatchObject({ status: 'ok' });
    expect(store.get('plex').adminToken).toBe('owner-token');
    const cookie = cookieOf(res);
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).statusCode).toBe(200);
  });

  const jellyfinConnected = (store: Awaited<ReturnType<typeof freshInstall>>['store']) =>
    store.set('jellyfin', {
      url: 'http://127.0.0.1:9',
      publicUrl: null,
      serverId: 'server',
      serverName: 'Home',
      deviceId: 'device',
      token: 'jellyfin-token',
      ownerId: 'a'.repeat(32),
      ownerName: 'Admin',
      libraryIds: [],
    });
  const jellyfinAdmin = (app: Awaited<ReturnType<typeof freshInstall>>['app']) =>
    adminCookie(app, 'a'.repeat(32));

  it('lets Jellyfin go when the owner signs in with Plex while setting up', async () => {
    const { app, store } = await freshInstall();
    jellyfinConnected(store);
    expect((await claim(app, 1, jellyfinAdmin(app))).json()).toMatchObject({ status: 'ok' });
    expect(store.get('jellyfin')).toBeNull();
    expect(store.mediaServer()).toBe('plex');
  });

  it('turns down a Plex sign-in for setup once Curatorr is set up with Jellyfin', async () => {
    const { app, store } = await freshInstall();
    jellyfinConnected(store);
    store.set('setupComplete', true);
    expect((await claim(app, 1, jellyfinAdmin(app))).statusCode).toBe(409);
    expect(store.get('plex').ownerId).toBeNull();
    expect(store.get('jellyfin')).not.toBeNull();
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

  it('checks the Seerr key during setup and leaves reading requests to the first library sync', async () => {
    const { app, store } = await freshInstall();
    const connect = () =>
      app.inject({ method: 'PUT', url: '/api/settings/seerr', payload: { url: `${base}/seerr`, apiKey: 'SEERR-KEY' } });

    expect((await connect()).statusCode).toBe(200);
    expect(store.get('seerr')).toEqual({ url: `${base}/seerr`, apiKey: 'SEERR-KEY' });
    expect(keysSeen).toEqual([{ path: '/seerr/api/v1/auth/me', key: 'SEERR-KEY' }]);
    expect(store.get('seerrSync')).toEqual({ at: null, requests: 0, profiles: 0, error: null });

    // Once set up, connecting reads the requests straight away, which this fake Seerr can't answer.
    store.set('setupComplete', true);
    expect((await connect()).statusCode).toBe(200);
    expect(store.get('seerrSync').error).toMatch(/^Seerr: /);
  });

  it('explains a malformed address instead of failing', async () => {
    const { app } = await freshInstall();
    const typo = 'http://192.168.1 .10:7878';
    for (const [method, url, payload] of [
      ['POST', '/api/setup/radarr/test', { url: typo, apiKey: 'k' }],
      ['POST', '/api/setup/plex/server', { url: typo, machineId: 'm' }],
      ['PUT', '/api/settings/seerr', { url: typo, apiKey: 'k' }],
    ] as const) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error, url).toMatch(/like http:\/\/192\.168\.1\.10/);
    }
  });
});
