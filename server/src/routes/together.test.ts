import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppStatus, Profile, RecommendationsResponse, WizardOptionsResponse } from '@curatorr/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { togetherUntil } from '../session.js';

describe('watching together (demo data)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let ctx: Awaited<ReturnType<typeof buildApp>>['ctx'];
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'curatorr-together-'));
    ({ app, ctx } = await buildApp({ configDir: dir, demo: true, logger: false }));
    for (const p of (await app.inject({ method: 'GET', url: '/api/profiles' })).json() as Profile[]) ids[p.name] = p.id;
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The cookies a response set, as a Cookie header. */
  const cookiesOf = (res: LightMyRequestResponse, before = '') => {
    const split = (pair: string) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)] as const;
    const jar = new Map(before ? before.split('; ').map(split) : []);
    for (const c of [res.headers['set-cookie'] ?? []].flat()) {
      const [name, value] = split(String(c).split(';')[0]!);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  };
  const together = (names: string[], cookie = '') =>
    app.inject({ method: 'POST', url: '/api/profiles/together', headers: { cookie }, payload: { ids: names.map((n) => ids[n]) } });
  const select = (name: string, cookie = '') =>
    app.inject({ method: 'POST', url: `/api/profiles/${ids[name]}/select`, headers: { cookie } });
  const get = async <T>(url: string, cookie: string) => (await app.inject({ method: 'GET', url, headers: { cookie } })).json() as T;
  const group = async (cookie: string) => {
    const status = await get<AppStatus>('/api/status', cookie);
    return [status.profile?.name, ...status.together.map((p) => p.name)];
  };

  it('picks for everyone in the group, within the strictest limits', async () => {
    const cookie = cookiesOf(await together(['Alex', 'Kids']));
    expect(await group(cookie)).toEqual(['Alex', 'Kids']);
    const picks = (await get<RecommendationsResponse>('/api/recommendations', cookie)).picks;
    expect(picks.length).toBeGreaterThan(3);
    expect(picks.every((p) => ['G', 'PG'].includes(p.movie.certification!))).toBe(true);
    // Alex has watched Back to the Future: not tonight, with Kids.
    const titles = (await get<RecommendationsResponse>('/api/recommendations?theme=time-travel', cookie)).picks.map((p) => p.movie.title);
    expect(titles).not.toContain('Back to the Future');

    const alone = cookiesOf(await select('Kids'));
    const kidsAlone = (await get<WizardOptionsResponse>('/api/wizard/genre', alone)).total;
    const withAlex = (await get<WizardOptionsResponse>('/api/wizard/genre', cookie)).total;
    expect(withAlex).toBeLessThan(kidsAlone);
  });

  it("keeps the device's own profile first when it's one of them", async () => {
    const sam = cookiesOf(await select('Sam'));
    const cookie = cookiesOf(await together(['Alex', 'Sam'], sam), sam);
    expect(await group(cookie)).toEqual(['Sam', 'Alex']);
  });

  it('ends the group when one profile is picked on its own', async () => {
    const cookie = cookiesOf(await together(['Alex', 'Sam']));
    const after = cookiesOf(await select('Sam', cookie), cookie);
    expect(await group(after)).toEqual(['Sam']);
  });

  it('refuses fewer than two people, or someone unknown or hidden', async () => {
    expect((await together(['Alex'])).statusCode).toBe(400);
    expect((await together(['Alex', 'Alex'])).statusCode).toBe(400);
    const unknown = await app.inject({ method: 'POST', url: '/api/profiles/together', payload: { ids: [ids.Alex, 9999] } });
    expect(unknown.statusCode).toBe(404);
    ctx.store.setProfileHidden(ids.Sam!, true);
    try {
      expect((await together(['Alex', 'Sam'])).statusCode).toBe(404);
    } finally {
      ctx.store.setProfileHidden(ids.Sam!, false);
    }
  });

  const feedback = (cookie: string, payload: object) =>
    app.inject({ method: 'POST', url: '/api/feedback', headers: { cookie }, payload });
  const undo = (cookie: string, id: number) => app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie } });
  const kinds = (name: string, movieId: number) =>
    ctx.store.feedback(ids[name]!).filter((e) => e.movieId === movieId).map((e) => e.kind);
  const movieId = (title: string) => ctx.store.movies().find((m) => m.title === title)!.id;

  it("puts a group's Not tonight on everyone, and takes it back for everyone", async () => {
    const cookie = cookiesOf(await together(['Alex', 'Sam']));
    const paddington = movieId('Paddington 2');
    const res = await feedback(cookie, { movieId: paddington, kind: 'skipped' });
    const { ids: rows } = res.json() as { ids: number[] };
    expect(rows).toHaveLength(2);
    expect([kinds('Alex', paddington), kinds('Sam', paddington)]).toEqual([['skipped'], ['skipped']]);
    for (const id of rows) expect((await undo(cookie, id)).statusCode).toBe(200);
    expect([kinds('Alex', paddington), kinds('Sam', paddington)]).toEqual([[], []]);
  });

  it('marks Seen it only for who has seen it, which takes it out of the group\'s picks', async () => {
    const cookie = cookiesOf(await together(['Alex', 'Sam']));
    const up = movieId('Up');
    const res = await feedback(cookie, { movieId: up, kind: 'seen', profileIds: [ids.Sam] });
    expect(res.statusCode).toBe(200);
    expect([kinds('Alex', up), kinds('Sam', up)]).toEqual([[], ['seen']]);
    const titles = async (c: string) =>
      (await get<RecommendationsResponse>('/api/recommendations?genre=Animation', c)).picks.map((p) => p.movie.title);
    expect(await titles(cookie)).not.toContain('Up');
    expect(await titles(cookiesOf(await select('Alex')))).toContain('Up');
    const { ids: rows } = res.json() as { ids: number[] };
    await undo(cookie, rows[0]!);
    expect(kinds('Sam', up)).toEqual([]);
  });

  it('refuses marks for someone outside the group, and Undo of their marks', async () => {
    const cookie = cookiesOf(await together(['Alex', 'Sam']));
    const coco = movieId('Coco');
    expect((await feedback(cookie, { movieId: coco, kind: 'never', profileIds: [ids.Kids] })).statusCode).toBe(400);
    expect((await feedback(cookie, { movieId: coco, kind: 'never', profileIds: [] })).statusCode).toBe(400);
    const kidsOwn = ctx.store.addFeedback(ids.Kids!, coco, 'never');
    expect((await undo(cookie, kidsOwn)).statusCode).toBe(404);
    ctx.store.deleteFeedback(ids.Kids!, kidsOwn);
  });

  it("is back to one profile once the evening's over", async () => {
    const alex = cookiesOf(await select('Alex'));
    const ended = `curatorr_together=${encodeURIComponent(app.signCookie(`${ids.Sam}|${Date.now() - 1000}`))}`;
    expect(await group(`${alex}; ${ended}`)).toEqual(['Alex']);
  });
});

describe('how long a group lasts', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('until 4 am, also when the evening runs past midnight', () => {
    vi.stubEnv('TZ', 'Europe/Bucharest');
    expect(togetherUntil(Date.parse('2026-10-11T21:00:00+03:00'))).toBe(Date.parse('2026-10-12T04:00:00+03:00'));
    expect(togetherUntil(Date.parse('2026-10-12T01:30:00+03:00'))).toBe(Date.parse('2026-10-12T04:00:00+03:00'));
    // The night the clocks go back.
    expect(togetherUntil(Date.parse('2026-10-24T22:00:00+03:00'))).toBe(Date.parse('2026-10-25T04:00:00+02:00'));
  });
});
