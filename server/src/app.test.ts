import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppStatus, LikeSeed, Profile, RecommendationsResponse, WizardOptionsResponse } from '@curatorr/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('API (demo data)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let cookie = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'curatorr-test-'));
    ({ app } = await buildApp({ configDir: dir, demo: true, logger: false }));
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = async <T>(url: string) => {
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    return { status: res.statusCode, body: res.json() as T };
  };

  it('reports status', async () => {
    const { body } = await get<AppStatus>('/api/status');
    expect(body.setupComplete).toBe(true);
    expect(body.demo).toBe(true);
    expect(body.library.movies).toBeGreaterThan(50);
    expect(body.profile).toBeNull();
  });

  it('requires a profile for the wizard', async () => {
    const { status } = await get('/api/wizard/genre');
    expect(status).toBe(401);
  });

  it('selects a profile and remembers it', async () => {
    const { body: profiles } = await get<Profile[]>('/api/profiles');
    expect(profiles.map((p) => p.name)).toEqual(['Alex', 'Kids', 'Sam']);
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${profiles[0]!.id}/select` });
    expect(res.statusCode).toBe(200);
    cookie = String(res.headers['set-cookie']).split(';')[0]!;
    const { body } = await get<AppStatus>('/api/status');
    expect(body.profile?.name).toBe('Alex');
  });

  it('walks the wizard without dead ends', async () => {
    const genres = await get<WizardOptionsResponse>('/api/wizard/genre');
    expect(genres.body.options.length).toBeGreaterThan(5);
    const genre = genres.body.options.find((o) => o.id === 'Horror')!;
    expect(genre.count).toBeGreaterThanOrEqual(3);

    const themes = await get<WizardOptionsResponse>(`/api/wizard/theme?genre=Horror`);
    expect(themes.body.total).toBe(genre.count);
    for (const o of themes.body.options) expect(o.count).toBeGreaterThanOrEqual(3);

    const theme = themes.body.options[0]!;
    const moods = await get<WizardOptionsResponse>(`/api/wizard/mood?genre=Horror&theme=${theme.id}`);
    expect(moods.body.total).toBe(theme.count);
  });

  it('recommends the best rated match first and hides watched movies', async () => {
    const { body } = await get<RecommendationsResponse>('/api/recommendations?genre=Action');
    expect(body.picks.length).toBeGreaterThan(3);
    const titles = body.picks.map((p) => p.movie.title);
    expect(titles).not.toContain('The Dark Knight'); // Alex has watched it
    const scores = body.picks.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(body.picks[0]!.reasons.some((r) => r.kind === 'genre')).toBe(true);
  });

  it('stops suggesting a movie marked as seen, and can undo it', async () => {
    const first = (await get<RecommendationsResponse>('/api/recommendations?genre=Comedy')).body.picks[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie },
      payload: { movieId: first.movie.id, kind: 'seen' },
    });
    const { id } = res.json() as { id: number };
    const after = (await get<RecommendationsResponse>('/api/recommendations?genre=Comedy')).body.picks;
    expect(after.map((p) => p.movie.id)).not.toContain(first.movie.id);

    await app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie } });
    const restored = (await get<RecommendationsResponse>('/api/recommendations?genre=Comedy')).body.picks;
    expect(restored.map((p) => p.movie.id)).toContain(first.movie.id);
  });

  it('undoes a skip, so the pick is back on top', async () => {
    const first = (await get<RecommendationsResponse>('/api/recommendations?genre=Family')).body.picks[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie },
      payload: { movieId: first.movie.id, kind: 'skipped' },
    });
    const { id } = res.json() as { id: number };
    const after = (await get<RecommendationsResponse>('/api/recommendations?genre=Family')).body.picks;
    expect(after[0]!.movie.id).not.toBe(first.movie.id);

    await app.inject({ method: 'DELETE', url: `/api/feedback/${id}`, headers: { cookie } });
    const restored = (await get<RecommendationsResponse>('/api/recommendations?genre=Family')).body.picks;
    expect(restored[0]!.movie.id).toBe(first.movie.id);
  });

  it('saves for later without Plex and favours the movie next time', async () => {
    const last = (await get<RecommendationsResponse>('/api/recommendations?genre=Drama')).body.picks.at(-1)!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie },
      payload: { movieId: last.movie.id, kind: 'later' },
    });
    expect(res.json()).toMatchObject({ plex: 'skipped' });
    const again = (await get<RecommendationsResponse>('/api/recommendations?genre=Drama')).body.picks;
    const saved = again.find((p) => p.movie.id === last.movie.id)!;
    expect(saved.reasons[0]?.kind).toBe('watchlist');
    expect(again.indexOf(saved)).toBeLessThan(again.length - 1);
  });

  const cookieFor = async (name: string) => {
    const { body: profiles } = await get<Profile[]>('/api/profiles');
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${profiles.find((p) => p.name === name)!.id}/select` });
    return String(res.headers['set-cookie']).split(';')[0]!;
  };
  const picksFor = async (who: string, query: string) =>
    (await app.inject({ method: 'GET', url: `/api/recommendations?${query}`, headers: { cookie: who } })).json() as RecommendationsResponse;

  it('keeps sagas in order: part 1 before its sequels', async () => {
    const sam = await cookieFor('Sam'); // hasn't seen any Back to the Future
    const picks = (await picksFor(sam, 'theme=time-travel')).picks;
    const titles = picks.map((p) => p.movie.title);
    expect(titles).not.toContain('Back to the Future Part II');
    expect(titles).not.toContain('Back to the Future Part III');
    const part1 = picks.find((p) => p.movie.title === 'Back to the Future')!;
    expect(part1.reasons.map((r) => r.label)).toContain('Start of Back to the Future');
    expect(part1.movie.saga).toEqual({ title: 'Back to the Future', part: 1, parts: 3 });
  });

  it('moves on to the next part once the first is watched', async () => {
    const alex = await cookieFor('Alex'); // watched part 1
    const titles = (await picksFor(alex, 'theme=time-travel')).picks;
    const part2 = titles.find((p) => p.movie.title === 'Back to the Future Part II')!;
    expect(part2.reasons[0]).toEqual({ kind: 'saga', label: 'Next in Back to the Future' });
    expect(titles.map((p) => p.movie.title)).not.toContain('Back to the Future Part III');
  });

  it('"Start a saga" offers first parts of sagas not started yet', async () => {
    const sam = await cookieFor('Sam');
    const titles = (await picksFor(sam, 'time=saga')).picks.map((p) => p.movie.title).sort();
    expect(titles).toEqual(['Back to the Future', 'John Wick', 'The Lord of the Rings: The Fellowship of the Ring']);
    const options = (await app.inject({ method: 'GET', url: '/api/wizard/time', headers: { cookie: sam } })).json() as WizardOptionsResponse;
    expect(options.options.find((o) => o.id === 'saga')?.count).toBe(3);
  });

  it('applies Plex parental restrictions', async () => {
    const { body: profiles } = await get<Profile[]>('/api/profiles');
    const kids = profiles.find((p) => p.name === 'Kids')!;
    const res = await app.inject({ method: 'POST', url: `/api/profiles/${kids.id}/select` });
    const kidCookie = String(res.headers['set-cookie']).split(';')[0]!;
    const recs = await app.inject({ method: 'GET', url: '/api/recommendations', headers: { cookie: kidCookie } });
    const certs = new Set((recs.json() as RecommendationsResponse).picks.map((p) => p.movie.certification));
    expect([...certs].every((c) => c === 'G' || c === 'PG')).toBe(true);
  });

  const likeFor = async (who: string, q = '') =>
    (await app.inject({ method: 'GET', url: `/api/like?q=${encodeURIComponent(q)}`, headers: { cookie: who } })).json() as LikeSeed[];

  it('lists watched movies to start "Something like…" from, and searches the library', async () => {
    const alex = await cookieFor('Alex');
    const recent = await likeFor(alex);
    expect(recent.map((m) => m.title).sort()).toEqual(['Back to the Future', 'Inception', 'The Dark Knight', 'The Godfather']);
    expect(recent.every((m) => m.watched)).toBe(true);
    const found = await likeFor(alex, 'MATRIX');
    expect(found.map((m) => [m.title, m.watched])).toEqual([['The Matrix', false]]);
  });

  it('suggests unwatched movies like one you loved', async () => {
    const alex = await cookieFor('Alex');
    const inception = (await likeFor(alex, 'inception'))[0]!;
    const res = await picksFor(alex, `like=${inception.id}`);
    expect(res.like).toEqual({ id: inception.id, title: 'Inception' });
    const titles = res.picks.map((p) => p.movie.title);
    expect(titles).toContain('The Matrix');
    expect(titles).not.toContain('Inception');
    expect(titles).not.toContain('The Dark Knight'); // watched
    expect(res.picks[0]!.reasons.some((r) => r.kind === 'theme' || r.kind === 'keyword')).toBe(true);
  });

  it("leaves the liked movie's saga out", async () => {
    const alex = await cookieFor('Alex');
    const bttf = (await likeFor(alex, 'back to the future')).find((m) => m.title === 'Back to the Future')!;
    const titles = (await picksFor(alex, `like=${bttf.id}`)).picks.map((p) => p.movie.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.filter((t) => t.startsWith('Back to the Future'))).toEqual([]);
  });

  it('only starts from movies the profile may see', async () => {
    const godfather = (await likeFor(await cookieFor('Alex'), 'godfather'))[0]!;
    const kids = await cookieFor('Kids');
    expect(await likeFor(kids)).toEqual([]);
    expect(await likeFor(kids, 'godfather')).toEqual([]);
    const restricted = await app.inject({ method: 'GET', url: `/api/recommendations?like=${godfather.id}`, headers: { cookie: kids } });
    expect(restricted.statusCode).toBe(404);
    const unknown = await app.inject({ method: 'GET', url: '/api/recommendations?like=99999', headers: { cookie: kids } });
    expect(unknown.statusCode).toBe(404);
  });

  it('serves generated demo art', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/demo/art/1/poster.svg' });
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('KNIGHT');
  });
});
