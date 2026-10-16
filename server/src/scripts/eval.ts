/**
 * Ranking report: replays a real database's watch history through the working copy's ranking, so
 * changes to it are measured rather than tuned by feel.
 *
 *   npm run eval                        reads config/curatorr.db, a copy of the server's database
 *   npm run eval -- --db <file>         reads another copy
 *   npm run eval -- --profile 1         only that profile
 *   npm run eval -- --split 2026-03-01  reports watches before and from a date separately
 *   npm run eval -- --save run.json     keeps each watch's result, to compare a later run with
 *   npm run eval -- --compare run.json  compares with a saved run, watch by watch, with 95% intervals
 *   npm run eval -- --evenings 30       how many evenings the staleness check simulates
 *   npm run eval -- --like heat         explains one movie's "Something like…" list: what each pick shares with it
 *
 * Each watch is replayed on the evening it happened: the library as it was (by when each file arrived,
 * or Radarr's added date in copies from before that was stored), the earlier watches, requests and
 * feedback, and the questions the wizard would have offered. Where
 * the watched movie ranks says how likely the profile was to accept the pick. Watches predate
 * Curatorr, so this rewards existing habits; read it together with the staleness check. A "Seen it"
 * that Curatorr marked watched on the media server comes back as a watch, but isn't one, so it isn't replayed.
 *
 * "Something like…" has no watches to replay, so the report checks its lists from every movie a profile
 * watched instead: how many picks share a genre or a theme with the movie, and whether a few movies crowd
 * the top of every list.
 *
 * The database is only read, and never its settings table (it holds tokens): settings are taken at
 * their defaults, watched movies left out and requests favoured.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import {
  JUST_ARRIVED,
  NEXT_PART_BONUS,
  allowedFor,
  arrivalTime,
  isSurprise,
  libraryIndex,
  matchesShelf,
  moodById,
  personalAdjustment,
  profileSignals,
  qualityScore,
  rankMovies,
  rankSimilar,
  seenEchoes,
  similarity,
  surpriseOrder,
  tagMovie,
  themeById,
  wizardOptions,
  type Criteria,
  type FeedbackEvent,
  type FeedbackKind,
  type Movie,
  type RankedMovie,
  type Signature,
} from '@curatorr/shared';
import { config } from '../config.js';
import { picking, type Picking, type ProfileData } from '../services/recommend.js';
import { readMovies } from '../store.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    profile: { type: 'string' },
    split: { type: 'string' },
    save: { type: 'string' },
    compare: { type: 'string' },
    evenings: { type: 'string', default: '60' },
    like: { type: 'string' },
  },
});

const cwd = process.env.INIT_CWD ?? process.cwd();
const file = values.db ? path.resolve(cwd, values.db) : path.join(config.configDir, 'curatorr.db');
if (!existsSync(file)) {
  console.error(`No database at ${file}.`);
  console.error("Copy curatorr.db (with its -wal and -shm files) from Curatorr's config folder, or pass --db <file>.");
  process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
/** Watches this soon after the library's first movie are left out: the library was still filling up. */
const SETTLING = 7 * DAY;
/** A watch of a movie added this recently counts as a fresh arrival rather than the backlog. */
const FRESH = 30 * DAY;
/** Profiles with fewer replayable watches than this are skipped. */
const MIN_WATCHES = 20;
const EVENINGS = Number(values.evenings) || 60;

// ---------------------------------------------------------------------------
// The database, read once
// ---------------------------------------------------------------------------

const db = new DatabaseSync(file, { readOnly: true });
const all = <T>(sql: string) => db.prepare(sql).all() as unknown as T[];
// Tagged by the working copy's vocabulary, as the server does at startup.
const movies: Movie[] = readMovies(db).map((m) => ({ ...m, ...tagMovie(m) }));
const profiles = all<{ id: number; name: string; restriction_profile: string | null }>(
  'SELECT id, name, restriction_profile FROM profiles WHERE hidden = 0 ORDER BY is_admin DESC, sort_order, name',
);
const watched = all<{ profile_id: number; movie_id: number; viewed_at: number | null }>(
  'SELECT profile_id, movie_id, viewed_at FROM watched',
);
const feedback = all<{ profile_id: number; movie_id: number; kind: FeedbackKind; created_at: number; plex_synced: number }>(
  'SELECT profile_id, movie_id, kind, created_at, plex_synced FROM feedback',
);
const requests = all<{ profile_id: number; movie_id: number; requested_at: number | null }>(
  'SELECT profile_id, movie_id, requested_at FROM requests',
);
const watchlist = all<{ profile_id: number; movie_id: number }>('SELECT profile_id, movie_id FROM watchlist');
db.close();

