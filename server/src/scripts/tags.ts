/**
 * Tagging report: how well the theme and mood vocabulary fits a real library.
 *
 *   npm run tags                      reads config/curatorr.db, a copy of the server's database
 *   npm run tags -- --db <file>       reads another copy
 *   npm run tags -- --movie heat      shows why matching movies get, or miss, each tag
 *   npm run tags -- --tag animals     lists the movies a theme or mood gains, loses and keeps
 *   npm run tags -- --limit 100       makes the lists longer
 *
 * "Stored" tags are the ones in the database, written by the version that last synced it, so the
 * report shows what the working copy's vocabulary changes. The database is only read.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import {
  IGNORED_KEYWORDS,
  MOODS,
  THEMES,
  explainTags,
  inVocabulary,
  moodById,
  qualityScore,
  themeById,
  type TagEvidence,
  type TagExplanations,
} from '@curatorr/shared';
import { config } from '../config.js';
import { readMovies, type StoredMovie } from '../store.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    movie: { type: 'string' },
    tag: { type: 'string' },
    limit: { type: 'string', default: '25' },
  },
});

const file = values.db
  ? path.resolve(process.env.INIT_CWD ?? process.cwd(), values.db)
  : path.join(config.configDir, 'curatorr.db');
if (!existsSync(file)) {
  console.error(`No database at ${file}.`);
  console.error("Copy curatorr.db (with its -wal and -shm files) from Curatorr's config folder, or pass --db <file>.");
  process.exit(1);
}
const limit = Number(values.limit) || 25;

type Kind = 'themes' | 'moods';

interface Row {
  movie: StoredMovie;
  explained: Record<Kind, TagExplanations>;
  now: Record<Kind, string[]>;
  stored: Record<Kind, string[]>;
}

const taggedIds = (e: TagExplanations) => Object.keys(e).filter((id) => e[id]!.tagged);

const rows: Row[] = readMovies(new DatabaseSync(file, { readOnly: true })).map((movie) => {
  const explained = explainTags(movie);
  return {
    movie,
    explained,
    now: { themes: taggedIds(explained.themes), moods: taggedIds(explained.moods) },
    stored: { themes: Object.keys(movie.themes), moods: Object.keys(movie.moods) },
  };
});

const label = (id: string) => themeById.get(id)?.label ?? moodById.get(id)?.label ?? id;
const name = (m: StoredMovie) => (m.year ? `${m.title} (${m.year})` : m.title);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const percent = (n: number) => `${Math.round((n / Math.max(rows.length, 1)) * 100)}%`;
const byQuality = (a: Row, b: Row) => qualityScore(b.movie.ratings) - qualityScore(a.movie.ratings);
const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
const summary = (m: StoredMovie) => `${name(m)} · ${m.genres.join(', ') || 'no genres'} · ${m.keywords.length} keywords`;
/** Lowercase without accents, so "amelie" finds "Amélie". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function heading(text: string) {
  console.log(`\n${text}`);
}

function list<T>(items: T[], show: (item: T) => string) {
  for (const item of items.slice(0, limit)) console.log(`  ${show(item)}`);
  if (items.length > limit) console.log(`  … and ${items.length - limit} more (--limit)`);
}

/** Joins items with " · ", wrapping lines at about 110 characters. */
function wrap(items: string[], indent = '  ', width = 110): string {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    const next = line ? `${line} · ${item}` : item;
    if (line && indent.length + next.length > width) {
      lines.push(indent + line);
      line = item;
    } else {
      line = next;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

function describe(e: TagEvidence) {
  if (e.source === 'keyword') {
    return e.keyword === e.term ? `${e.term} ${signed(e.weight)}` : `${e.term} ← "${e.keyword}" ${signed(e.weight)}`;
  }
  if (e.source === 'overview') return `plot "${e.term}" ${signed(e.weight)}`;
  return `${e.term} ${signed(e.weight)}`;
}

// ---------------------------------------------------------------------------
// --movie: the evidence behind each tag
// ---------------------------------------------------------------------------

function explainMovie(row: Row) {
  const m = row.movie;
  console.log(`\n${summary(m)} · ${m.runtime ?? '?'} min`);
  if (m.keywords.length) console.log(wrap(m.keywords));
  for (const kind of ['themes', 'moods'] as const) {
    console.log(`  ${kind === 'themes' ? 'Themes' : 'Moods'}`);
    const explained = row.explained[kind];
    const ids = Object.keys(explained).sort(
      (a, b) =>
        Number(explained[b]!.tagged) - Number(explained[a]!.tagged) || explained[b]!.score - explained[a]!.score,
    );
    for (const id of ids) {
      const e = explained[id]!;
      const was = row.stored[kind].includes(id);
      const change = e.tagged === was ? '' : e.tagged ? '  (new)' : '  (dropped)';
      const evidence = e.evidence.map(describe).join(' · ');
      console.log(`    ${e.tagged ? '✓' : '·'} ${label(id).padEnd(26)}${String(e.score).padStart(5)}  ${evidence}${change}`);
    }
    for (const id of row.stored[kind]) {
      if (!(id in explained)) console.log(`    · ${label(id).padEnd(26)}    0  (dropped)`);
    }
    if (!ids.length && !row.stored[kind].length) console.log('    nothing');
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function keywordHealth() {
  const counts = rows.map((r) => r.movie.keywords.length).sort((a, b) => a - b);
  const none = counts.filter((n) => n === 0).length;
  const few = counts.filter((n) => n > 0 && n < 5).length;
  console.log(`${rows.length} movies in ${file}`);
  console.log(
    `Keywords per movie: median ${counts[Math.floor(counts.length / 2)] ?? 0}. ` +
      `${none} have none and ${few} more have fewer than 5, so their plot is read as well.`,
  );
  if (none > rows.length * 0.05) {
    console.log('That is a lot without keywords: in Radarr, Movies → Update All refreshes their TMDB metadata.');
  }
}

function coverage() {
  const count = (side: 'now' | 'stored', test: (tags: Record<Kind, string[]>) => boolean) =>
    rows.filter((r) => test(r[side])).length;
  const line = (text: string, test: (tags: Record<Kind, string[]>) => boolean) => {
    const [now, stored] = [percent(count('now', test)), percent(count('stored', test))];
    console.log(`  ${text.padEnd(22)}${now.padStart(5)}${stored.padStart(8)}`);
  };
  heading(`${'Coverage'.padEnd(24)}  now  stored`);
  line('with a theme', (t) => t.themes.length > 0);
  line('with a mood', (t) => t.moods.length > 0);
  line('with both', (t) => t.themes.length > 0 && t.moods.length > 0);
}

function tagCounts(kind: Kind) {
  const ids = new Set([
    ...(kind === 'themes' ? THEMES : MOODS).map((d) => d.id),
    ...rows.flatMap((r) => r.stored[kind]),
  ]);
  const counts = [...ids].map((id) => ({
    id,
    now: rows.filter((r) => r.now[kind].includes(id)).length,
    stored: rows.filter((r) => r.stored[kind].includes(id)).length,
  }));
  counts.sort((a, b) => b.now - a.now || a.id.localeCompare(b.id));
  heading(`${(kind === 'themes' ? 'Themes' : 'Moods').padEnd(28)}  now  stored`);
  for (const c of counts) {
    const delta = c.now === c.stored ? '' : `  ${signed(c.now - c.stored)}`;
    console.log(`  ${label(c.id).padEnd(28)}${String(c.now).padStart(5)}${String(c.stored).padStart(8)}${delta}`);
  }
}

function changes() {
  const diff = (now: string[], stored: string[]) => [
    ...now.filter((id) => !stored.includes(id)).map((id) => `+${label(id)}`),
    ...stored.filter((id) => !now.includes(id)).map((id) => `−${label(id)}`),
  ];
  const changed = rows
    .map((r) => ({ r, themes: diff(r.now.themes, r.stored.themes), moods: diff(r.now.moods, r.stored.moods) }))
    .filter((c) => c.themes.length || c.moods.length)
    .sort((a, b) => byQuality(a.r, b.r));
  heading(`Changed from the stored tags (${changed.length} movies), best rated first`);
  list(changed, (c) => {
    const themes = c.themes.length ? ` · themes ${c.themes.join(', ')}` : '';
    const moods = c.moods.length ? ` · moods ${c.moods.join(', ')}` : '';
    return `${name(c.r.movie)}${themes}${moods}`;
  });
}

function untagged(kind: Kind) {
  const missing = rows.filter((r) => !r.now[kind].length).sort(byQuality);
  heading(`No ${kind === 'themes' ? 'theme' : 'mood'} (${missing.length} movies), best rated first`);
  list(missing, (r) => summary(r.movie));
}

function unmatchedKeywords(title: string, subset: Row[]) {
  const counts = new Map<string, number>();
  for (const r of subset) {
    for (const k of new Set(r.movie.keywords)) {
      if (!IGNORED_KEYWORDS.has(k) && !inVocabulary(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const top = [...counts].sort(byCount).slice(0, limit * 2);
  heading(title);
  console.log(top.length ? wrap(top.map(([k, n]) => `${k} ${n}`)) : '  none');
}

function partialMatches() {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const explained of [r.explained.themes, r.explained.moods]) {
      for (const [id, e] of Object.entries(explained)) {
        if (!e.tagged) continue;
        for (const ev of e.evidence) {
          if (ev.source !== 'keyword' || ev.weight <= 0 || ev.keyword === ev.term) continue;
          const key = `${ev.term} ← "${ev.keyword}" → ${label(id)}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  heading('Terms found inside a longer keyword that helped tag a movie (check these for idioms)');
  list([...counts].sort(byCount), ([key, n]) => `${String(n).padStart(4)}  ${key}`);
}

/** The movies one theme or mood gains, loses and keeps compared with the stored tags. */
function tagMovies(id: string) {
  const kind: Kind | null = themeById.has(id) ? 'themes' : moodById.has(id) ? 'moods' : null;
  if (!kind) {
    console.log(`No theme or mood "${id}". Ids: ${[...themeById.keys(), ...moodById.keys()].join(', ')}`);
    return;
  }
  const now = rows.filter((r) => r.now[kind].includes(id)).sort(byQuality);
  const stored = new Set(rows.filter((r) => r.stored[kind].includes(id)));
  const show = (r: Row) => {
    const evidence = r.explained[kind][id]?.evidence.map(describe).join(' · ');
    return `${name(r.movie)} · ${evidence || 'no evidence'}`;
  };
  console.log(`${label(id)}: ${now.length} movies now, ${stored.size} stored`);
  heading('Gained');
  list(now.filter((r) => !stored.has(r)), show);
  heading('Lost');
  list([...stored].filter((r) => !now.includes(r)).sort(byQuality), show);
  heading('Kept');
  list(now.filter((r) => stored.has(r)), show);
}

if (values.movie) {
  const query = fold(values.movie);
  const found = rows.filter((r) => fold(r.movie.title).includes(query));
  if (!found.length) console.log(`No movie title contains "${values.movie}".`);
  found.slice(0, limit).forEach(explainMovie);
} else if (values.tag) {
  tagMovies(values.tag);
} else {
  keywordHealth();
  coverage();
  tagCounts('themes');
  tagCounts('moods');
  changes();
  untagged('themes');
  untagged('moods');
  unmatchedKeywords('Keywords no term matches, most common first', rows);
  unmatchedKeywords('… among movies without a theme', rows.filter((r) => !r.now.themes.length));
  unmatchedKeywords('… among movies without a mood', rows.filter((r) => !r.now.moods.length));
  partialMatches();
}
