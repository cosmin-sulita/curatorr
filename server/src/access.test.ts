import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from './config.js';
import { adminCookie, tempApp } from './testing.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const OWNER = 5001;

/** Routes that change or reveal how Curatorr is set up: the Plex server owner only. */
const ADMIN_ROUTES: [Method, string][] = [
  ['GET', '/api/settings'],
  ['PUT', '/api/settings/app'],
  ['PUT', '/api/settings/seerr'],
  ['DELETE', '/api/settings/seerr'],
  ['POST', '/api/sync'],
  ['POST', '/api/settings/webhook'],
  ['POST', '/api/settings/sign-out-everywhere'],
  ['PATCH', '/api/profiles/1'],
  ['PUT', '/api/profiles/1/pin'],
  ['POST', '/api/setup/radarr/test'],
  ['POST', '/api/setup/radarr'],
  ['GET', '/api/setup/plex/servers'],
  ['POST', '/api/setup/plex/server'],
  ['GET', '/api/setup/plex/libraries'],
  ['POST', '/api/setup/plex/libraries'],
  ['POST', '/api/setup/plex/users'],
  ['POST', '/api/setup/server/skip'],
  ['POST', '/api/setup/jellyfin'],
  ['POST', '/api/setup/jellyfin/libraries'],
  ['POST', '/api/setup/jellyfin/users'],
  ['POST', '/api/setup/complete'],
];

/** Routes that act for the profile picked on this device. */
const PROFILE_ROUTES: [Method, string][] = [
  ['GET', '/api/wizard/genre'],
  ['GET', '/api/recommendations'],
  ['GET', '/api/like'],
  ['POST', '/api/feedback'],
  ['DELETE', '/api/feedback/1'],
  ['DELETE', '/api/watchlist/1'],
  ['GET', '/api/hidden'],
  ['GET', '/api/image/1/poster'],
];

/** Routes anyone who reaches Curatorr may call. */
const PUBLIC_ROUTES: [Method, string][] = [
  ['GET', '/api/health'],
  ['GET', '/api/status'],
  ['GET', '/api/profiles'],
  ['POST', '/api/profiles/logout'],
  ['POST', '/api/profiles/1/select'],
  ['POST', '/api/profiles/together'],
  ['POST', '/api/admin/logout'],
  ['GET', '/api/avatar/x'],
  ['POST', '/api/jellyfin/login'],
  ['POST', '/api/plex/pin/1/claim'],
];

/** Routes guarded some other way, each tested where it says. */
const OTHER_ROUTES: [Method, string][] = [
  // Its token stands in for a sign-in (below).
  ['POST', '/api/radarr/webhook'],
  // Open to anyone, but it asks plex.tv for a PIN, which tests never reach (routes/setup.test.ts).
  ['POST', '/api/plex/pin'],
];

const cleanups: (() => Promise<void>)[] = [];
/** Every route the app adds, as `METHOD /url` with its parameters. */
const registered: string[] = [];

async function freshApp() {
  registered.length = 0;
  const { app, ctx, close } = await tempApp('access', {
    demo: false,
    onRoute: (method, url) => {
      // HEAD routes come with GET ones; the SPA's own pages aren't the API.
      if (method !== 'HEAD' && url.startsWith('/api/')) registered.push(`${method} ${url}`);
    },
  });
  cleanups.push(close);
  return { app, store: ctx.store };
}

type App = Awaited<ReturnType<typeof freshApp>>['app'];
const call = (app: App, method: Method, url: string, cookie = '') =>
  app.inject({ method, url, headers: { cookie }, ...(method === 'GET' ? {} : { payload: {} }) });

