import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { Profile } from '@curatorr/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { compressible } from './compress.js';
import { cookieOf, tempApp } from './testing.js';

describe('compressed answers', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let cookie = '';

  beforeAll(async () => {
    ({ app, close } = await tempApp('test'));
    const profiles = (await app.inject({ method: 'GET', url: '/api/profiles' })).json() as Profile[];
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${profiles[0]!.id}/select` });
    cookie = cookieOf(res);
  });

  afterAll(async () => {
    await close();
  });

  const get = (url: string, encoding?: string) =>
    app.inject({ method: 'GET', url, headers: { cookie, ...(encoding ? { 'accept-encoding': encoding } : {}) } });

  it('compresses the questions and picks as the browser accepts, into the same answer', async () => {
    for (const url of ['/api/wizard/genre', '/api/wizard/theme?genre=Drama', '/api/recommendations?genre=Drama']) {
      const plain = await get(url);
      expect(plain.statusCode).toBe(200);
      expect(plain.headers['content-encoding']).toBeUndefined();

      const br = await get(url, 'gzip, deflate, br');
      expect(br.headers['content-encoding']).toBe('br');
      expect(br.headers.vary).toMatch(/accept-encoding/i);
      expect(br.rawPayload.length).toBeLessThan(plain.rawPayload.length);
      expect(JSON.parse(brotliDecompressSync(br.rawPayload).toString())).toEqual(plain.json());

      // Browsers only offer brotli over HTTPS: the plain-HTTP address gets gzip.
      const gz = await get(url, 'gzip, deflate');
      expect(gz.headers['content-encoding']).toBe('gzip');
      expect(JSON.parse(gunzipSync(gz.rawPayload).toString())).toEqual(plain.json());
    }
  });

  it('compresses only the picking answers: never Settings, setup or sign-ins, which hold secrets', () => {
    const picking = [
      '/api/wizard/genre',
      '/api/wizard/theme?genre=Drama',
      '/api/recommendations?like=3',
      '/api/like?q=heat',
      '/api/hidden',
    ];
    for (const url of picking) {
      expect(compressible(url), url).toBe(true);
    }
    const others = [
      '/api/settings',
      '/api/setup/radarr',
      '/api/jellyfin/login',
      '/api/plex/servers',
      '/api/status',
      '/api/profiles',
      '/api/likes',
      '/api/image/1/poster',
    ];
    for (const url of others) {
      expect(compressible(url), url).toBe(false);
    }
  });

  it('leaves small answers as they are', async () => {
    const res = await get('/api/like?q=zzzzzz', 'gzip, deflate, br');
    expect(res.json()).toEqual([]);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
