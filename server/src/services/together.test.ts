import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { fromRadarr } from '../integrations/radarr.js';
import { PLEX_HOSTS } from '../integrations/plex.js';
import { Store } from '../store.js';
import { settleTogether } from './together.js';

const HOUR = 60 * 60 * 1000;
const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe('marking a movie watched for everyone who watched it together', () => {
  let server: Server;
  let base: string;
  const original = { ...PLEX_HOSTS };
  /** When each account watched The Matrix, in Plex's seconds; none means not watched. */
  let viewedAt: Record<string, number> = {};
  /** The accounts Curatorr marked it watched for. */
  let scrobbled: string[] = [];
  const cleanups: (() => void)[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const token = String(req.headers['x-plex-token'] ?? url.searchParams.get('X-Plex-Token'));
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/library/sections/1/all') {
        const seen = viewedAt[token];
        return json(200, {
          MediaContainer: {
            Metadata: [
              {
                ratingKey: '101',
                title: 'The Matrix',
                Guid: [{ id: 'tmdb://603' }],
                ...(seen ? { viewCount: 1, lastViewedAt: seen } : {}),
              },
            ],
          },
        });
      }
      if (url.pathname === '/:/scrobble') {
        scrobbled.push(token);
        return json(200, {});
      }
      if (url.pathname === '/library/sections/watchlist/all') return json(200, { MediaContainer: { totalSize: 0 } });
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    PLEX_HOSTS.discover = base;
  });

  afterEach(() => {
    viewedAt = {};
    scrobbled = [];
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  afterAll(() => {
    Object.assign(PLEX_HOSTS, original);
    server.close();
  });

  /** Alex and Sam, on Plex, who picked The Matrix together `ago` before `now`. */
  function pickedTogether() {
    const dir = mkdtempSync(path.join(tmpdir(), 'curatorr-together-'));
    const store = new Store(openDb(dir));
    cleanups.push(() => {
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    store.update('plex', { adminToken: 'owner-token', machineId: 'machine', serverUrl: base, sectionIds: ['1'] });
    const matrix = { ...fromRadarr({ id: 1, title: 'The Matrix', tmdbId: 603, hasFile: true }), plexRatingKey: '101', plexGuid: 'g' };
    store.replaceMovies([matrix], Date.now());
    const [alex, sam] = ['Alex', 'Sam'].map((name) => {
      const id = store.createLocalProfile(name, false);
      store.setProfileTokens(id, `${name.toLowerCase()}-user`, `${name.toLowerCase()}-token`);
      return id;
    }) as [number, number];
    const startedAt = Date.now() - 3 * HOUR;
    store.recordTogether(matrix.id, [alex, sam], startedAt);
    const seenBy = (id: number) => store.feedback(id).filter((e) => e.kind === 'seen').map((e) => e.movieId);
    return { store, alex, sam, startedAt, seenBy };
  }
  const plexSeconds = (ms: number) => Math.floor(ms / 1000);

  it("marks it watched for the others once someone's account shows it", async () => {
    const { store, sam, startedAt, seenBy } = pickedTogether();
    viewedAt = { 'alex-token': plexSeconds(startedAt + 2 * HOUR) };
    await settleTogether(store, silent);
    expect(seenBy(sam)).toEqual([1]);
    expect(scrobbled).toEqual(['sam-token']);
    expect(store.pendingTogether()).toEqual([]);
  });

  it("doesn't count a watch from before the pick", async () => {
    const { store, sam, startedAt, seenBy } = pickedTogether();
    viewedAt = { 'alex-token': plexSeconds(startedAt - 24 * HOUR) };
    await settleTogether(store, silent);
    expect(seenBy(sam)).toEqual([]);
    expect(store.pendingTogether()).toHaveLength(1);
  });

  it('gives up twelve hours after the pick', async () => {
    const { store, alex, sam, startedAt, seenBy } = pickedTogether();
    await settleTogether(store, silent, startedAt + 13 * HOUR);
    expect(store.pendingTogether()).toEqual([]);
    expect([seenBy(alex), seenBy(sam)]).toEqual([[], []]);
  });

  it('leaves alone whoever had it watched already', async () => {
    const { store, alex, sam, startedAt, seenBy } = pickedTogether();
    viewedAt = { 'alex-token': plexSeconds(startedAt + HOUR), 'sam-token': plexSeconds(startedAt - 48 * HOUR) };
    await settleTogether(store, silent);
    expect([seenBy(alex), seenBy(sam)]).toEqual([[], []]);
    expect(scrobbled).toEqual([]);
  });

  it("only marks it in Curatorr when it mustn't update Plex", async () => {
    const { store, alex, sam, startedAt, seenBy } = pickedTogether();
    store.update('app', { syncToServer: false });
    viewedAt = { 'sam-token': plexSeconds(startedAt + HOUR) };
    await settleTogether(store, silent);
    expect([seenBy(alex), seenBy(sam)]).toEqual([[1], []]);
    expect(scrobbled).toEqual([]);
  });
});