const movieById = new Map(movies.map((m) => [m.id, m]));
const toEvent = (f: (typeof feedback)[number]): FeedbackEvent => ({
  movieId: f.movie_id,
  kind: f.kind,
  createdAt: f.created_at,
  serverSynced: Boolean(f.plex_synced),
});
const arrived = (m: Movie) => arrivalTime(m) ?? 0;
const libraryStart = Math.min(...movies.map(arrived).filter((t) => t > 0));
/** When the copy was taken, roughly: its latest activity. */
const copiedAt = Math.max(
  ...movies.map(arrived),
  ...watched.map((w) => w.viewed_at ?? 0),
  ...feedback.map((f) => f.created_at),
  ...requests.map((r) => r.requested_at ?? 0),
);
/** 9 pm on the evening after the copy. */
const nextEvening = (() => {
  const d = new Date(copiedAt);
  d.setHours(21, 0, 0, 0);
  return d.getTime() > copiedAt ? d.getTime() : d.getTime() + DAY;
})();

/** A profile as it stood at `at`; the Watchlist has no dates, so it only counts from the copy on. */
function dataAt(profileId: number, at: number, extraFeedback: FeedbackEvent[] = [], keep?: number): ProfileData {
  const profile = profiles.find((p) => p.id === profileId)!;
  return {
    profileId,
    name: profile.name,
    restriction: profile.restriction_profile,
    movies: movies.filter((m) => m.id === keep || arrived(m) <= at),
    watched: watched
      .filter((w) => w.profile_id === profileId && (w.viewed_at ?? 0) < at)
      .map((w) => ({ movieId: w.movie_id, viewedAt: w.viewed_at })),
    feedback: [...feedback.filter((f) => f.profile_id === profileId && f.created_at < at).map(toEvent), ...extraFeedback],
    watchlist: new Set(at >= copiedAt ? watchlist.filter((w) => w.profile_id === profileId).map((w) => w.movie_id) : []),
    requested: new Set(requests.filter((r) => r.profile_id === profileId && (r.requested_at ?? 0) <= at).map((r) => r.movie_id)),
    requestedByOthers: new Set(
      requests.filter((r) => r.profile_id !== profileId && (r.requested_at ?? 0) <= at).map((r) => r.movie_id),
    ),
    server: 'plex',
    available: null,
    includeWatched: false,
    boostRequests: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo);
}
const pct = (x: number, digits = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '–');
const num = (x: number, digits = 3) => (Number.isFinite(x) ? x.toFixed(digits) : '–');
const signed = (x: number, digits = 3) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
const name = (m: Movie) => (m.year ? `${m.title} (${m.year})` : m.title);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const noImage = () => null;
/** Lowercase without accents, so "amelie" finds "Amélie". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function heading(text: string) {
  console.log(`\n${text}`);
}

/** Deterministic random numbers, so the intervals don't change between runs. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every answer path the wizard offers, weighted as if each offered answer (and "any") were equally likely. */
function wizardPaths(p: Picking): { c: Criteria; weight: number; skipped: string[] }[] {
  const facet = { image: noImage, sagaStarters: p.ctx.sagas?.starters };
  const choices = (res: ReturnType<typeof wizardOptions>, any: boolean) => {
    const ids: (string | null)[] = res.options.map((o) => (o.id === 'any' ? null : o.id));
    if (any) ids.push(null);
    return res.skip ? [{ id: null, w: 1 }] : ids.map((id) => ({ id, w: 1 / ids.length }));
  };
  const genres = wizardOptions(p.eligible, 'genre', {}, facet).options;
  const out = [{ c: {}, weight: 1 / (genres.length + 1), skipped: [] as string[] }];
  for (const g of genres) {
    const themeRes = wizardOptions(p.eligible, 'theme', { genre: g.id }, facet);
    for (const t of choices(themeRes, true)) {
      const moodRes = wizardOptions(p.eligible, 'mood', { genre: g.id, theme: t.id }, facet);
      for (const md of choices(moodRes, true)) {
        const timeRes = wizardOptions(p.eligible, 'time', { genre: g.id, theme: t.id, mood: md.id }, facet);
        for (const ti of choices(timeRes, false)) {
          const skipped = [themeRes.skip && 'theme', moodRes.skip && 'mood', timeRes.skip && 'time'].filter(
            (s): s is string => Boolean(s),
          );
          out.push({
            c: { genre: g.id, theme: t.id, mood: md.id, time: ti.id },
            weight: (1 / (genres.length + 1)) * t.w * md.w * ti.w,
            skipped,
          });
        }
      }
    }
  }
  return out;
}

