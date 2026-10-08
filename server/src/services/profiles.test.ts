import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { PLEX_HOSTS } from '../integrations/plex.js';
import type { Store } from '../store.js';
import { importHomeUsers } from './profiles.js';

const OWNER = 5001;
const MEMBER = 5002;
const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe('Plex Home profiles', () => {
  let server: Server;
  let base: string;
  const originalTv = PLEX_HOSTS.tv;
  /** What plex.tv answers for the Home user list. */
  let homeUsersStatus = 200;
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
            { id: MEMBER, title: 'Member' },
          ],
        });
      }
      if (url.pathname === '/api/v2/resources') {
        const token = req.headers['x-plex-token'];
        return json(200, [{ provides: 'server', clientIdentifier: 'machine', owned: true, accessToken: `${token}-server` }]);
      }
      const switched = /^\/api\/home\/users\/(\d+)\/switch$/.exec(url.pathname);
      if (switched) return json(200, { authToken: `user-${switched[1]}` });
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    PLEX_HOSTS.tv = base;
  });

  afterEach(async () => {
    homeUsersStatus = 200;
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  afterAll(() => {
    PLEX_HOSTS.tv = originalTv;
    server.close();
  });

  /** A Curatorr signed in to Plex as the owner, with no profiles yet. */
  async function plexInstance() {
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

  it('imports the owner and the Home users, linking the ones without a PIN', async () => {
    const { store } = await plexInstance();
    await importHomeUsers(store, silent);
    expect(names(store)).toEqual(['Owner', 'Member']);
    expect(store.profileRows(true).every((p) => p.server_token)).toBe(true);
  });

  it("keeps everyone's profiles and marks when a refresh can't read Plex Home", async () => {
    const { store } = await plexInstance();
    await importHomeUsers(store, silent);
    const member = store.profileRows(true).find((p) => p.name === 'Member')!.id;
    store.addFeedback(member, 1, 'never');

    homeUsersStatus = 503;
    await expect(importHomeUsers(store, silent)).rejects.toThrow(/Plex: HTTP 503/);
    expect(names(store)).toEqual(['Owner', 'Member']);
    expect(store.feedback(member)).toHaveLength(1);
  });

  it('still sets up the owner when the first import cannot read Plex Home', async () => {
    const { store } = await plexInstance();
    homeUsersStatus = 503;
    await importHomeUsers(store, silent);
    expect(names(store)).toEqual(['Owner']);
  });
});
