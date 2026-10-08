import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const OWNER = 5001;

/** Routes that change or reveal how Curatorr is set up: the Plex server owner only. */
const ADMIN_ROUTES: [Method, string][] = [
  ['GET', '/api/settings'],
  ['PUT', '/api/settings/app'],
  ['PUT', '/api/settings/seerr'],
  ['DELETE', '/api/settings/seerr'],
  ['POST', '/api/sync'],
  ['PATCH', '/api/profiles/1'],
  ['POST', '/api/setup/radarr/test'],
  ['POST', '/api/setup/radarr'],
  ['GET', '/api/setup/plex/servers'],
  ['POST', '/api/setup/plex/server'],
  ['GET', '/api/setup/plex/libraries'],
  ['POST', '/api/setup/plex/libraries'],
  ['POST', '/api/setup/plex/users'],
  ['POST', '/api/setup/plex/skip'],
  ['POST', '/api/setup/complete'],
];

/** Routes that act for the profile picked on this device. */
const PROFILE_ROUTES: [Method, string][] = [
  ['GET', '/api/wizard/genre'],
  ['GET', '/api/recommendations'],
  ['GET', '/api/like'],
  ['POST', '/api/feedback'],
  ['DELETE', '/api/feedback/1'],
  ['GET', '/api/hidden'],
];

/** Routes anyone who reaches Curatorr may call. */
const PUBLIC_ROUTES: [Method, string][] = [
  ['GET', '/api/health'],
  ['GET', '/api/status'],
  ['GET', '/api/profiles'],
  ['POST', '/api/profiles/logout'],
  ['POST', '/api/admin/logout'],
  ['GET', '/api/image/1/poster'],
];

const cleanups: (() => Promise<void>)[] = [];

async function freshApp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-access-'));
  const { app, ctx } = await buildApp({ configDir: dir, demo: false, logger: false });
  cleanups.push(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { app, store: ctx.store };
}

type App = Awaited<ReturnType<typeof freshApp>>['app'];
const call = (app: App, method: Method, url: string, cookie = '') =>
  app.inject({ method, url, headers: { cookie }, ...(method === 'GET' ? {} : { payload: {} }) });

describe('who can call each route, once the Plex owner has set Curatorr up', () => {
  let app: App;
  let profile = '';
  let owner = '';

  beforeAll(async () => {
    const fresh = await freshApp();
    app = fresh.app;
    const { store } = fresh;
    // An unused port: nothing here may reach a real Plex server.
    store.update('plex', { adminToken: 'owner-token', ownerId: OWNER, ownerName: 'Owner', machineId: 'm', serverUrl: 'http://127.0.0.1:9' });
    store.set('setupComplete', true);
    const member = store.upsertPlexProfile({
      plexUserId: OWNER + 1,
      plexUuid: null,
      name: 'Member',
      avatarUrl: null,
      isAdmin: false,
      restrictionProfile: null,
      pinProtected: false,
    });
    store.setProfileTokens(member, 'member-token', 'member-server-token');
    profile = `curatorr_profile=${encodeURIComponent(app.signCookie(String(member)))}`;
    owner = `curatorr_admin=${encodeURIComponent(app.signCookie(`${OWNER}.${Date.now()}`))}`;
  });

  afterAll(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it.each(ADMIN_ROUTES)('%s %s needs the owner', async (method, url) => {
    for (const cookie of ['', profile]) {
      const res = await call(app, method, url, cookie);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ needAdmin: true });
    }
  });

  it.each(PROFILE_ROUTES)('%s %s needs a profile', async (method, url) => {
    const res = await call(app, method, url);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ needProfile: true });
  });

  it.each(PUBLIC_ROUTES)('%s %s is open to anyone', async (method, url) => {
    expect([401, 403]).not.toContain((await call(app, method, url)).statusCode);
  });

  it('lets the owner and a picked profile through', async () => {
    expect((await call(app, 'GET', '/api/settings', owner)).statusCode).toBe(200);
    expect((await call(app, 'GET', '/api/wizard/genre', profile)).statusCode).toBe(200);
  });
});

describe('a Curatorr set up without Plex', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('has no owner to sign in, so its settings are open to anyone', async () => {
    const { app, store } = await freshApp();
    store.createLocalProfile('Me', true);
    store.set('setupComplete', true);
    expect((await call(app, 'GET', '/api/settings')).statusCode).toBe(200);
  });
});
