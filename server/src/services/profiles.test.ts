import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { PLEX_HOSTS } from '../integrations/plex.js';
import type { RadarrMovie } from '../integrations/radarr.js';
import { togetherUntil } from '../session.js';
import type { Store } from '../store.js';
import { syncServerState } from './mediaServer.js';
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
  /** What plex.tv answers when asked to switch users, when it isn't answering normally. */
  let switchStatus = 200;
  /** Plex Home PINs, by user id; the Member's profile is protected. */
  let pins: Record<number, string> = {};
  /** User switches asked of plex.tv, each one checking a PIN when the user has one. */
  let switches = 0;
  /** Server tokens the Plex server no longer accepts. */
  const revoked = new Set<string>();
  /** What Plex Home says about the Kid; changed in Plex after setup by some tests. */
  let kidInPlex: Record<string, unknown> = {};
  /** The movies in Radarr and in the Plex library, and the Plex guid ids on everyone's Watchlist. None by default. */
  let inRadarr: RadarrMovie[] = [];
  let inPlex: object[] = [];
  let onWatchlist: string[] = [];
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
        if (switchStatus !== 200) return json(switchStatus, {});
        const pin = pins[Number(switched[1])];
        if (pin && url.searchParams.get('pin') !== pin) return json(401, {});
        return json(200, { authToken: `user-${switched[1]}` });
      }
      // Plex Discover and the Plex Media Server, read when a profile is picked.
      if (url.pathname === '/library/sections/watchlist/all') {
        const Metadata = onWatchlist.map((id) => ({ guid: `plex://movie/${id}` }));
        return json(200, { MediaContainer: { totalSize: Metadata.length, size: Metadata.length, Metadata } });
      }
      // Radarr, for a library sync.
      if (url.pathname === '/api/v3/movie') return json(200, inRadarr);
      if (url.pathname === '/api/v3/collection') return json(200, []);
      if (url.pathname === '/library/sections/1/all') {
        const token = req.headers['x-plex-token'] as string;
        return revoked.has(token) ? json(401, {}) : json(200, { MediaContainer: { Metadata: inPlex } });
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
    switchStatus = 200;
    pins = { [MEMBER]: '1234' };
    revoked.clear();
    kidInPlex = {};
    inRadarr = [];
    inPlex = [];
    onWatchlist = [];
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
  /** A device's cookies after a response: what it set, over what the device had. */
  const jar = (res: LightMyRequestResponse, before = '') => {
    const split = (pair: string) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)] as const;
    const cookies = new Map(before ? before.split('; ').map(split) : []);
    for (const c of [res.headers['set-cookie'] ?? []].flat()) {
      const [name, value] = split(String(c).split(';')[0]!);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  };
  const signedInAsOwner = (app: App) => `curatorr_admin=${encodeURIComponent(app.signCookie(`${OWNER}.${Date.now()}`))}`;

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

  it('reads the history and Watchlist of a profile picked before the first library sync, once the library is in', async () => {
    const { app, store, library } = await plexInstance();
    await importHomeUsers(store, silent);
    // In Radarr and Plex already, but the first library sync hasn't stored them yet.
    inRadarr = [
      { id: 1, title: 'The Matrix', tmdbId: 603, hasFile: true, genres: ['Action'] },
      { id: 2, title: 'Heat', tmdbId: 949, hasFile: true, genres: ['Crime'] },
    ];
    inPlex = [
      { ratingKey: '101', title: 'The Matrix', guid: 'plex://movie/aaa111', Guid: [{ id: 'tmdb://603' }] },
      { ratingKey: '102', title: 'Heat', guid: 'plex://movie/bbb222', Guid: [{ id: 'tmdb://949' }], viewCount: 1 },
    ];
    onWatchlist = ['aaa111'];
    const owner = idOf(store, 'Owner');
    expect((await select(app, owner)).statusCode).toBe(200);

    await library.run();
    await syncServerState(store, store.profileRow(owner)!, silent); // as the app's next status call does
    expect([...store.watchedIds(owner)]).toEqual([2]);
    expect([...store.watchlistIds(owner)]).toEqual([1]);
  });

  it('gives a user with custom Plex restrictions the strictest limit, since Curatorr can\'t read them', async () => {
    const { store } = await plexInstance();
    kidInPlex = { restricted: true, restrictionProfile: '' };
    await importHomeUsers(store, silent);
    expect(store.profileRow(idOf(store, 'Kid'))!.restriction_profile).toBe('little_kid');
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

    it('counts wrong PINs sent all at once, so a burst gets no further than five', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const member = idOf(store, 'Member');

      const asked = switches;
      const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => select(app, member, { pin: `000${i}` })));
      expect(switches - asked).toBe(5);
      expect(answers.filter((a) => a.statusCode === 429)).toHaveLength(5);
      expect((await select(app, member, { pin: '1234' })).statusCode).toBe(429);
    });

    it('asks for the PIN again once the device has moved to another profile', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const [member, kid] = [idOf(store, 'Member'), idOf(store, 'Kid')];

      let tablet = jar(await select(app, member, { pin: '1234' }));
      expect((await select(app, member, { cookie: tablet })).statusCode).toBe(200);
      // A shared tablet, handed to the kid.
      tablet = jar(await select(app, kid, { cookie: tablet }), tablet);
      const again = await select(app, member, { cookie: tablet });
      expect(again.statusCode).toBe(403);
      expect(again.json()).toMatchObject({ needPin: true, profileId: member });
    });

    it("keeps a member unlocked for watching together only until the group's evening is over", async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const [owner, member] = [idOf(store, 'Owner'), idOf(store, 'Member')];
      const ends = togetherUntil(Date.now());
      const phone = jar(
        await app.inject({
          method: 'POST',
          url: '/api/profiles/together',
          payload: { ids: [owner, member], pin: { id: member, pin: '1234' } },
        }),
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(ends - 60_000);
        expect((await select(app, member, { cookie: phone })).statusCode).toBe(200);
        vi.setSystemTime(ends + 60_000);
        expect((await select(app, member, { cookie: phone })).json()).toMatchObject({ needPin: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the PINs entered so far while the next member of a group asks for theirs', async () => {
      const { app, store } = await plexInstance();
      kidInPlex = { protected: true };
      pins[KID] = '4321';
      await importHomeUsers(store, silent);
      const [owner, member, kid] = [idOf(store, 'Owner'), idOf(store, 'Member'), idOf(store, 'Kid')];
      const together = (pin: { id: number; pin: string }, cookie = '') =>
        app.inject({ method: 'POST', url: '/api/profiles/together', headers: { cookie }, payload: { ids: [owner, member, kid], pin } });

      const first = await together({ id: member, pin: '1234' });
      expect(first.json()).toMatchObject({ needPin: true, profileId: kid });
      const second = await together({ id: kid, pin: '4321' }, jar(first));
      expect(second.statusCode).toBe(200);
      const status = await app.inject({ method: 'GET', url: '/api/status', headers: { cookie: jar(second, jar(first)) } });
      expect(status.json().together.map((p: { name: string }) => p.name)).toEqual(['Member', 'Kid']);
    });

    it('opens a profile unlocked before this version until the device picks another one', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const [member, kid] = [idOf(store, 'Member'), idOf(store, 'Kid')];
      // Linked on another device.
      expect((await select(app, member, { pin: '1234' })).statusCode).toBe(200);

      let tablet = `curatorr_unlocked=${encodeURIComponent(app.signCookie(String(member)))}`;
      const first = await select(app, member, { cookie: tablet });
      expect(first.statusCode).toBe(200);
      tablet = jar(first, tablet);
      expect((await select(app, member, { cookie: tablet })).statusCode).toBe(200);
      tablet = jar(await select(app, kid, { cookie: tablet }), tablet);
      expect((await select(app, member, { cookie: tablet })).json()).toMatchObject({ needPin: true });
    });

    it('signs out every other device, which asks for PINs again, and keeps this one signed in', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const member = idOf(store, 'Member');
      const settings = (cookie: string) => app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
      // Signed in to settings, and with the member's PIN entered, on two devices.
      const phone = jar(await select(app, member, { pin: '1234', cookie: signedInAsOwner(app) }), signedInAsOwner(app));
      const tablet = jar(await select(app, member, { pin: '1234', cookie: signedInAsOwner(app) }), signedInAsOwner(app));
      expect((await settings(tablet)).statusCode).toBe(200);

      const out = await app.inject({ method: 'POST', url: '/api/settings/sign-out-everywhere', headers: { cookie: phone }, payload: {} });
      expect(out.statusCode).toBe(200);
      expect((await settings(tablet)).json()).toMatchObject({ needAdmin: true });
      expect((await select(app, member, { cookie: tablet })).json()).toMatchObject({ needPin: true });
      const phoneNow = jar(out, phone);
      expect((await settings(phoneNow)).statusCode).toBe(200);
      expect((await select(app, member, { cookie: phoneNow })).statusCode).toBe(200);
    });

    it('leaves PINs of Plex profiles to Plex', async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const res = await app.inject({
        method: 'PUT',
        url: `/api/profiles/${idOf(store, 'Kid')}/pin`,
        headers: { cookie: signedInAsOwner(app) },
        payload: { pin: '2468' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Plex profiles use the PIN set in Plex');
    });

    it("doesn't count PINs that plex.tv couldn't check", async () => {
      const { app, store } = await plexInstance();
      await importHomeUsers(store, silent);
      const member = idOf(store, 'Member');

      switchStatus = 503;
      for (let i = 0; i < 6; i++) expect((await select(app, member, { pin: '0000' })).statusCode).toBe(502);
      switchStatus = 200;
      expect((await select(app, member, { pin: '1234' })).statusCode).toBe(200);
    });
  });
});