/** The picks in the order the pick screen shows them: "Surprise me" deals the best ones in a drawn order. */
const rank = (p: Picking, c: Criteria, limit?: number) => {
  const ranked = rankMovies(p.eligible, c, p.ctx.feedback, limit ? { ...p.opts, limit } : p.opts);
  return isSurprise(c) ? surpriseOrder(ranked, p.opts) : ranked;
};

// ---------------------------------------------------------------------------
// Would it have suggested what the profile watched?
// ---------------------------------------------------------------------------

const FAMILIES = ['Surprise me', 'genre', 'genre + theme', 'genre + mood', 'Just arrived', 'Season'] as const;
type Family = (typeof FAMILIES)[number];

/** How one watch fared for one kind of question (averaged over the questions of that kind). */
interface Result {
  rr: number;
  h1: number;
  h12: number;
  pctl: number;
  /** The same, ranking the matches by rating alone (best first), for reference. */
  rrRated: number;
  /** Expected at random. */
  rrRandom: number;
  h12Random: number;
}
interface Watch {
  key: string;
  at: number;
  fresh: boolean;
  offered: boolean;
  results: Partial<Record<Family, Result>>;
}

/** The questions the wizard offered that evening that the watched movie answers, and its shortcuts. */
function questions(p: Picking, m: Movie): { family: Family; c: Criteria }[] {
  const facet = { image: noImage, sagaStarters: p.ctx.sagas?.starters };
  const out: { family: Family; c: Criteria }[] = [{ family: 'Surprise me', c: {} }];
  const first = wizardOptions(p.eligible, 'genre', {}, { ...facet, now: p.opts.now });
  for (const shelf of first.shelves ?? []) {
    if (!matchesShelf(m, shelf.id, p.opts.now)) continue;
    out.push({ family: shelf.id === JUST_ARRIVED.id ? 'Just arrived' : 'Season', c: { shelf: shelf.id } });
  }
  const genres = new Set(first.options.map((o) => o.id));
  for (const genre of m.genres.filter((g) => genres.has(g))) {
    out.push({ family: 'genre', c: { genre } });
    const themes = wizardOptions(p.eligible, 'theme', { genre }, facet);
    if (!themes.skip) {
      for (const o of themes.options) if ((m.themes[o.id] ?? 0) > 0) out.push({ family: 'genre + theme', c: { genre, theme: o.id } });
    }
    const moods = wizardOptions(p.eligible, 'mood', { genre }, facet);
    if (!moods.skip) {
      for (const o of moods.options) if ((m.moods[o.id] ?? 0) > 0) out.push({ family: 'genre + mood', c: { genre, mood: o.id } });
    }
  }
  return out;
}

function harmonic(n: number) {
  let h = 0;
  for (let i = 1; i <= n; i++) h += 1 / i;
  return h;
}

