import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Profile, RecommendationsResponse } from '@curatorr/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { RadarrMovie } from '../integrations/radarr.js';
import type { Store } from '../store.js';
import { syncJellyfinState } from './jellyfin.js';

const PUBLIC_URL = 'https://media.example.com';
const SERVER_ID = 'server-1';
const DAD = '1'.repeat(32);
const KID = '2'.repeat(32);
const RETIRED = '3'.repeat(32);
const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

interface FakeUser {
  id: string;
  name: string;
  password: string;
  admin: boolean;
  disabled?: boolean;
  maxParentalRating?: number;
  imageTag?: string;
  /** The libraries the user may open. */
  libraries: string[];
}

const DAD_USER: FakeUser = { id: DAD, name: 'Dad', password: 'dad-pass', admin: true, imageTag: 'dadtag', libraries: ['lib-movies', 'lib-kids'] };
const KID_USER: FakeUser = { id: KID, name: 'Kid', password: 'kid-pass', admin: false, maxParentalRating: 10, libraries: ['lib-kids'] };
const RETIRED_USER: FakeUser = { id: RETIRED, name: 'Retired', password: 'x', admin: false, disabled: true, libraries: [] };

const radarrMovies: RadarrMovie[] = [
  { id: 1, title: 'The Matrix', tmdbId: 603, certification: 'R', hasFile: true, genres: ['Action'], ratings: { rottenTomatoes: { value: 83 } } },
  { id: 2, title: 'Heat', tmdbId: 949, certification: 'R', hasFile: true, genres: ['Crime'], ratings: { rottenTomatoes: { value: 88 } } },
  { id: 3, title: 'Paddington 2', tmdbId: 346648, certification: 'PG', hasFile: true, genres: ['Family'], ratings: { rottenTomatoes: { value: 99 } } },
  { id: 4, title: 'Alien', tmdbId: 348, imdbId: 'tt0078748', certification: 'R', hasFile: true, genres: ['Horror'] },
  { id: 5, title: 'Not in Jellyfin', tmdbId: 999, certification: 'PG-13', hasFile: true, genres: ['Drama'] },
  { id: 6, title: 'Finding Nemo', tmdbId: 12, certification: 'G', hasFile: true, genres: ['Family'] },
];

/** Jellyfin's movies, by library. Alien was matched by its IMDb id only. */
const items = [
  { Id: 'jf-matrix', Name: 'The Matrix', library: 'lib-movies', ProviderIds: { Tmdb: '603' } },
  { Id: 'jf-heat', Name: 'Heat', library: 'lib-movies', ProviderIds: { Tmdb: '949', Imdb: 'tt0113277' } },
  { Id: 'jf-paddington', Name: 'Paddington 2', library: 'lib-kids', ProviderIds: { Tmdb: '346648' } },
  { Id: 'jf-alien', Name: 'Alien', library: 'lib-movies', ProviderIds: { Imdb: 'tt0078748' } },
  { Id: 'jf-nemo', Name: 'Finding Nemo', library: 'lib-movies', ProviderIds: { Tmdb: '12' } },
];

interface Mark {
  route: string;
  method: string;
  item: string;
  user: string | null;
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });

const camelize = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(camelize)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k[0]!.toLowerCase() + k.slice(1), camelize(x)]))
      : v;