describe('who can call each route, once the Plex owner has set Curatorr up', () => {
  let app: App;
  let store: Awaited<ReturnType<typeof freshApp>>['store'];
  let profile = '';
  let owner = '';

  beforeAll(async () => {
    const fresh = await freshApp();
    app = fresh.app;
    store = fresh.store;
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
    owner = adminCookie(app, OWNER);
  });

  afterAll(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('lists every route in exactly one of the lists above, so a new one has to say who may call it', () => {
    const listed = [...ADMIN_ROUTES, ...PROFILE_ROUTES, ...PUBLIC_ROUTES, ...OTHER_ROUTES];
    const pattern = (route: string) => {
      const [method, url] = route.split(' ') as [string, string];
      const path = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+');
      return (m: string, u: string) => m === method && new RegExp(`^${path}$`).test(u.split('?')[0]!);
    };
    expect(registered.length).toBeGreaterThan(30);
    for (const route of registered) {
      const matches = pattern(route);
      expect(listed.filter(([m, u]) => matches(m, u)).length, route).toBe(1);
    }
    // And nothing listed is gone.
    for (const [m, u] of listed) expect(registered.some((r) => pattern(r)(m, u)), `${m} ${u}`).toBe(true);
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

  it("refuses the bodies a form on another site can send, so it can't reach a route with the owner's cookie", async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await app.inject({ method: 'POST', url: '/api/sync', headers: { cookie: owner, 'content-type': type }, payload: 'a=b' });
      expect(res.statusCode, type).toBe(415);
    }
  });

  it("refuses changes another site's page sends, even with the owner's cookie", async () => {
    const from = (site?: string) => ({ cookie: owner, ...(site ? { 'sec-fetch-site': site } : {}) });
    const rotate = (site?: string) => app.inject({ method: 'POST', url: '/api/settings/webhook', headers: from(site), payload: {} });
    const before = store.get('radarrWebhook').token;
    // A sibling subdomain is the same site, so the browser sends the cookies along.
    for (const site of ['same-site', 'cross-site']) {
      const res = await rotate(site);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Requests from other sites are refused' });
    }
    const seerr = await app.inject({ method: 'DELETE', url: '/api/settings/seerr', headers: from('cross-site') });
    expect(seerr.statusCode).toBe(403);
    expect(store.get('radarrWebhook').token).toBe(before);

    expect((await rotate('same-origin')).statusCode).toBe(200);
    expect(store.get('radarrWebhook').token).not.toBe(before);
    // Radarr calls without the header, and reading stays open: another site can't read the answer.
    const { token } = store.get('radarrWebhook');
    const webhook = await app.inject({ method: 'POST', url: `/api/radarr/webhook?token=${token}`, payload: { eventType: 'Test' } });
    expect(webhook.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: from('cross-site') })).statusCode).toBe(200);
  });

  it("tells browsers not to sniff Curatorr's responses or pass on its address", async () => {
    const res = await call(app, 'GET', '/api/status');
    expect(res.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' });
    // Dashboards like Organizr show it in a frame.
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it("shows why the last sync failed to the owner only, since it names Radarr's address", async () => {
    store.update('sync', { error: 'Radarr: could not reach http://192.168.1.10:7878: ECONNREFUSED' });
    const lastError = async (cookie = '') => (await call(app, 'GET', '/api/status', cookie)).json().library.lastError;
    expect(await lastError()).toBe('The last library sync failed');
    expect(await lastError(profile)).toBe('The last library sync failed');
    expect(await lastError(owner)).toMatch(/^Radarr: could not reach http:\/\/192\.168\.1\.10:7878/);
    store.update('sync', { error: null });
    expect(await lastError()).toBeNull();
  });

  it('tells only the owner when a newer release is out, since only they can update the container', async () => {
    // Tests run as `dev`, which has no release to compare with.
    const running = config.version;
    config.version = '1.2.0';
    store.set('latestVersion', '1.3.0');
    try {
      const update = async (cookie = '') => (await call(app, 'GET', '/api/status', cookie)).json().update;
      expect(await update()).toBeNull();
      expect(await update(profile)).toBeNull();
      expect(await update(owner)).toEqual({
        version: '1.3.0',
        url: 'https://github.com/cosmin-sulita/curatorr/releases/tag/v1.3.0',
      });
    } finally {
      config.version = running;
      store.set('latestVersion', null);
    }
  });

  it('keeps its media server once set up: skipping one is a step of setup only', async () => {
    const res = await call(app, 'POST', '/api/setup/server/skip', owner);
    expect(res.statusCode).toBe(409);
    expect(store.owner()).toEqual({ server: 'plex', id: String(OWNER) });
  });

  it("lets Radarr's webhook in with its secret, and nobody else", async () => {
    const { token } = store.get('radarrWebhook');
    expect(token.length).toBeGreaterThanOrEqual(32);
    for (const url of ['/api/radarr/webhook', '/api/radarr/webhook?token=wrong', `/api/radarr/webhook?token=${token}x`]) {
      expect((await call(app, 'POST', url, owner)).statusCode).toBe(401);
    }
    const res = await app.inject({ method: 'POST', url: `/api/radarr/webhook?token=${token}`, payload: { eventType: 'Test' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('a Curatorr set up with Jellyfin', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("lets in Jellyfin's administrators, and nobody else", async () => {
    const { app, store } = await freshApp();
    const [owner, otherAdmin, member] = ['a', 'b', 'c'].map((c) => c.repeat(32));
    store.set('jellyfin', {
      url: 'http://127.0.0.1:9',
      publicUrl: null,
      serverId: 'server',
      serverName: 'Home',
      deviceId: 'device',
      token: 'jellyfin-token',
      ownerId: owner!,
      ownerName: 'Owner',
      libraryIds: [],
    });
    store.set('setupComplete', true);
    for (const [id, isAdmin] of [[otherAdmin!, true], [member!, false]] as const) {
      store.upsertJellyfinProfile({ jellyfinUserId: id, name: id, avatarUrl: null, isAdmin, restrictionProfile: null });
    }
    const signedIn = (id: string) => adminCookie(app, id);

    for (const id of [owner!, otherAdmin!]) expect((await call(app, 'GET', '/api/settings', signedIn(id))).statusCode).toBe(200);
    for (const cookie of ['', signedIn(member!), signedIn(String(OWNER))]) {
      const res = await call(app, 'GET', '/api/settings', cookie);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'Sign in as a Jellyfin administrator', needAdmin: true });
    }
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