function replay(profileId: number): Watch[] {
  const echo = seenEchoes(feedback.filter((f) => f.profile_id === profileId).map(toEvent));
  const replayable = watched
    .filter(
      (w) =>
        w.profile_id === profileId &&
        w.viewed_at != null &&
        w.viewed_at >= libraryStart + SETTLING &&
        !echo({ movieId: w.movie_id, viewedAt: w.viewed_at }),
    )
    .sort((a, b) => a.viewed_at! - b.viewed_at!);
  return replayable.map((w) => {
    const m = movieById.get(w.movie_id)!;
    const at = w.viewed_at! - 60_000;
    const p = picking(dataAt(profileId, at, [], m.id), at, { taste: true });
    const watch: Watch = {
      key: `${m.id}|${w.viewed_at}`,
      at,
      fresh: arrivalTime(m) != null && w.viewed_at! - arrived(m) <= FRESH,
      offered: p.eligible.some((x) => x.id === m.id),
      results: {},
    };
    const byFamily = new Map<Family, Result[]>();
    for (const { family, c } of questions(p, m)) {
      const exact = rank(p, c, Infinity).filter((r) => r.tier === 0);
      const n = exact.length;
      const pos = exact.findIndex((r) => r.movie.id === m.id);
      const rated = [...exact].sort((a, b) => qualityScore(b.movie.ratings) - qualityScore(a.movie.ratings));
      const posRated = rated.findIndex((r) => r.movie.id === m.id);
      const result: Result =
        pos < 0
          ? { rr: 0, h1: 0, h12: 0, pctl: 1, rrRated: 0, rrRandom: n ? harmonic(n) / n : 0, h12Random: n ? Math.min(12, n) / n : 0 }
          : {
              rr: 1 / (pos + 1),
              h1: Number(pos === 0),
              h12: Number(pos < 12),
              pctl: n > 1 ? pos / (n - 1) : 0,
              rrRated: 1 / (posRated + 1),
              rrRandom: harmonic(n) / n,
              h12Random: Math.min(12, n) / n,
            };
      byFamily.set(family, [...(byFamily.get(family) ?? []), result]);
    }
    for (const [family, rs] of byFamily) {
      watch.results[family] = {
        rr: mean(rs.map((r) => r.rr)),
        h1: mean(rs.map((r) => r.h1)),
        h12: mean(rs.map((r) => r.h12)),
        pctl: mean(rs.map((r) => r.pctl)),
        rrRated: mean(rs.map((r) => r.rrRated)),
        rrRandom: mean(rs.map((r) => r.rrRandom)),
        h12Random: mean(rs.map((r) => r.h12Random)),
      };
    }
    return watch;
  });
}

