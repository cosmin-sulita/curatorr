import { chmodSync, existsSync, mkdirSync } from 'node:fs';
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
  // v4: sagas (Radarr/TMDB collections), to keep sequels in order.
  `
  ALTER TABLE movies ADD COLUMN saga_id INTEGER;
  ALTER TABLE movies ADD COLUMN saga_title TEXT;
  ALTER TABLE movies ADD COLUMN saga_part INTEGER;
  ALTER TABLE movies ADD COLUMN saga_parts INTEGER;
  -- Forget the last sync so the library is re-read (with collections) on the next start.
  UPDATE settings SET value = json_set(value, '$.at', NULL) WHERE key = 'sync';
  `,
  // v5: Seerr requests in the library, per profile, so picks can favour them.
  `
  CREATE TABLE requests (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL,
    requested_at INTEGER,
    PRIMARY KEY (profile_id, movie_id)
  );
  `,
  // v6: when each movie's file arrived, for the new-arrival bonus. Radarr's added date is when the
  // movie was requested, often months before its release. (rt_votes is no longer read: Radarr never
  // fills it. It stays so an older version still runs against this database.)
  `
  ALTER TABLE movies ADD COLUMN arrived_at TEXT;    -- import date of the first file seen; upgrades keep it
  -- Forget the last sync so the library is re-read (with file dates) on the next start.
  UPDATE settings SET value = json_set(value, '$.at', NULL) WHERE key = 'sync';
  `,
  // v7: settings named after Plex now cover any media server. (`->` keeps true and false as JSON booleans.)
  `
  UPDATE settings SET value = json_remove(json_set(value, '$.syncToServer', value -> '$.syncToPlex'), '$.syncToPlex')
    WHERE key = 'app' AND json_type(value, '$.syncToPlex') IS NOT NULL;
  UPDATE settings SET value = json_remove(json_set(value, '$.matched', value -> '$.matchedInPlex'), '$.matchedInPlex')
    WHERE key = 'sync' AND json_type(value, '$.matchedInPlex') IS NOT NULL;
  `,
  // v8: Jellyfin, as the alternative to Plex.
  `
  ALTER TABLE movies ADD COLUMN jellyfin_id TEXT;          -- the movie's item id in Jellyfin
  ALTER TABLE profiles ADD COLUMN jellyfin_user_id TEXT;   -- the Jellyfin user the profile stands for
  CREATE UNIQUE INDEX profiles_jellyfin_user ON profiles (jellyfin_user_id);

  -- The movies each Jellyfin profile can open (its library access and parental controls), as
  -- tmdb:<id> and imdb:<id> keys, so they don't depend on when the library was last synced.
  CREATE TABLE available (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    PRIMARY KEY (profile_id, key)
  );
  `,
  // v9: movies a group started playing together, so the others get it marked watched once one of
  // their accounts shows it watched.
  `
  CREATE TABLE together (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER NOT NULL,
    profile_ids TEXT NOT NULL,          -- JSON array of the members
    started_at INTEGER NOT NULL,
    done_at INTEGER
  );
  CREATE INDEX together_pending ON together (done_at);
  `,
  // v10: when each movie went on a profile's media server watchlist, as far as Curatorr knows, so Settings can list
  // the watchlist newest first.
  `
  ALTER TABLE watchlist ADD COLUMN added_at INTEGER;  -- first seen there, or put there by Curatorr; NULL before v10
  `,
  // v11: a PIN Curatorr keeps for a Jellyfin profile (Jellyfin has none), set by an administrator in Settings.
  `
  ALTER TABLE profiles ADD COLUMN pin_hash TEXT;  -- scrypt, never the PIN itself (pins.ts); NULL for none
  `,
];

export function openDb(configDir: string, fileName = 'curatorr.db'): DB {
  mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, fileName);
  const db = new DatabaseSync(file);
  // It holds the media server's tokens and the API keys, so only Curatorr's user may read it, also outside
  // Docker (where the entrypoint sees to it). SQLite gives the -wal and -shm files it makes the database's mode.
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      if (existsSync(f)) chmodSync(f, 0o600);
    } catch {
      // A folder that can't change modes, like some network shares, keeps what it has.
    }
  }
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
