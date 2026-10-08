import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const migrations: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE movies (
    id INTEGER PRIMARY KEY,               -- Radarr movie id
    tmdb_id INTEGER,
    imdb_id TEXT,
    title TEXT NOT NULL,
    year INTEGER,
    overview TEXT NOT NULL DEFAULT '',
    runtime INTEGER,
    certification TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '[]',
    themes TEXT NOT NULL DEFAULT '{}',
    moods TEXT NOT NULL DEFAULT '{}',
    rt REAL,
    rt_votes INTEGER,
    imdb REAL,
    tmdb REAL,
    metacritic REAL,
    poster_url TEXT,
    fanart_url TEXT,
    poster_path TEXT,                     -- Radarr MediaCover path, for the proxy fallback
    fanart_path TEXT,
    trailer_id TEXT,
    plex_rating_key TEXT,
    added_at TEXT,
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX movies_tmdb ON movies (tmdb_id);
  CREATE INDEX movies_imdb ON movies (imdb_id);

  CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plex_user_id INTEGER UNIQUE,
    plex_uuid TEXT,
    name TEXT NOT NULL,
    avatar_url TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    restriction_profile TEXT,
    pin_protected INTEGER NOT NULL DEFAULT 0,
    user_token TEXT,
    server_token TEXT,
    watched_synced_at INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE watched (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL,
    viewed_at INTEGER,
    PRIMARY KEY (profile_id, movie_id)
  );

  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX feedback_profile ON feedback (profile_id, created_at);
  `,
  // v2: watch.plex.tv slug, used to open a movie in the redesigned Plex mobile apps.
  `
  ALTER TABLE movies ADD COLUMN plex_slug TEXT;
  `,
  // v3: two-way Plex sync. "Seen it" marks watched in Plex, "Later" uses the Plex Watchlist.
  `
  ALTER TABLE movies ADD COLUMN plex_guid TEXT;     -- id from the item's plex://movie/<id> guid
  ALTER TABLE feedback ADD COLUMN plex_synced INTEGER NOT NULL DEFAULT 0;  -- Curatorr changed Plex for this

  CREATE TABLE watchlist (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL,
    PRIMARY KEY (profile_id, movie_id)
  );
  `,
];

export function openDb(configDir: string, fileName = 'curatorr.db'): DB {
  mkdirSync(configDir, { recursive: true });
  const db = new DatabaseSync(path.join(configDir, fileName));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