/** A Jellyfin 12 server (and a Radarr) at one address. */
function fakeJellyfin() {
  const state = {
    users: [DAD_USER, KID_USER, RETIRED_USER],
    /** Each user's marks: played (and when) and favourites. */
    userData: {} as Record<string, Record<string, { Played?: boolean; LastPlayedDate?: string; IsFavorite?: boolean }>>,
    /** Signed-in sessions: token → user and device. Jellyfin keeps one per device and user. */
    tokens: new Map<string, { user: string; device: string }>(),
    marks: [] as Mark[],
    logouts: [] as { token: string; device: string }[],
    signIns: 0,
    version: '12.0.1',
    usersStatus: 200,
    /** What sign-ins answer while Jellyfin isn't answering them normally. */
    authStatus: 200,
    /**
     * Jellyfin's lockout, as 12.2 does it: a user's "maximum login attempts before lockout" (-1, never, unless
     * set), their wrong passwords since the last right one, and the users it disabled for it.
     */
    lockoutAfter: {} as Record<string, number>,
    wrongPasswords: {} as Record<string, number>,
    lockedOut: new Set<string>(),
    /** When each user last signed in, in Jellyfin's seven-decimal dates. */
    lastLogin: {} as Record<string, string>,
    /** Users whose details leave out the lockout policy and the last sign-in. */
    bare: new Set<string>(),
  };
  const reset = () => {
    state.users = [DAD_USER, KID_USER, RETIRED_USER];
    state.userData = {
      [DAD]: { 'jf-heat': { Played: true, LastPlayedDate: '2026-09-01T20:00:00.0000000Z' }, 'jf-matrix': { IsFavorite: true } },
    };
    state.marks.length = 0;
    state.version = '12.0.1';
    state.usersStatus = 200;
    state.authStatus = 200;
    state.lockoutAfter = {};
    state.wrongPasswords = {};
    state.lockedOut.clear();
    state.bare.clear();
  };
  reset();
  /** Sign-ins get later dates even within one millisecond. */
  let lastStamp = 0;
  const stamp = () => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp).toISOString().replace('Z', '0000Z');
  };

  const dto = (u: FakeUser) => {
    const bare = state.bare.has(u.id);
    return {
      Id: u.id,
      Name: u.name,
      PrimaryImageTag: u.imageTag,
      ...(bare ? {} : { LastLoginDate: state.lastLogin[u.id] }),
      Policy: {
        IsAdministrator: u.admin,
        IsDisabled: Boolean(u.disabled) || state.lockedOut.has(u.id),
        MaxParentalRating: u.maxParentalRating,
        ...(bare
          ? {}
          : { LoginAttemptsBeforeLockout: state.lockoutAfter[u.id] ?? -1, InvalidLoginAttemptCount: state.wrongPasswords[u.id] ?? 0 }),
      },
    };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/v3/movie') return json(200, radarrMovies);
    if (url.pathname.startsWith('/api/v3/')) return json(404, {});

    // Jellyfin picks its JSON casing from the Accept header, and 12.2 answers in camelCase without one.
    // Curatorr asks for PascalCase by name; anything else gets camelCase here.
    const pascal = /profile="PascalCase"/.test(String(req.headers.accept ?? ''));
    const jf = (status: number, body: unknown) => json(status, pascal ? body : camelize(body));

    // Jellyfin 12 only reads the standard header.
    if (req.headers['x-emby-token'] || req.headers['x-emby-authorization'] || url.searchParams.has('api_key')) return jf(401, {});
    const auth = String(req.headers.authorization ?? '');
    if (!auth.startsWith('MediaBrowser ')) return jf(401, {});
    const field = (name: string) => decodeURIComponent(new RegExp(`${name}="([^"]*)"`).exec(auth)?.[1] ?? '');

    if (url.pathname === '/System/Info/Public') return jf(200, { Id: SERVER_ID, ServerName: 'Home', Version: state.version });
    if (url.pathname === '/Users/AuthenticateByName' && req.method === 'POST') {
      state.signIns++;
      if (state.authStatus !== 200) return jf(state.authStatus, {});
      const body = JSON.parse(await readBody(req));
      const named = state.users.find((u) => u.name === body.Username);
      // A disabled account is turned down even with the right password.
      if (named && (named.disabled || state.lockedOut.has(named.id))) return jf(403, {});
      if (!named || named.password !== body.Pw) {
        if (named) {
          const wrong = (state.wrongPasswords[named.id] = (state.wrongPasswords[named.id] ?? 0) + 1);
          const limit = state.lockoutAfter[named.id] ?? -1;
          if (limit > 0 && wrong >= limit) state.lockedOut.add(named.id);
        }
        return jf(401, {});
      }
      const user = named;
      state.wrongPasswords[user.id] = 0;
      state.lastLogin[user.id] = stamp();
      for (const [token, session] of state.tokens) {
        if (session.device === field('DeviceId') && session.user === user.id) state.tokens.delete(token);
      }
      const token = `token-${state.signIns}`;
      state.tokens.set(token, { user: user.id, device: field('DeviceId') });
      return jf(200, { AccessToken: token, User: dto(user), ServerId: SERVER_ID });
    }
    if (url.pathname === '/UserImage') {
      const user = state.users.find((u) => u.id === url.searchParams.get('userId'));
      if (!user?.imageTag) return jf(404, {});
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end('PNG');
    }

    const session = state.tokens.get(field('Token'));
    if (!session) return jf(401, {});
    if (url.pathname === '/Sessions/Logout' && req.method === 'POST') {
      state.logouts.push({ token: field('Token'), device: session.device });
      state.tokens.delete(field('Token'));
      res.writeHead(204);
      return res.end();
    }
    if (!state.users.find((u) => u.id === session.user)?.admin) return jf(403, {});
    if (url.pathname === '/Users') return jf(state.usersStatus, state.usersStatus === 200 ? state.users.map(dto) : {});
    if (url.pathname === '/Library/VirtualFolders') {
      return jf(200, [
        { Name: 'Movies', CollectionType: 'movies', ItemId: 'lib-movies' },
        { Name: 'Kids', CollectionType: 'movies', ItemId: 'lib-kids' },
        { Name: 'Shows', CollectionType: 'tvshows', ItemId: 'lib-shows' },
        { Name: 'Home videos', ItemId: 'lib-mixed' },
      ]);
    }
    if (url.pathname === '/Items') {
      const userId = url.searchParams.get('userId');
      const viewer = state.users.find((u) => u.id === (userId ?? session.user))!;
      const parentId = url.searchParams.get('parentId');
      const visible = items.filter((i) => viewer.libraries.includes(i.library) && (!parentId || i.library === parentId));
      return jf(200, {
        Items: visible.map(({ library: _, ...i }) => ({ ...i, ...(userId ? { UserData: state.userData[userId]?.[i.Id] ?? {} } : {}) })),
        TotalRecordCount: visible.length,
      });
    }
    const mark = /^\/(UserPlayedItems|UserFavoriteItems)\/([^/]+)$/.exec(url.pathname);
    if (mark) {
      const user = url.searchParams.get('userId');
      state.marks.push({ route: mark[1]!, method: req.method!, item: mark[2]!, user });
      const data = ((state.userData[user!] ??= {})[mark[2]!] ??= {});
      if (mark[1] === 'UserPlayedItems') data.Played = req.method === 'POST';
      else data.IsFavorite = req.method === 'POST';
      return jf(200, {});
    }
    jf(404, {});
  });
  return { server, state, reset };
}

