import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store } from '../store.js';
import { fakeServer, silentLog, tempStore } from '../testing.js';
import { checkForUpdates, updateFor } from './updates.js';

describe('which release to tell admins about', () => {
  it('names a newer release, with a link to its notes', () => {
    expect(updateFor('1.2.3', '1.2.4')).toEqual({
      version: '1.2.4',
      url: 'https://github.com/cosmin-sulita/curatorr/releases/tag/v1.2.4',
    });
  });

  it('compares versions as numbers, not text', () => {
    expect(updateFor('1.2.9', '1.2.10')?.version).toBe('1.2.10');
    expect(updateFor('1.2.10', '1.2.9')).toBeNull();
  });

  it('says nothing when the running version is the latest, or newer', () => {
    expect(updateFor('1.2.3', '1.2.3')).toBeNull();
    // A build of the next release, before GitHub has it.
    expect(updateFor('1.3.0', '1.2.9')).toBeNull();
  });

  it('says nothing before the first look, or for a build from source', () => {
    expect(updateFor('1.2.3', null)).toBeNull();
    expect(updateFor('dev', '1.2.4')).toBeNull();
  });
});

describe("reading the latest release from GitHub's API", () => {
  let stop: () => Promise<void>;
  let url: string;
  let store: Store;
  let closeStore: () => void;
  /** What the fake GitHub answers. */
  let reply: { status: number; body: unknown };

  /** A release as GitHub's API returns it (the uploader left out). */
  const release = (tag: string) => ({
    url: 'https://api.github.com/repos/cosmin-sulita/curatorr/releases/410382344',
    html_url: `https://github.com/cosmin-sulita/curatorr/releases/tag/${tag}`,
    id: 410382344,
    tag_name: tag,
    target_commitish: 'ac8578e5bca9da7629f502e15de5b5cbbf7ad737',
    name: `Curatorr ${tag.replace(/^v/, '')}`,
    draft: false,
    prerelease: false,
    created_at: '2026-10-12T08:37:57Z',
    published_at: '2026-10-12T08:40:50Z',
    assets: [],
    body: '\n- fix(header): keep the profile photo from blinking when a pick opens ([1e15535](https://github.com/cosmin-sulita/curatorr/commit/1e15535))\n\n',
  });

  beforeAll(async () => {
    const github = await fakeServer((_req, res) => {
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
    stop = github.close;
    url = `${github.base}/repos/cosmin-sulita/curatorr/releases/latest`;
    ({ store, close: closeStore } = tempStore('updates'));
  });

  afterAll(async () => {
    await stop();
    closeStore();
  });

  it("keeps the latest release's version", async () => {
    store.set('latestVersion', null);
    reply = { status: 200, body: release('v1.3.0') };
    await checkForUpdates(store, silentLog, url);
    expect(store.get('latestVersion')).toBe('1.3.0');
  });

  it('keeps the last version read when GitHub fails or limits the rate, without throwing', async () => {
    store.set('latestVersion', '1.2.0');
    for (const status of [500, 403]) {
      reply = { status, body: { message: 'API rate limit exceeded for 203.0.113.7.' } };
      await expect(checkForUpdates(store, silentLog, url)).resolves.toBeUndefined();
      expect(store.get('latestVersion')).toBe('1.2.0');
    }
  });

  it("ignores a tag that isn't a version", async () => {
    store.set('latestVersion', '1.2.0');
    reply = { status: 200, body: release('nightly') };
    await checkForUpdates(store, silentLog, url);
    expect(store.get('latestVersion')).toBe('1.2.0');
  });
});