function scoreTable(watches: Watch[]) {
  console.log(
    `  ${'question'.padEnd(30)}${'watches'.padStart(8)}${'MRR'.padStart(8)}${'hit@1'.padStart(8)}${'hit@12'.padStart(8)}` +
      `${'rank pct'.padStart(10)}   ${'rating only'.padStart(11)}${'random'.padStart(8)}`,
  );
  for (const family of FAMILIES) {
    const segments: [string, Watch[]][] = [
      [family, watches],
      ['  arrived in the last 30 days', watches.filter((w) => w.fresh)],
      ['  the backlog', watches.filter((w) => !w.fresh)],
    ];
    for (const [label, ws] of segments) {
      const rs = ws.flatMap((w) => (w.results[family] ? [w.results[family]] : []));
      if (!rs.length) continue;
      console.log(
        `  ${label.padEnd(30)}${String(rs.length).padStart(8)}${num(mean(rs.map((r) => r.rr))).padStart(8)}` +
          `${pct(mean(rs.map((r) => r.h1)), 1).padStart(8)}${pct(mean(rs.map((r) => r.h12)), 1).padStart(8)}` +
          `${pct(quantile(rs.map((r) => r.pctl), 0.5)).padStart(10)}   ${num(mean(rs.map((r) => r.rrRated))).padStart(11)}` +
          `${num(mean(rs.map((r) => r.rrRandom))).padStart(8)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Does it go stale?
// ---------------------------------------------------------------------------

/** The same answers every evening, the first pick shown (as the pick screen logs it) and not played. */
function staleness(profileId: number) {
  const start = picking(dataAt(profileId, nextEvening), nextEvening, { taste: true });
  const facet = { image: noImage, sagaStarters: start.ctx.sagas?.starters };
  const genres = wizardOptions(start.eligible, 'genre', {}, facet).options.slice(0, 5);
  const answers: [string, Criteria][] = [['Surprise me', {}], ...genres.map((g): [string, Criteria] => [g.label, { genre: g.id }])];
  heading(`Same answers every evening for ${EVENINGS} evenings, the first pick shown and not played:`);
  for (const [label, c] of answers) {
    const shown: FeedbackEvent[] = [];
    const firsts: number[] = [];
    for (let d = 0; d < EVENINGS; d++) {
      const at = nextEvening + d * DAY;
      const p = picking(dataAt(profileId, at, shown), at, { taste: true });
      const top = rank(p, c)[0];
      if (!top) break;
      firsts.push(top.movie.id);
      shown.push({ movieId: top.movie.id, kind: 'shown', createdAt: at });
    }
    const counts = new Map<number, number>();
    for (const id of firsts) counts.set(id, (counts.get(id) ?? 0) + 1);
    const [mostId, most] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    console.log(
      `  ${label.padEnd(16)} ${String(counts.size).padStart(3)} different first picks; most often ${
        movieById.get(mostId) ? name(movieById.get(mostId)!) : '–'
      }, ${most} times`,
    );
  }
}

// ---------------------------------------------------------------------------
// What decides tonight's pick, and where the wizard leads
// ---------------------------------------------------------------------------

function tonight(profileId: number) {
  const p = picking(dataAt(profileId, nextEvening), nextEvening, { taste: true });
  const paths = wizardPaths(p);
  let weight = 0;
  let bestRated = 0;
  let personalChip = 0;
  let padded = 0;
  let poor = 0;
  const skipped = new Map<string, number>();
  const firstWeight = new Map<number, number>();
  const inTop3 = new Set<number>();
  for (const path of paths) {
    const ranked = rank(p, path.c);
    const top = ranked[0];
    if (!top) continue;
    weight += path.weight;
    const sameTier = ranked.filter((r) => r.tier === top.tier);
    const best = Math.max(...sameTier.map((r) => qualityScore(r.movie.ratings)));
    if (qualityScore(top.movie.ratings) >= best) bestRated += path.weight;
    if (top.reasons.some((r: RankedMovie['reasons'][number]) => !['genre', 'theme', 'mood', 'time', 'rating'].includes(r.kind))) {
      personalChip += path.weight;
    }
    if (ranked.filter((r) => r.tier === 0).length < 6) padded += path.weight;
    if (qualityScore(top.movie.ratings) < 60) poor += path.weight;
    for (const s of path.skipped) skipped.set(s, (skipped.get(s) ?? 0) + path.weight);
    firstWeight.set(top.movie.id, (firstWeight.get(top.movie.id) ?? 0) + path.weight);
    ranked.slice(0, 3).forEach((r) => inTop3.add(r.movie.id));
  }
  const share = (x: number) => pct(x / weight);
  const top10 = [...firstWeight.values()].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  heading(`Tonight (${day(nextEvening)}), over the ${paths.length} answer paths the wizard offers, each answer equally likely:`);
  const line = (label: string, value: string) => console.log(`  ${label.padEnd(54)}${value}`);
  line('first pick is the best-rated movie of its tier', share(bestRated));
  line('first pick has a chip beyond the answers and rating', share(personalChip));
  line('first pick rated under 60', share(poor));
  line('fewer than 6 exact matches (padded with close ones)', share(padded));
  line('questions skipped as pointless', ['theme', 'mood', 'time'].map((s) => `${s} ${share(skipped.get(s) ?? 0)}`).join(', '));
  console.log(
    `  eligible movies in some top 3: ${pct(inTop3.size / p.eligible.length)} of ${p.eligible.length}; ` +
      `the 10 most frequent first picks take ${share(top10)} of the paths`,
  );
}

// ---------------------------------------------------------------------------
// "Something like…": what its lists hold, and why
// ---------------------------------------------------------------------------

/** The movies a profile starts "Something like…" from, as the app lists them: watched or marked "Seen it". */
function likeSeeds(profileId: number, at: number): Movie[] {
  const ids = new Set([
    ...watched.filter((w) => w.profile_id === profileId && (w.viewed_at ?? 0) < at).map((w) => w.movie_id),
    ...feedback
      .filter((f) => f.profile_id === profileId && f.kind === 'seen' && f.created_at < at)
      .map((f) => f.movie_id),
  ]);
  return [...ids].flatMap((id) => movieById.get(id) ?? []);
}

/**
 * From every movie the profile watched: do the picks share a genre or a theme with it, and do a few movies
 * crowd every list?
 */
function likeSummary(profileId: number) {
  const p = picking(dataAt(profileId, nextEvening), nextEvening);
  const seeds = likeSeeds(profileId, nextEvening).filter((m) => allowedFor(m, p.ctx));
  let picks = 0;
  let sameGenre = 0;
  let sameTheme = 0;
  let firstOffGenre = 0;
  const inTop3 = new Map<number, number>();
  for (const seed of seeds) {
    rankSimilar(p.eligible, seed, movies, p.ctx.feedback, p.opts).forEach((r, i) => {
      picks++;
      if (r.movie.genres.some((g) => seed.genres.includes(g))) sameGenre++;
      else if (i === 0) firstOffGenre++;
      if (Object.keys(r.movie.themes).some((t) => (seed.themes[t] ?? 0) > 0)) sameTheme++;
      if (i < 3) inTop3.set(r.movie.id, (inTop3.get(r.movie.id) ?? 0) + 1);
    });
  }
  const crowding = [...inTop3].sort((a, b) => b[1] - a[1]).slice(0, 5);
  heading(`Something like…, from each of the ${seeds.length} movies they watched (the picks shown, up to 12):`);
  const line = (label: string, value: string) => console.log(`  ${label.padEnd(54)}${value}`);
  line('picks sharing a genre with the movie', pct(sameGenre / picks, 1));
  line('picks sharing a theme with it', pct(sameTheme / picks, 1));
  line('first picks with no genre in common', `${firstOffGenre} of ${seeds.length}`);
  line('different movies in some top 3', String(inTop3.size));
  console.log(`  most often in the top 3: ${crowding.map(([id, n]) => `${name(movieById.get(id)!)} ${n}`).join(', ')}`);
}

const featureLabel = (feature: string) => {
  const id = feature.slice(2);
  if (feature.startsWith('t:')) return themeById.get(id)?.label ?? id;
  if (feature.startsWith('m:')) return moodById.get(id)?.label ?? id;
  return id;
};

/** What a pick shares with the liked movie, as shares of their likeness, biggest first. */
function sharedParts(liked: Signature, pick: Signature): string {
  const parts = [...liked].flatMap(([feature, w]) =>
    pick.has(feature) ? [{ feature, part: w * pick.get(feature)! }] : [],
  );
  const total = parts.reduce((sum, p) => sum + p.part, 0);
  return parts
    .sort((a, b) => b.part - a.part)
    .map((p) => `${featureLabel(p.feature)} ${pct(p.part / total)}`)
    .join(' · ');
}

/** `--like`: one movie's "Something like…" list on the evening after the copy, and what each pick shares with it. */
function explainLike(profileId: number, query: string) {
  const q = fold(query);
  const found = movies.filter((m) => fold(m.title).includes(q));
  const liked = found.find((m) => fold(m.title) === q) ?? found[0];
  if (!liked) {
    console.log(`No movie title contains "${query}".`);
    return;
  }
  const p = picking(dataAt(profileId, nextEvening), nextEvening);
  const { entries, typicalNorm } = libraryIndex(movies);
  const likedSig = entries.get(liked.id)!.sig;
  const likeness = (m: Movie) => similarity(likedSig, entries.get(m.id)!.sig, typicalNorm);
  const others = p.eligible.filter((m) => m.id !== liked.id && !(liked.saga && m.saga?.id === liked.saga.id));
  const best = Math.max(0, ...others.map(likeness));
  const signals = profileSignals(p.ctx.feedback, p.opts);
  const ranked = rankSimilar(p.eligible, liked, movies, p.ctx.feedback, p.opts);

  const profile = profiles.find((x) => x.id === profileId)!;
  heading(`Something like ${name(liked)} for ${profile.name}, on ${day(nextEvening)}:`);
  console.log(
    `  ${'#'.padStart(3)}  ${'match'.padEnd(6)}${'score'.padStart(7)}${'likeness'.padStart(15)}` +
      `${'rating'.padStart(8)}${'personal'.padStart(10)}`,
  );
  ranked.forEach((r, i) => {
    const sim = likeness(r.movie);
    const next = p.opts.sagas?.next.has(r.movie.id) && r.movie.saga ? NEXT_PART_BONUS : 0;
    const personal = personalAdjustment(r.movie, signals, p.opts).delta + next;
    const chips = r.reasons
      .filter((x) => ['requested', 'watchlist', 'added', 'saga'].includes(x.kind))
      .map((x) => x.label);
    console.log(
      `  ${String(i + 1).padStart(3)}  ${(r.tier ? 'loose' : 'strong').padEnd(6)}${r.score.toFixed(1).padStart(7)}` +
        `${`${sim.toFixed(3)} ${pct(sim / best)}`.padStart(15)}${Math.round(r.quality).toString().padStart(8)}` +
        `${signed(personal, 1).padStart(10)}  ${[name(r.movie), ...chips].join(' · ')}`,
    );
    console.log(`  ${''.padStart(23)}shares ${sharedParts(likedSig, entries.get(r.movie.id)!.sig)}`);
  });
  if (!ranked.length) console.log('  nothing in common with any movie they may watch');
}

// ---------------------------------------------------------------------------
// Saving and comparing runs
// ---------------------------------------------------------------------------

type Saved = Record<string, Record<Family, Record<string, { rr: number; h12: number }>>>;

function toSaved(runs: Map<number, Watch[]>): Saved {
  const out: Saved = {};
  for (const [profileId, ws] of runs) {
    const byFamily = {} as Saved[string];
    for (const family of FAMILIES) {
      byFamily[family] = {};
      for (const w of ws) {
        const r = w.results[family];
        if (r) byFamily[family][w.key] = { rr: r.rr, h12: r.h12 };
      }
    }
    out[profileId] = byFamily;
  }
  return out;
}

function compare(runs: Map<number, Watch[]>, savedFile: string) {
  const before = JSON.parse(readFileSync(savedFile, 'utf8')) as Saved;
  const now = toSaved(runs);
  heading(`Compared with ${savedFile}, watch by watch (mean change, 95% interval):`);
  for (const [profileId, families] of Object.entries(now)) {
    const old = before[profileId];
    if (!old) continue;
    console.log(`  ${profiles.find((p) => String(p.id) === profileId)?.name ?? profileId}`);
    for (const family of FAMILIES) {
      const keys = Object.keys(families[family]).filter((k) => old[family]?.[k]);
      if (keys.length < 5) continue;
      const diff = (k: string, f: 'rr' | 'h12') => families[family][k]![f] - old[family]![k]![f];
      const draw = random(42);
      const boot = { rr: [] as number[], h12: [] as number[] };
      for (let i = 0; i < 2000; i++) {
        let rr = 0;
        let h12 = 0;
        for (let j = 0; j < keys.length; j++) {
          const k = keys[Math.floor(draw() * keys.length)]!;
          rr += diff(k, 'rr');
          h12 += diff(k, 'h12');
        }
        boot.rr.push(rr / keys.length);
        boot.h12.push(h12 / keys.length);
      }
      const was = mean(keys.map((k) => old[family]![k]!.rr));
      const is = mean(keys.map((k) => families[family][k]!.rr));
      const h12Change = mean(keys.map((k) => diff(k, 'h12')));
      console.log(
        `    ${family.padEnd(14)} MRR ${num(was)} → ${num(is)} (${signed(is - was)}, ${signed(quantile(boot.rr, 0.025))} … ${signed(quantile(boot.rr, 0.975))})` +
          `   hit@12 ${signed(h12Change * 100, 1)} pts (${signed(quantile(boot.h12, 0.025) * 100, 1)} … ${signed(quantile(boot.h12, 0.975) * 100, 1)})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

console.log(`${movies.length} movies in ${file}`);
console.log(`Library started ${day(libraryStart)}; latest activity ${day(copiedAt)}.`);

const chosen = values.profile ? profiles.filter((p) => String(p.id) === values.profile) : profiles;
if (values.like) {
  if (chosen[0]) explainLike(chosen[0].id, values.like);
  else console.log(`\nNo profile ${values.profile}.`);
} else {
  const runs = new Map<number, Watch[]>();
  const tooFew: string[] = [];
  for (const profile of chosen) {
    const ws = replay(profile.id);
    if (ws.length < MIN_WATCHES) {
      tooFew.push(`${profile.name} (${ws.length})`);
      continue;
    }
    runs.set(profile.id, ws);
    const offered = ws.filter((w) => w.offered).length;
    heading(
      `${profile.name}: would the pick have been what they watched? ${ws.length} watches since ${day(libraryStart + SETTLING)}, ` +
        `${ws.length - offered} of them not offerable that evening (saga order, not in Plex)`,
    );
    if (values.split) {
      const split = Date.parse(values.split);
      console.log(`  before ${values.split}`);
      scoreTable(ws.filter((w) => w.at < split));
      console.log(`  from ${values.split}`);
      scoreTable(ws.filter((w) => w.at >= split));
    } else {
      scoreTable(ws);
    }
    staleness(profile.id);
    tonight(profile.id);
    likeSummary(profile.id);
  }
  if (tooFew.length) console.log(`\nToo few watches to judge (${MIN_WATCHES} needed): ${tooFew.join(', ')}.`);

  if (values.compare) compare(runs, path.resolve(cwd, values.compare));
  if (values.save) {
    writeFileSync(path.resolve(cwd, values.save), JSON.stringify(toSaved(runs)));
    console.log(`\nSaved each watch's result to ${path.resolve(cwd, values.save)}.`);
  }
}
