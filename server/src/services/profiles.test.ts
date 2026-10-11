import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { PLEX_HOSTS } from '../integrations/plex.js';
import type { Store } from '../store.js';
import { importHomeUsers, syncPlexState } from './profiles.js';

const OWNER = 5001;
const MEMBER = 5002;
const KID = 5003;
const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

type App = Awaited<ReturnType<typeof buildApp>>['app'];

describe('Plex Home profiles', () => {
  let server: Server;
  let base: string;
  const original = { ...PLEX_HOSTS };
  /** What plex.tv answers for the Home user list. */
  let homeUsersStatus = 200;
  /** Plex Home PINs, by user id; the Member's profile is protected. */
  let pins: Record<number, string> = {};
  /** User switches asked of plex.tv, each one checking a PIN when the user has one. */
  let switches = 0;
  /** Server tokens the Plex server no longer accepts. */
  const revoked = new Set<string>();
  /** What Plex Home says about the Kid; changed in Plex after setup by some tests. */
  let kidInPlex: Record<string, unknown> = {};
  const cleanups: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      // plex.tv
      if (url.pathname === '/api/home/users') {
        if (homeUsersStatus !== 200) return json(homeUsersStatus, {});
        return json(200, {
          users: [
            { id: OWNER, title: 'Owner', admin: true },
            { id: MEMBER, title: 'Member', protected: true },
            { id: KID, title: 'Kid', ...kidInPlex },
          ],
        });
      }
      if (url.pathname === '/api/v2/resources') {
        const token = req.headers['x-plex-token'];
        return json(200, [{ provides: 'server', clientIdentifier: 'machine', owned: true, accessToken: `${token}-server` }]);
      }
      const switched = /^\/api\/home\/users\/(\d+)\/switch$/.exec(url.pathname);
      if (switched) {
        switches++;
        const pin = pins[Number(switched[1])];
        if (pin && url.searchParams.get('pin') !== pin) return json(401, {});
        return json(200, { authToken: `user-${switched[1]}` });
      }
      // Plex Discover and the Plex Media Server, read when a profile is picked.
      if (url.pathname === '/library/sections/watchlist/all') return json(200, { MediaContainer: { totalSize: 0 } });
      // Radarr, for a library sync.
      if (url.pathname === '/api/v3/movie' || url.pathname === '/api/v3/collection') return json(200, []);
      if (url.pathname === '/library/sections/1/all') {
        const token = req.headers['x-plex-token'] as string;
        return revoked.has(token) ? json(401, {}) : json(200, { MediaContainer: { Metadata: [] } });
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    PLEX_HOSTS.tv = base;
    PLEX_HOSTS.discover = base;
  });

  afterEach(async () => {
    homeUsersStatus = 200;
    pins = { [MEMBER]: '1234' };
    revoked.clear();
    kidInPlex = {};
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  afterAll(() => {
    Object.assign(PLEX_HOSTS, original);
    server.close();
  });

  /** A Curatorr signed in to Plex as the owner, with no profiles yet. */
  async function plexInstance() {
    pins = { [MEMBER]: '1234' };
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-profiles-'));
    const { app, ctx } = await buildApp({ configDir: dir, demo: false, logger: false });
    cleanups.push(async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const store = ctx.store;
    store.update('plex', {
      adminToken: 'owner-token',
      ownerId: OWNER,
      ownerName: 'Owner',
      machineId: 'machine',
      serverUrl: base,
      sectionIds: ['1'],
    });
    store.set('radarr', { url: base, apiKey: 'radarr-key' });
    store.set('setupComplete', true);
    return { app, store, library: ctx.library };
  }

  const names = (store: Store) => store.profileRows(true).map((p) => p.name);
  const idOf = (store: Store, name: string) => store.profileRows(true).find((p) => p.name === name)!.id;
  const select = (app: App, id: number, { pin, cookie = '' }: { pin?: string; cookie?: string } = {}) =>
    app.inject({ method: 'POST', url: `/api/profiles/${id}/select`, headers: { cookie }, payload: pin ? { pin } : {} });
  /** The cookies a response set, as a Cookie header. */
  const cookiesOf = (res: LightMyRequestResponse) =>
    [res.headers['set-cookie'] ?? []].flat().map((c) => String(c).split(';')[0]).join('; ');

  it('imports the owner and the Home users, linking the ones without a PIN', async () => {
    const { store } = await plexInstance();
    await importHomeUsers(store, silent);
    expect(store.profileRows(true).map((p) => [p.name, Boolean(p.server_token)])).toEqual([
      ['Owner', true],
      ['Kid', true],
      ['Member', false],
    ]);
  });

  it("keeps everyone's profiles and marks when a refresh can't read Plex Home", async () => {
    const { store } = await plexInstance();
    await importHomeUsers(store, silent);
    const member = idOf(store, 'Member');
    store.addFeedback(member, 1, 'never');

    homeUsersStatus = 503;
    await expect(importHomeUsers(store, silent)).rejects.toThrow(/Plex: HTTP 503/);
    expect(names(store)).toEqual(['Owner', 'Kid', 'Member']);
    expect(store.feedback(member)).toHaveLength(1);
  });

  it('still sets up the owner when the first import cannot read Plex Home', async () => {
    const { store } = await plexInstance();
    homeUsersStatus = 503;
    await importHomeUsers(store, silent);
    expect(names(store)).toEqual(['Owner']);
  });

  it('asks to pick a profile again once its Plex sign-in stops working', async () => {
    const { app, store } = await plexInstance();
    await importHomeUsers(store, silent);
    const kid = idOf(store, 'Kid');
    const cookie = cookiesOf(await select(app, kid));
    const status = async () => (await app.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json();
    expect((await status()).profile).toMatchObject({ name: 'Kid' });

    // Plex stops accepting the Kid's token (a new password, say), so the next sync forgets it.
    revoked.add(store.profileRow(kid)!.server_token!);
    await syncPlexState(store, store.profileRow(kid)!, silent, true);
    expect(store.profileRow(kid)!.server_token).toBeNull();
    expect((await status()).profile).toBeNull();
    const wizard = await app.inject({ method: 'GET', url: '/api/wizard/genre', headers: { cookie } });
    expect(wizard.json()).toMatchObject({ needProfile: true });

    // Picking it again links it anew.
    revoked.clear();
    expect((await select(app, kid, { cookie })).statusCode).toBe(200);
    expect(store.profileRow(kid)!.server_token).not.toBeNull();
    expect((await status()).profile).toMatchObject({ name: 'Kid' });
  });

  it('picks up a PIN or a restriction added in Plex at the next library sync', async () => {
    const { app, store, library } = await plexInstance();
    await importHomeUsers(store, silent);
    const kid = idOf(store, 'Kid');

    kidInPlex = { protected: true, restricted: true, restrictionProfile: 'little_kid' };
    pins[KID] = '4321';
    await library.run();
    expect(store.profileRow(kid)).toMatchObject({ pin_protected: 1, restriction_profile: 'little_kid' });
    expect((await select(app, kid)).json()).toMatchObject({ needPin: true });
  });

  describe('a PIN-protected profile', () => {
    it('asks for the PIN once on each device', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const member = idOf(store, 'Member');

      expect((await select(app, member)).json()).toMatchObject({ error: 'PIN required', needPin: true });
      expect((await select(app, member, { pin: '9999' })).json()).toMatchObject({ error: 'Wrong PIN, try again' });
      const phone = await select(app, member, { pin: '1234' });
      expect(phone.statusCode).toBe(200);
      expect((await select(app, member, { cookie: cookiesOf(phone) })).statusCode).toBe(200);

      // The profile is linked now, but another device still needs the PIN.
      const tablet = await select(app, member);
      expect(tablet.statusCode).toBe(403);
      expect(tablet.json()).toMatchObject({ needPin: true });
      expect((await select(app, member, { pin: '1234' })).statusCode).toBe(200);
    });

    it('tells each device which profiles still need their PIN', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const locked = async (cookie = '') =>
        ((await app.inject({ method: 'GET', url: '/api/profiles', headers: { cookie } })).json() as { name: string; locked: boolean }[]).map(
          (p) => [p.name, p.locked],
        );
      expect(await locked()).toEqual([
        ['Owner', false],
        ['Kid', false],
        ['Member', true],
      ]);
      const phone = cookiesOf(await select(app, idOf(store, 'Member'), { pin: '1234' }));
      expect(await locked(phone)).toEqual([
        ['Owner', false],
        ['Kid', false],
        ['Member', false],
      ]);
    });

    it("checks the owner's PIN too, unless the owner signed in to settings on that device", async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      store.db.prepare('UPDATE profiles SET pin_protected = 1 WHERE plex_user_id = ?').run(OWNER);
      pins[OWNER] = '0000';
      const owner = idOf(store, 'Owner');

      expect((await select(app, owner)).json()).toMatchObject({ needPin: true });
      expect((await select(app, owner, { pin: '0000' })).statusCode).toBe(200);
      const signedIn = `curatorr_admin=${encodeURIComponent(app.signCookie(`${OWNER}.${Date.now()}`))}`;
      expect((await select(app, owner, { cookie: signedIn })).statusCode).toBe(200);
    });

    it("asks for each protected member's PIN once when watching together", async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const [owner, member] = [idOf(store, 'Owner'), idOf(store, 'Member')];
      const together = (payload: object, cookie = '') =>
        app.inject({ method: 'POST', url: '/api/profiles/together', headers: { cookie }, payload });

      expect((await together({ ids: [owner, member] })).json()).toMatchObject({ needPin: true, profileId: member });
      const wrong = await together({ ids: [owner, member], pin: { id: member, pin: '9999' } });
      expect(wrong.json()).toMatchObject({ error: 'Wrong PIN, try again', needPin: true, profileId: member });
      const phone = await together({ ids: [owner, member], pin: { id: member, pin: '1234' } });
      expect(phone.statusCode).toBe(200);
      const status = (await app.inject({ method: 'GET', url: '/api/status', headers: { cookie: cookiesOf(phone) } })).json();
      expect(status.profile).toMatchObject({ name: 'Owner' });
      expect(status.together.map((p: { name: string }) => p.name)).toEqual(['Member']);
      // Remembered on this device, as for picking the profile alone.
      expect((await together({ ids: [owner, member] }, cookiesOf(phone))).statusCode).toBe(200);
    });

    it('asks again on a device that picked the profile before it had a PIN', async () => {
      const { app, store, library } = await plexInstance();
      await importHomeUsers(store, silent);
      const kid = idOf(store, 'Kid');
      const tablet = cookiesOf(await select(app, kid));
      const wizard = () => app.inject({ method: 'GET', url: '/api/wizard/genre', headers: { cookie: tablet } });
      expect((await wizard()).statusCode).toBe(200);

      kidInPlex = { protected: true };
      pins[KID] = '4321';
      await library.run();
      expect((await wizard()).json()).toMatchObject({ needProfile: true });
      const unlocked = await select(app, kid, { pin: '4321', cookie: tablet });
      expect(unlocked.statusCode).toBe(200);
      const both = [tablet, cookiesOf(unlocked)].filter(Boolean).join('; ');
      expect((await app.inject({ method: 'GET', url: '/api/wizard/genre', headers: { cookie: both } })).statusCode).toBe(200);
    });

    it('pauses PIN entry after five wrong tries in a row, without asking plex.tv', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const member = idOf(store, 'Member');

      // Wrong tries before a right one don't count against the next ones.
      for (let i = 0; i < 4; i++) await select(app, member, { pin: '0000' });
      expect((await select(app, member, { pin: '1234' })).statusCode).toBe(200);

      for (let i = 0; i < 5; i++) expect((await select(app, member, { pin: '0000' })).statusCode).toBe(403);
      const asked = switches;
      const paused = await select(app, member, { pin: '1234' });
      expect(paused.statusCode).toBe(429);
      expect(paused.json()).toMatchObject({ error: 'Too many wrong PINs. Try again in 10 minutes', needPin: true });
      expect(switches).toBe(asked);
      // Other profiles aren't affected.
      store.db.prepare('UPDATE profiles SET pin_protected = 1 WHERE plex_user_id = ?').run(KID);
      pins[KID] = '4321';
      expect((await select(app, idOf(store, 'Kid'), { pin: '4321' })).statusCode).toBe(200);
      expect(switches).toBe(asked + 1);
    });
  });
});