type App = Awaited<ReturnType<typeof buildApp>>['app'];

/** The cookies a response set, as a Cookie header. */
const cookiesOf = (res: LightMyRequestResponse) =>
  [res.headers['set-cookie'] ?? []].flat().map((c) => String(c).split(';')[0]).join('; ');

const fake = fakeJellyfin();
let base = '';
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  fake.server.close();
});

async function freshInstall() {
  const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-jellyfin-'));
  const built = await buildApp({ configDir: dir, demo: false, logger: false });
  cleanups.push(async () => {
    await built.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  built.ctx.store.set('radarr', { url: base, apiKey: 'radarr-key' });
  return built;
}

const post = (app: App, url: string, payload: unknown, cookie = '') =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { cookie } });

const connect = (app: App, body: Record<string, string>, cookie = '') => post(app, '/api/setup/jellyfin', body, cookie);

describe('Curatorr with Jellyfin, over the API', () => {
  let app: App;
  let store: Store;
  let library: Awaited<ReturnType<typeof buildApp>>['ctx']['library'];
  /** The administrator's cookie, from connecting Jellyfin. */
  let admin = '';
  const profiles: Record<string, string> = {};

  beforeAll(async () => {
    fake.reset();
    ({ app, ctx: { store, library } } = await freshInstall());
  });

  const profileId = (name: string) => store.profileRows(true).find((p) => p.name === name)!.id;
  const select = async (name: string) => {
    const res = await post(app, `/api/profiles/${profileId(name)}/select`, {});
    expect(res.statusCode).toBe(200);
    profiles[name] = cookiesOf(res);
  };
  const picks = async (name: string) =>
    (await app.inject({ method: 'GET', url: '/api/recommendations', headers: { cookie: profiles[name]! } })).json() as RecommendationsResponse;
  const mark = async (name: string, movieId: number, kind: string) =>
    (await post(app, '/api/feedback', { movieId, kind }, profiles[name])).json() as { id: number; server?: string };
  const undo = async (name: string, id: number) =>
    (await app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie: profiles[name]! } })).json() as {
      server?: string;
    };
  const settings = (cookie = admin) => app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });

  it('refuses a wrong password, a member who is not an administrator, and Jellyfin older than 10.9', async () => {
    const wrong = await connect(app, { url: base, username: 'Dad', password: 'nope' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toMatch(/didn't accept that username and password/);

    const member = await connect(app, { url: base, username: 'Kid', password: 'kid-pass' });
    expect(member.statusCode).toBe(403);
    expect(member.json().error).toMatch(/Kid isn't a Jellyfin administrator/);

    fake.state.version = '10.8.13';
    const old = await connect(app, { url: base, username: 'Dad', password: 'dad-pass' });
    expect(old.statusCode).toBe(400);
    expect(old.json().error).toMatch(/Jellyfin 10\.9 or later/);
    fake.state.version = '12.0.1';

    expect(store.get('jellyfin')).toBeNull();
    expect(store.mediaServer()).toBeNull();
  });

  it('connects as an administrator, keeps the token from the browser, and owns setup from then on', async () => {
    const res = await connect(app, { url: base, username: 'Dad', password: 'dad-pass', publicUrl: PUBLIC_URL });
    expect(res.statusCode).toBe(200);
    // Movie and mixed libraries, not shows.
    expect(res.json().libraries).toEqual([
      { key: 'lib-movies', title: 'Movies' },
      { key: 'lib-kids', title: 'Kids' },
      { key: 'lib-mixed', title: 'Home videos' },
    ]);
    const saved = store.get('jellyfin')!;
    expect(saved).toMatchObject({ url: base, publicUrl: PUBLIC_URL, serverId: SERVER_ID, serverName: 'Home', ownerId: DAD, ownerName: 'Dad', libraryIds: [] });
    expect(fake.state.tokens.get(saved.token)).toEqual({ user: DAD, device: saved.deviceId });
    expect(store.mediaServer()).toBe('jellyfin');
    admin = cookiesOf(res);

    expect((await settings('')).json()).toMatchObject({ needAdmin: true });
    const body = await settings();
    expect(body.statusCode).toBe(200);
    expect(body.json()).toMatchObject({ server: 'jellyfin', jellyfin: { url: base, publicUrl: PUBLIC_URL, serverName: 'Home', ownerName: 'Dad' } });
    expect(body.body).not.toContain(saved.token);
  });

  it('keeps the sign-in when the password is left empty, for the same address only', async () => {
    const { token } = store.get('jellyfin')!;
    const signIns = fake.state.signIns;
    expect((await connect(app, { url: base, publicUrl: PUBLIC_URL }, admin)).statusCode).toBe(200);
    expect(store.get('jellyfin')!.token).toBe(token);
    expect(fake.state.signIns).toBe(signIns);

    const elsewhere = await connect(app, { url: `${base}/elsewhere` }, admin);
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json().error).toMatch(/administrator's username and password/);
  });

  it('imports the users who can sign in, with their parental limits and pictures', async () => {
    expect((await post(app, '/api/setup/jellyfin/libraries', { libraryIds: ['lib-movies', 'lib-kids'] }, admin)).statusCode).toBe(200);
    expect(store.get('jellyfin')!.libraryIds).toEqual(['lib-movies', 'lib-kids']);

    const res = await post(app, '/api/setup/jellyfin/users', {}, admin);
    expect(res.statusCode).toBe(200);
    expect(res.json() as Profile[]).toEqual([
      expect.objectContaining({ name: 'Dad', isAdmin: true, restrictionProfile: null, avatarUrl: `/api/avatar/${DAD}?tag=dadtag`, linked: true }),
      expect.objectContaining({ name: 'Kid', isAdmin: false, restrictionProfile: 'older_kid', avatarUrl: null, linked: true }),
    ]);
  });

  it("reads the library and each person's history, and only offers a kid what Jellyfin lets them open", async () => {
    store.set('setupComplete', true);
    await library.run();
    expect(store.get('sync')).toMatchObject({ movies: 6, matched: 5, error: null });

    await select('Dad');
    expect(store.watchHistory(profileId('Dad'))).toEqual([{ movieId: 2, viewedAt: Date.UTC(2026, 8, 1, 20) }]);
    const dad = (await picks('Dad')).picks;
    // Heat was watched, and one movie isn't in Jellyfin.
    expect(dad.map((p) => p.movie.id).sort()).toEqual([1, 3, 4, 6]);
    const matrix = dad.find((p) => p.movie.id === 1)!;
    expect(matrix.reasons[0]).toEqual({ kind: 'watchlist', label: 'On your watchlist' });
    expect(matrix.movie.watchUrl).toBe(`${PUBLIC_URL}/web/#/details?id=jf-matrix&serverId=${SERVER_ID}`);
    expect(matrix.movie.watchAppUrl).toBeNull();

    // Finding Nemo is rated for kids, but it's in a library the kid can't open.
    await select('Kid');
    expect((await picks('Kid')).picks.map((p) => p.movie.id)).toEqual([3]);
  });

  it("shows a person's Jellyfin favourites in Settings, as their watchlist", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hidden', headers: { cookie: profiles.Dad! } });
    const listed = res.json() as { id: number | null; kind: string; movie: { id: number } }[];
    expect(listed.map((h) => [h.movie.id, h.kind, h.id])).toEqual([[1, 'later', null]]);
  });

  describe('marks', () => {
    beforeEach(() => {
      fake.state.marks.length = 0;
      store.update('app', { syncToServer: true });
    });

    it('"Seen it" marks the movie played in Jellyfin for that person, and Undo marks it unplayed', async () => {
      const { id, server } = await mark('Dad', 1, 'seen');
      expect(server).toBe('synced');
      expect(fake.state.marks).toEqual([{ route: 'UserPlayedItems', method: 'POST', item: 'jf-matrix', user: DAD }]);
      expect(store.watchedIds(profileId('Dad')).has(1)).toBe(true);

      expect((await undo('Dad', id)).server).toBe('synced');
      expect(fake.state.marks[1]).toEqual({ route: 'UserPlayedItems', method: 'DELETE', item: 'jf-matrix', user: DAD });
      expect(store.watchedIds(profileId('Dad')).has(1)).toBe(false);
    });

    it('leaves Jellyfin alone for a movie that was already played', async () => {
      const { id, server } = await mark('Dad', 2, 'seen');
      expect(server).toBe('already');
      expect((await undo('Dad', id)).server).toBe('skipped');
      expect(fake.state.marks).toEqual([]);
    });

    it('"Watchlist" adds the movie to Jellyfin favourites, and Undo takes it off', async () => {
      const { id, server } = await mark('Dad', 4, 'later');
      expect(server).toBe('synced');
      expect(fake.state.marks).toEqual([{ route: 'UserFavoriteItems', method: 'POST', item: 'jf-alien', user: DAD }]);
      expect((await picks('Dad')).picks.find((p) => p.movie.id === 4)!.reasons.map((r) => r.kind)).toContain('watchlist');

      expect((await undo('Dad', id)).server).toBe('synced');
      expect(fake.state.marks[1]).toEqual({ route: 'UserFavoriteItems', method: 'DELETE', item: 'jf-alien', user: DAD });
    });

    it('takes a movie out of Jellyfin favourites, also one made a favourite in Jellyfin', async () => {
      // The Matrix is one of Dad's favourites in Jellyfin.
      const res = await app.inject({ method: 'DELETE', url: '/api/watchlist/1', headers: { cookie: profiles.Dad! } });
      expect(res.json()).toEqual({ server: 'synced', onWatchlistOf: [] });
      expect(fake.state.marks).toEqual([{ route: 'UserFavoriteItems', method: 'DELETE', item: 'jf-matrix', user: DAD }]);
      expect(store.watchlistIds(profileId('Dad')).has(1)).toBe(false);

      expect((await mark('Dad', 1, 'later')).server).toBe('synced');
      expect(fake.state.marks[1]).toEqual({ route: 'UserFavoriteItems', method: 'POST', item: 'jf-matrix', user: DAD });
    });

    it('sends nothing to Jellyfin when the owner turned syncing off', async () => {
      store.update('app', { syncToServer: false });
      const seen = await mark('Dad', 6, 'seen');
      const later = await mark('Dad', 3, 'later');
      expect([seen.server, later.server]).toEqual(['skipped', 'skipped']);
      expect(fake.state.marks).toEqual([]);
      await undo('Dad', seen.id);
      await undo('Dad', later.id);
    });

    it('takes a movie off the watchlist in Curatorr once it is no longer a favourite in Jellyfin', async () => {
      expect((await mark('Dad', 6, 'later')).server).toBe('synced'); // Finding Nemo, a favourite in Jellyfin too
      fake.state.userData[DAD]!['jf-nemo']!.IsFavorite = false; // no longer one, in a Jellyfin app
      await syncJellyfinState(store, store.profileRow(profileId('Dad'))!, silent, true);
      const res = await app.inject({ method: 'GET', url: '/api/hidden', headers: { cookie: profiles.Dad! } });
      expect((res.json() as { movie: { id: number } }[]).map((h) => h.movie.id)).not.toContain(6);
    });
  });

  it("serves a Jellyfin user's picture from Curatorr, for known users only", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/avatar/${DAD}?tag=dadtag` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
    expect(res.body).toBe('PNG');
    expect((await app.inject({ method: 'GET', url: `/api/avatar/${'9'.repeat(32)}` })).statusCode).toBe(404);
  });

  it("lets an administrator's profile be hidden, as long as one profile stays on Who's watching", async () => {
    const hide = (name: string, hidden: boolean) =>
      app.inject({ method: 'PATCH', url: `/api/profiles/${profileId(name)}`, payload: { hidden }, headers: { cookie: admin } });
    expect((await hide('Dad', true)).statusCode).toBe(200);
    const last = await hide('Kid', true);
    expect(last.statusCode).toBe(400);
    expect(last.json().error).toMatch(/at least one profile/);
    expect((await hide('Dad', false)).statusCode).toBe(200);
  });

  it('refreshes profiles from Jellyfin, keeping who was hidden in Curatorr and dropping removed users', async () => {
    store.setProfileHidden(profileId('Kid'), true);
    const refresh = () => post(app, '/api/setup/jellyfin/users', {}, admin);

    expect((await refresh()).statusCode).toBe(200);
    expect(store.profileRow(profileId('Kid'))!.hidden).toBe(1);

    fake.state.users = [DAD_USER, RETIRED_USER];
    expect((await refresh()).statusCode).toBe(200);
    expect(store.profileRows(true).map((p) => p.name)).toEqual(['Dad']);
    fake.state.users = [DAD_USER, KID_USER, RETIRED_USER];
    await refresh();
  });

  it("changes nobody's profile when Jellyfin can't list its users", async () => {
    const before = store.profileRows(true);
    fake.state.usersStatus = 503;
    const res = await post(app, '/api/setup/jellyfin/users', {}, admin);
    expect(res.statusCode).toBe(502);
    expect(store.profileRows(true)).toEqual(before);
    fake.state.usersStatus = 200;
  });

  it("takes settings away from an administrator Jellyfin demoted, at the next library sync", async () => {
    const mum: FakeUser = { id: '4'.repeat(32), name: 'Mum', password: 'mum-pass', admin: true, libraries: ['lib-movies'] };
    fake.state.users = [DAD_USER, KID_USER, RETIRED_USER, mum];
    await post(app, '/api/setup/jellyfin/users', {}, admin);
    const signedIn = cookiesOf(await post(app, '/api/jellyfin/login', { username: 'Mum', password: 'mum-pass' }));
    expect((await settings(signedIn)).statusCode).toBe(200);

    fake.state.users = [DAD_USER, KID_USER, RETIRED_USER, { ...mum, admin: false }];
    await library.run();
    expect((await settings(signedIn)).statusCode).toBe(403);
    fake.state.users = [DAD_USER, KID_USER, RETIRED_USER];
    await library.run();
    expect(store.profileRows(true).map((p) => p.name)).toEqual(['Dad', 'Kid']);
  });

  it("lets any Jellyfin administrator sign in to settings, without replacing Curatorr's own sign-in", async () => {
    const { token, deviceId } = store.get('jellyfin')!;
    const logouts = fake.state.logouts.length;
    const res = await post(app, '/api/jellyfin/login', { username: 'Dad', password: 'dad-pass' });
    expect(res.statusCode).toBe(200);
    expect((await settings(cookiesOf(res))).statusCode).toBe(200);
    // The sign-in was only to check who it is: its session is gone, and Curatorr's token still works.
    const signedOut = fake.state.logouts.slice(logouts);
    expect(signedOut).toHaveLength(1);
    expect(signedOut[0]!.device).not.toBe(deviceId);
    expect(fake.state.tokens.get(token)).toEqual({ user: DAD, device: deviceId });

    const member = await post(app, '/api/jellyfin/login', { username: 'Kid', password: 'kid-pass' });
    expect(member.statusCode).toBe(403);
    expect(member.json().error).toBe("Kid isn't a Jellyfin administrator");
  });

  it("only asks Jellyfin about administrators' passwords, so nobody else can be locked out through Curatorr", async () => {
    const signIns = fake.state.signIns;
    for (const username of ['Kid', 'kid', 'Nobody', 'Retired']) {
      for (let i = 0; i < 3; i++) {
        const res = await post(app, '/api/jellyfin/login', { username, password: 'guess' });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toBe(`${username} isn't a Jellyfin administrator`);
      }
    }
    expect(fake.state.signIns).toBe(signIns);
  });
});

