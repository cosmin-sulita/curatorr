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
import { importHomeUsers } from './profiles.js';

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
            { id: KID, title: 'Kid' },
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
    store.update('plex', { adminToken: 'owner-token', ownerId: OWNER, ownerName: 'Owner', machineId: 'machine', serverUrl: base });
    return { app, store };
  }

  const names = (store: Store) => store.profileRows(true).map((p) => p.name);
  const idOf = (store: Store, name: string) => store.profileRows(true).find((p) => p.name === name)!.id;

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

  describe('a PIN-protected profile', () => {
    const select = (app: App, id: number, { pin, cookie = '' }: { pin?: string; cookie?: string } = {}) =>
      app.inject({ method: 'POST', url: `/api/profiles/${id}/select`, headers: { cookie }, payload: pin ? { pin } : {} });
    /** The cookies a response set, as a Cookie header. */
    const cookiesOf = (res: LightMyRequestResponse) =>
      [res.headers['set-cookie'] ?? []].flat().map((c) => String(c).split(';')[0]).join('; ');

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