describe("Settings sign-in and Jellyfin's lockout", () => {
  afterEach(() => fake.reset());

  const STOPPED = 'Too many wrong passwords for Dad. Sign in to Jellyfin itself once, then try again here.';
  /** Curatorr connected as Dad, with everyone's profiles. */
  const connectAsDad = async (app: App) => {
    const admin = cookiesOf(await connect(app, { url: base, username: 'Dad', password: 'dad-pass' }));
    expect((await post(app, '/api/setup/jellyfin/users', {}, admin)).statusCode).toBe(200);
  };
  const login = (app: App, password: string, username = 'Dad') => post(app, '/api/jellyfin/login', { username, password });
  /** Dad signs in to Jellyfin itself, in one of its apps. */
  const signInToJellyfin = async (password = 'dad-pass') =>
    (
      await fetch(`${base}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { Authorization: 'MediaBrowser Client="App", Device="Phone", DeviceId="phone", Version="1"', 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: 'Dad', Pw: password }),
      })
    ).status;

  it("can't lock an administrator out of Jellyfin through Curatorr", async () => {
    const { app } = await freshInstall();
    await connectAsDad(app);
    fake.state.lockoutAfter[DAD] = 5;

    const signIns = fake.state.signIns;
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(await login(app, 'wrong'));
    expect(answers.map((a) => a.statusCode)).toEqual([400, 400, 429, 429, 429, 429]);
    expect(answers[2]!.json().error).toBe(STOPPED);
    expect(fake.state.signIns - signIns).toBe(2);
    expect(fake.state.lockedOut.has(DAD)).toBe(false);

    // Even the right password waits until Dad has signed in to Jellyfin itself.
    expect((await login(app, 'dad-pass')).json().error).toBe(STOPPED);
    expect(await signInToJellyfin()).toBe(200);
    expect((await login(app, 'dad-pass')).statusCode).toBe(200);
  });

  it('remembers the wrong passwords after a restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-jellyfin-'));
    const first = await buildApp({ configDir: dir, demo: false, logger: false });
    await connectAsDad(first.app);
    for (let i = 0; i < 2; i++) expect((await login(first.app, 'wrong')).statusCode).toBe(400);
    await first.app.close();

    const second = await buildApp({ configDir: dir, demo: false, logger: false });
    cleanups.push(async () => {
      await second.app.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const signIns = fake.state.signIns;
    expect((await login(second.app, 'dad-pass')).json().error).toBe(STOPPED);
    expect(fake.state.signIns).toBe(signIns);
  });

  it('sends no password for an account Jellyfin locks after one or two wrong ones', async () => {
    const { app } = await freshInstall();
    await connectAsDad(app);
    for (const limit of [1, 2]) {
      fake.state.lockoutAfter[DAD] = limit;
      const signIns = fake.state.signIns;
      expect((await login(app, 'wrong')).json().error).toBe(STOPPED);
      expect(fake.state.signIns).toBe(signIns);
    }
    expect(fake.state.lockedOut.has(DAD)).toBe(false);
  });

  it('allows one wrong password for an account Jellyfin locks after three, which is what it stores for 0', async () => {
    for (const limit of [3, 0]) {
      const { app } = await freshInstall();
      await connectAsDad(app);
      fake.state.lockoutAfter[DAD] = limit;
      expect((await login(app, 'wrong')).statusCode).toBe(400);
      expect((await login(app, 'wrong')).json().error).toBe(STOPPED);
    }
  });

  it('counts the wrong passwords Jellyfin saw in its own apps, when it locks accounts', async () => {
    const { app } = await freshInstall();
    await connectAsDad(app);
    fake.state.lockoutAfter[DAD] = 5;
    expect(await signInToJellyfin('typo')).toBe(401);
    expect((await login(app, 'wrong')).statusCode).toBe(400);
    expect((await login(app, 'wrong')).json().error).toBe(STOPPED);
  });

  it("allows two wrong passwords when Jellyfin doesn't say how it locks accounts or when Dad last signed in", async () => {
    const { app } = await freshInstall();
    await connectAsDad(app);
    fake.state.bare.add(DAD);
    expect((await login(app, 'wrong')).statusCode).toBe(400);
    expect((await login(app, 'wrong')).statusCode).toBe(400);
    expect((await login(app, 'wrong')).json().error).toBe(STOPPED);
    // Without a last sign-in to go by, Curatorr can't see Dad sign in to Jellyfin.
    expect(await signInToJellyfin()).toBe(200);
    expect((await login(app, 'dad-pass')).json().error).toBe(STOPPED);
  });

  it("doesn't count a sign-in Jellyfin didn't answer", async () => {
    const { app } = await freshInstall();
    await connectAsDad(app);
    fake.state.authStatus = 503;
    for (let i = 0; i < 3; i++) expect((await login(app, 'wrong')).statusCode).toBe(502);
    fake.state.authStatus = 200;
    expect((await login(app, 'wrong')).statusCode).toBe(400);
    expect((await login(app, 'wrong')).statusCode).toBe(400);
    expect((await login(app, 'wrong')).statusCode).toBe(429);
  });

  it('sends no password for an account Jellyfin has disabled', async () => {
    const mum: FakeUser = { id: '4'.repeat(32), name: 'Mum', password: 'mum-pass', admin: true, libraries: ['lib-movies'] };
    fake.state.users = [DAD_USER, KID_USER, RETIRED_USER, mum];
    const { app } = await freshInstall();
    await connectAsDad(app);
    fake.state.lockedOut.add(mum.id);

    const signIns = fake.state.signIns;
    const res = await login(app, 'mum-pass', 'Mum');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Jellyfin has disabled Mum's account. Another administrator can turn it back on in Jellyfin.");
    expect(fake.state.signIns).toBe(signIns);
  });

  it('counts wrong passwords sent all at once before Jellyfin answers, so a burst gets no further than two', async () => {
    const { app } = await freshInstall();
    await connectAsDad(app);

    const signIns = fake.state.signIns;
    const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => login(app, `wrong-${i}`)));
    expect(fake.state.signIns - signIns).toBe(2);
    expect(answers.filter((a) => a.statusCode === 429)).toHaveLength(8);
    expect((await login(app, 'dad-pass')).statusCode).toBe(429);
  });
});

describe('one media server at a time', () => {
  afterEach(() => fake.reset());

  const plexOwner = (app: App) => `curatorr_admin=${encodeURIComponent(app.signCookie(`5001.${Date.now()}`))}`;

  it('turns down Jellyfin once Curatorr is set up with Plex', async () => {
    const { app, ctx } = await freshInstall();
    ctx.store.update('plex', { adminToken: 'owner-token', ownerId: 5001, ownerName: 'Owner', machineId: 'm', serverUrl: 'http://127.0.0.1:9' });
    ctx.store.set('setupComplete', true);
    const res = await connect(app, { url: base, username: 'Dad', password: 'dad-pass' }, plexOwner(app));
    expect(res.statusCode).toBe(409);
    expect(ctx.store.get('jellyfin')).toBeNull();
  });

  it('lets Plex go when Jellyfin is connected while setting up', async () => {
    const { app, ctx } = await freshInstall();
    ctx.store.update('plex', { adminToken: 'owner-token', ownerId: 5001, ownerName: 'Owner' });
    const plex = plexOwner(app);
    const res = await connect(app, { url: base, username: 'Dad', password: 'dad-pass' }, plex);
    expect(res.statusCode).toBe(200);
    expect(ctx.store.get('plex')).toMatchObject({ adminToken: null, ownerId: null });
    expect(ctx.store.mediaServer()).toBe('jellyfin');
    // Settings now belong to Jellyfin's administrators.
    const settings = (cookie: string) => app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect((await settings(cookiesOf(res))).statusCode).toBe(200);
    expect((await settings(plex)).statusCode).toBe(403);
  });

  it('skips the media server step by letting both go', async () => {
    const { app, ctx } = await freshInstall();
    const res = await connect(app, { url: base, username: 'Dad', password: 'dad-pass' });
    expect((await post(app, '/api/setup/server/skip', {}, cookiesOf(res))).statusCode).toBe(200);
    expect(ctx.store.get('jellyfin')).toBeNull();
    expect(ctx.store.mediaServer()).toBeNull();
  });
});
