import { randomBytes, randomUUID } from 'node:crypto';
import type { FeedbackEvent, FeedbackKind, MediaServer, Movie, Profile, RestrictionProfile } from '@curatorr/shared';
import { transaction, type DB } from './db.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface RadarrSettings {
  url: string;
  apiKey: string;
}

export interface PlexSettings {
  clientId: string;
  adminToken: string | null;
  ownerId: number | null;
  ownerName: string | null;
  machineId: string | null;
  serverName: string | null;
  serverUrl: string | null;
  sectionIds: string[];
}

export interface JellyfinSettings {
  /** Where Curatorr reaches Jellyfin. */
  url: string;
  /** Where people open Jellyfin, for Watch on Jellyfin, when that's another address. */
  publicUrl: string | null;
  serverId: string;
  serverName: string;
  /** Curatorr's device in Jellyfin, which keeps one token per device and user. */
  deviceId: string;
  /** The token of the administrator who connected Curatorr; it reads and marks every user's movies. */
  token: string;
  /** That administrator, who owns Curatorr's settings as the Plex owner does. */
  ownerId: string;
  ownerName: string;
  /** The libraries that hold the Radarr movies. */
  libraryIds: string[];
}

export interface SeerrSettings {
  url: string;
  apiKey: string;
}

export interface AppSettings {
  includeWatched: boolean;
  syncIntervalHours: number;
  /** "Seen it" marks the movie watched on the media server; "Watchlist" adds it to the server's watchlist. */
  syncToServer: boolean;
  /** Unwatched Seerr requests rank higher for whoever made them. */
  boostRequests: boolean;
}

export interface SyncInfo {
  at: number | null;
  movies: number;
  /** Library movies found on the media server. */
  matched: number;
  error: string | null;
}

/** The last read of Seerr: requested movies found in the library, and for how many profiles. */
export interface RequestSyncInfo {
  at: number | null;
  requests: number;
  profiles: number;
  error: string | null;
}

interface SettingsShape {
  setupComplete: boolean;
  cookieSecret: string;
  radarr: RadarrSettings | null;
  plex: PlexSettings;
  jellyfin: JellyfinSettings | null;
  app: AppSettings;
  sync: SyncInfo;
  seerr: SeerrSettings | null;
  seerrSync: RequestSyncInfo;
}

const defaults = (): SettingsShape => ({
  setupComplete: false,
  cookieSecret: randomBytes(32).toString('hex'),
  radarr: null,
  plex: {
    clientId: randomUUID(),
    adminToken: null,
    ownerId: null,
    ownerName: null,
    machineId: null,
    serverName: null,
    serverUrl: null,
    sectionIds: [],
  },
  jellyfin: null,
  app: { includeWatched: false, syncIntervalHours: 6, syncToServer: true, boostRequests: true },
  sync: { at: null, movies: 0, matched: 0, error: null },
  seerr: null,
  seerrSync: { at: null, requests: 0, profiles: 0, error: null },
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface MovieRow {
  id: number;
  tmdb_id: number | null;
  imdb_id: string | null;
  title: string;
  year: number | null;
  overview: string;
  runtime: number | null;
  certification: string | null;
  genres: string;
  keywords: string;
  themes: string;
  moods: string;
  rt: number | null;
  imdb: number | null;
  tmdb: number | null;
  metacritic: number | null;
  poster_url: string | null;
  fanart_url: string | null;
  poster_path: string | null;
  fanart_path: string | null;
  trailer_id: string | null;
  plex_rating_key: string | null;
  plex_slug: string | null;
  plex_guid: string | null;
  jellyfin_id: string | null;
  saga_id: number | null;
  saga_title: string | null;
  saga_part: number | null;
  saga_parts: number | null;
  added_at: string | null;
  arrived_at: string | null;
}

export interface ProfileRow {
  id: number;
  plex_user_id: number | null;
  plex_uuid: string | null;
  /** The Jellyfin user the profile stands for. */
  jellyfin_user_id: string | null;
  name: string;
  avatar_url: string | null;
  is_admin: number;
  restriction_profile: string | null;
  pin_protected: number;
  user_token: string | null;
  server_token: string | null;
  watched_synced_at: number | null;
  hidden: number;
  sort_order: number;
}

/** A movie plus the Radarr MediaCover paths used by the image proxy. */
export interface StoredMovie extends Movie {
  posterPath: string | null;
  fanartPath: string | null;
}

const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export class Store {
  private movieCache: StoredMovie[] | null = null;

  constructor(
    readonly db: DB,
    /** Demo mode: fixture library, no Radarr/Plex, everyone is admin. */
    readonly demo = false,
  ) {
    this.pruneFeedback();
  }

  // ---- settings -----------------------------------------------------------

  get<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    const fallback = defaults()[key];
    if (row) {
      const stored = JSON.parse(row.value) as SettingsShape[K];
      // Settings saved by an older version lack newer keys: fill them from the defaults.
      return isPlainObject(stored) && isPlainObject(fallback)
        ? (Object.assign({}, fallback, stored) as SettingsShape[K])
        : stored;
    }
    // Persist generated defaults (secrets, client id) so they stay stable.
    if (key === 'cookieSecret' || key === 'plex') this.set(key, fallback);
    return fallback;
  }

  set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  update<K extends 'plex' | 'app' | 'sync' | 'seerrSync'>(key: K, patch: Partial<SettingsShape[K]>) {
    this.set(key, { ...this.get(key), ...patch });
  }

  plexConfigured(): boolean {
    const plex = this.get('plex');
    return Boolean(plex.adminToken && plex.machineId && plex.serverUrl);
  }

  /** The media server Curatorr uses, or is being set up with. Connecting one lets the other go. */
  mediaServer(): MediaServer | null {
    if (this.get('plex').adminToken) return 'plex';
    return this.get('jellyfin') ? 'jellyfin' : null;
  }

  /** Who owns Curatorr's settings: the Plex owner, or the Jellyfin administrator who connected it. */
  owner(): { server: MediaServer; id: string } | null {
    const { ownerId } = this.get('plex');
    if (ownerId) return { server: 'plex', id: String(ownerId) };
    const jellyfin = this.get('jellyfin');
    return jellyfin ? { server: 'jellyfin', id: jellyfin.ownerId } : null;
  }

  /** Forgets the Plex sign-in, server and libraries; keeps the client id Plex knows Curatorr by. */
  resetPlex() {
    this.set('plex', { ...defaults().plex, clientId: this.get('plex').clientId });
  }

  // ---- movies -------------------------------------------------------------

  movies(): StoredMovie[] {
    if (!this.movieCache) this.movieCache = readMovies(this.db);
    return this.movieCache;
  }

  movie(id: number): StoredMovie | undefined {
    return this.movies().find((m) => m.id === id);
  }

  /** Replaces the whole library in one transaction. */
  replaceMovies(movies: StoredMovie[], syncedAt: number) {
    const upsert = this.db.prepare(`
      INSERT INTO movies (id, tmdb_id, imdb_id, title, year, overview, runtime, certification, genres, keywords,
        themes, moods, rt, imdb, tmdb, metacritic, poster_url, fanart_url, poster_path, fanart_path,
        trailer_id, plex_rating_key, plex_slug, plex_guid, jellyfin_id, saga_id, saga_title, saga_part, saga_parts,
        added_at, arrived_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        tmdb_id = excluded.tmdb_id, imdb_id = excluded.imdb_id, title = excluded.title, year = excluded.year,
        overview = excluded.overview, runtime = excluded.runtime, certification = excluded.certification,
        genres = excluded.genres, keywords = excluded.keywords, themes = excluded.themes, moods = excluded.moods,
        rt = excluded.rt, imdb = excluded.imdb, tmdb = excluded.tmdb,
        metacritic = excluded.metacritic, poster_url = excluded.poster_url, fanart_url = excluded.fanart_url,
        poster_path = excluded.poster_path, fanart_path = excluded.fanart_path, trailer_id = excluded.trailer_id,
        plex_rating_key = excluded.plex_rating_key, jellyfin_id = excluded.jellyfin_id, added_at = excluded.added_at,
        synced_at = excluded.synced_at,
        saga_id = excluded.saga_id, saga_title = excluded.saga_title, saga_part = excluded.saga_part,
        saga_parts = excluded.saga_parts,
        -- Keep ids looked up earlier when the library listing doesn't include them.
        plex_slug = COALESCE(excluded.plex_slug, movies.plex_slug),
        plex_guid = COALESCE(excluded.plex_guid, movies.plex_guid),
        -- An upgrade brings a new file, but the movie arrived with the first. (One whose file is
        -- deleted leaves the table, so a new download later counts as a new arrival.)
        arrived_at = COALESCE(MIN(movies.arrived_at, excluded.arrived_at), movies.arrived_at, excluded.arrived_at)
    `);
    transaction(this.db, () => {
      for (const m of movies) {
        upsert.run(
          m.id, m.tmdbId, m.imdbId, m.title, m.year, m.overview, m.runtime, m.certification,
          JSON.stringify(m.genres), JSON.stringify(m.keywords), JSON.stringify(m.themes), JSON.stringify(m.moods),
          m.ratings.rt, m.ratings.imdb, m.ratings.tmdb, m.ratings.metacritic,
          m.posterUrl, m.fanartUrl, m.posterPath, m.fanartPath, m.trailerId, m.plexRatingKey, m.plexSlug,
          m.plexGuid, m.jellyfinId, m.saga?.id ?? null, m.saga?.title ?? null, m.saga?.part ?? null, m.saga?.parts ?? null,
          m.addedAt, m.arrivedAt, syncedAt,
        );
      }
      this.db.prepare('DELETE FROM movies WHERE synced_at <> ?').run(syncedAt);
    });
    this.movieCache = null;
  }

  /** Rewrites movies' themes and moods, for a vocabulary that changed since the last sync. */
  updateTags(movies: Pick<Movie, 'id' | 'themes' | 'moods'>[]) {
    const update = this.db.prepare('UPDATE movies SET themes = ?, moods = ? WHERE id = ?');
    transaction(this.db, () => {
      for (const m of movies) update.run(JSON.stringify(m.themes), JSON.stringify(m.moods), m.id);
    });
    this.movieCache = null;
  }

  /** Records Plex ids looked up on demand ('' when Plex has none). */
  setPlexIds(id: number, ids: { slug: string; guid: string }) {
    this.db.prepare('UPDATE movies SET plex_slug = ?, plex_guid = ? WHERE id = ?').run(ids.slug, ids.guid, id);
    const cached = this.movieCache?.find((m) => m.id === id);
    if (cached) {
      cached.plexSlug = ids.slug;
      cached.plexGuid = ids.guid;
    }
  }

  // ---- profiles -----------------------------------------------------------

  profileRows(includeHidden = false): ProfileRow[] {
    const sql = `SELECT * FROM profiles ${includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY is_admin DESC, sort_order, name`;
    return this.db.prepare(sql).all() as unknown as ProfileRow[];
  }

  profileRow(id: number): ProfileRow | undefined {
    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as unknown as ProfileRow | undefined;
  }

  upsertPlexProfile(p: {
    plexUserId: number;
    plexUuid: string | null;
    name: string;
    avatarUrl: string | null;
    isAdmin: boolean;
    restrictionProfile: RestrictionProfile;
    pinProtected: boolean;
  }): number {
    const row = this.db
      .prepare(`
        INSERT INTO profiles (plex_user_id, plex_uuid, name, avatar_url, is_admin, restriction_profile, pin_protected)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (plex_user_id) DO UPDATE SET
          plex_uuid = excluded.plex_uuid, name = excluded.name, avatar_url = excluded.avatar_url,
          is_admin = excluded.is_admin, restriction_profile = excluded.restriction_profile,
          pin_protected = excluded.pin_protected
        RETURNING id
      `)
      .get(p.plexUserId, p.plexUuid, p.name, p.avatarUrl, p.isAdmin ? 1 : 0, p.restrictionProfile, p.pinProtected ? 1 : 0) as {
      id: number;
    };
    return row.id;
  }

  /** Creates or refreshes a Jellyfin user's profile. Whether it's hidden stays Curatorr's choice. */
  upsertJellyfinProfile(p: {
    jellyfinUserId: string;
    name: string;
    avatarUrl: string | null;
    isAdmin: boolean;
    restrictionProfile: RestrictionProfile;
  }): number {
    const row = this.db
      .prepare(`
        INSERT INTO profiles (jellyfin_user_id, name, avatar_url, is_admin, restriction_profile)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (jellyfin_user_id) DO UPDATE SET
          name = excluded.name, avatar_url = excluded.avatar_url, is_admin = excluded.is_admin,
          restriction_profile = excluded.restriction_profile
        RETURNING id
      `)
      .get(p.jellyfinUserId, p.name, p.avatarUrl, p.isAdmin ? 1 : 0, p.restrictionProfile) as { id: number };
    return row.id;
  }

  jellyfinProfile(userId: string): ProfileRow | undefined {
    const row = this.db.prepare('SELECT * FROM profiles WHERE jellyfin_user_id = ?').get(userId);
    return row as unknown as ProfileRow | undefined;
  }

  /** Whether a Jellyfin user was an administrator when Curatorr last read their profile. */
  isJellyfinAdmin(userId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM profiles WHERE jellyfin_user_id = ? AND is_admin = 1').get(userId));
  }

  createLocalProfile(name: string, isAdmin: boolean, restriction: RestrictionProfile = null): number {
    const row = this.db
      .prepare('INSERT INTO profiles (name, is_admin, restriction_profile) VALUES (?, ?, ?) RETURNING id')
      .get(name, isAdmin ? 1 : 0, restriction) as { id: number };
    return row.id;
  }

  setProfileTokens(id: number, userToken: string | null, serverToken: string | null) {
    this.db
      .prepare('UPDATE profiles SET user_token = ?, server_token = ?, watched_synced_at = NULL WHERE id = ?')
      .run(userToken, serverToken, id);
  }

  setProfileHidden(id: number, hidden: boolean) {
    this.db.prepare('UPDATE profiles SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  }

  removeProfilesNotIn(plexUserIds: number[]) {
    const placeholders = plexUserIds.map(() => '?').join(',') || 'NULL';
    this.db
      .prepare(`DELETE FROM profiles WHERE plex_user_id IS NOT NULL AND plex_user_id NOT IN (${placeholders})`)
      .run(...plexUserIds);
  }

  /** Drops every profile that isn't one of these Jellyfin users: local, Plex, and users Jellyfin no longer has. */
  keepOnlyJellyfinProfiles(userIds: string[]) {
    const placeholders = userIds.map(() => '?').join(',') || 'NULL';
    this.db
      .prepare(`DELETE FROM profiles WHERE jellyfin_user_id IS NULL OR jellyfin_user_id NOT IN (${placeholders})`)
      .run(...userIds);
  }

  /** Drops profiles that are not backed by Plex: local ones, and Jellyfin's (used when Plex gets connected). */
  removeLocalProfiles() {
    this.db.prepare('DELETE FROM profiles WHERE plex_user_id IS NULL').run();
  }

  // ---- watched ------------------------------------------------------------

  watchedIds(profileId: number): Set<number> {
    const rows = this.db.prepare('SELECT movie_id FROM watched WHERE profile_id = ?').all(profileId) as {
      movie_id: number;
    }[];
    return new Set(rows.map((r) => r.movie_id));
  }

  /** Movies the profile watched in Plex, most recent first. */
  watchHistory(profileId: number): { movieId: number; viewedAt: number | null }[] {
    const rows = this.db
      .prepare('SELECT movie_id, viewed_at FROM watched WHERE profile_id = ? ORDER BY viewed_at DESC')
      .all(profileId) as { movie_id: number; viewed_at: number | null }[];
    return rows.map((r) => ({ movieId: r.movie_id, viewedAt: r.viewed_at }));
  }

  replaceWatched(profileId: number, entries: { movieId: number; viewedAt: number | null }[], syncedAt: number) {
    const insert = this.db.prepare('INSERT OR REPLACE INTO watched (profile_id, movie_id, viewed_at) VALUES (?, ?, ?)');
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM watched WHERE profile_id = ?').run(profileId);
      for (const e of entries) insert.run(profileId, e.movieId, e.viewedAt);
      this.db.prepare('UPDATE profiles SET watched_synced_at = ? WHERE id = ?').run(syncedAt, profileId);
    });
  }

  addWatched(profileId: number, movieId: number, at = Date.now()) {
    this.db.prepare('INSERT OR REPLACE INTO watched (profile_id, movie_id, viewed_at) VALUES (?, ?, ?)').run(profileId, movieId, at);
  }

  removeWatched(profileId: number, movieId: number) {
    this.db.prepare('DELETE FROM watched WHERE profile_id = ? AND movie_id = ?').run(profileId, movieId);
  }

  /**
   * Saves what a Jellyfin profile watched, its favourites (its watchlist) and the movies it can open,
   * all read at once.
   */
  replaceJellyfinState(
    profileId: number,
    state: { watched: { movieId: number; viewedAt: number | null }[]; watchlist: number[]; available: Ids[] },
    syncedAt: number,
  ) {
    const watched = this.db.prepare('INSERT OR REPLACE INTO watched (profile_id, movie_id, viewed_at) VALUES (?, ?, ?)');
    const watchlist = this.db.prepare('INSERT OR IGNORE INTO watchlist (profile_id, movie_id) VALUES (?, ?)');
    const available = this.db.prepare('INSERT OR IGNORE INTO available (profile_id, key) VALUES (?, ?)');
    transaction(this.db, () => {
      for (const table of ['watched', 'watchlist', 'available']) {
        this.db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
      }
      for (const e of state.watched) watched.run(profileId, e.movieId, e.viewedAt);
      for (const movieId of state.watchlist) watchlist.run(profileId, movieId);
      for (const item of state.available) for (const key of idKeys(item)) available.run(profileId, key);
      this.db.prepare('UPDATE profiles SET watched_synced_at = ? WHERE id = ?').run(syncedAt, profileId);
    });
  }

  /** The movies a Jellyfin profile can open, as of its last sync; null for other profiles, or before one. */
  availableMovies(row: ProfileRow): Set<number> | null {
    if (row.jellyfin_user_id == null || row.watched_synced_at == null) return null;
    const rows = this.db.prepare('SELECT key FROM available WHERE profile_id = ?').all(row.id) as { key: string }[];
    const keys = new Set(rows.map((r) => r.key));
    return new Set(this.movies().flatMap((m) => (idKeys(m).some((k) => keys.has(k)) ? [m.id] : [])));
  }

  // ---- watchlist: the Plex Watchlist or Jellyfin favourites (cached per profile)

  watchlistIds(profileId: number): Set<number> {
    const rows = this.db.prepare('SELECT movie_id FROM watchlist WHERE profile_id = ?').all(profileId) as {
      movie_id: number;
    }[];
    return new Set(rows.map((r) => r.movie_id));
  }

  replaceWatchlist(profileId: number, movieIds: number[]) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO watchlist (profile_id, movie_id) VALUES (?, ?)');
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM watchlist WHERE profile_id = ?').run(profileId);
      for (const id of movieIds) insert.run(profileId, id);
    });
  }

  addToWatchlist(profileId: number, movieId: number) {
    this.db.prepare('INSERT OR IGNORE INTO watchlist (profile_id, movie_id) VALUES (?, ?)').run(profileId, movieId);
  }

  removeFromWatchlist(profileId: number, movieId: number) {
    this.db.prepare('DELETE FROM watchlist WHERE profile_id = ? AND movie_id = ?').run(profileId, movieId);
  }

  // ---- Seerr requests (cached for every profile) ---------------------------

  requestedIds(profileId: number): Set<number> {
    const rows = this.db.prepare('SELECT movie_id FROM requests WHERE profile_id = ?').all(profileId) as {
      movie_id: number;
    }[];
    return new Set(rows.map((r) => r.movie_id));
  }

  /** Movies the other profiles requested. */
  requestedByOthers(profileId: number): Set<number> {
    const rows = this.db.prepare('SELECT DISTINCT movie_id FROM requests WHERE profile_id <> ?').all(profileId) as {
      movie_id: number;
    }[];
    return new Set(rows.map((r) => r.movie_id));
  }

  replaceRequests(entries: { profileId: number; movieId: number; requestedAt: number | null }[]) {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO requests (profile_id, movie_id, requested_at) VALUES (?, ?, ?)',
    );
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM requests').run();
      for (const e of entries) insert.run(e.profileId, e.movieId, e.requestedAt);
    });
  }

  // ---- feedback -----------------------------------------------------------

  feedback(profileId: number): FeedbackEvent[] {
    const rows = this.db
      .prepare('SELECT movie_id, kind, created_at FROM feedback WHERE profile_id = ?')
      .all(profileId) as { movie_id: number; kind: FeedbackKind; created_at: number }[];
    return rows.map((r) => ({ movieId: r.movie_id, kind: r.kind, createdAt: r.created_at }));
  }

  addFeedback(profileId: number, movieId: number, kind: FeedbackKind, at = Date.now()): number {
    const row = this.db
      .prepare('INSERT INTO feedback (profile_id, movie_id, kind, created_at) VALUES (?, ?, ?, ?) RETURNING id')
      .get(profileId, movieId, kind, at) as { id: number };
    return row.id;
  }

  feedbackEntry(profileId: number, id: number) {
    const row = this.db
      .prepare('SELECT id, movie_id, kind, plex_synced FROM feedback WHERE id = ? AND profile_id = ?')
      .get(id, profileId) as { id: number; movie_id: number; kind: FeedbackKind; plex_synced: number } | undefined;
    return row && { id: row.id, movieId: row.movie_id, kind: row.kind, serverSynced: Boolean(row.plex_synced) };
  }

  /**
   * Marks that Curatorr changed the media server for this event, so Undo knows to change it back.
   * (The column is named from when Plex was the only one.)
   */
  setFeedbackSynced(id: number) {
    this.db.prepare('UPDATE feedback SET plex_synced = 1 WHERE id = ?').run(id);
  }

  /**
   * Removes every "seen" / "never" / "later" mark of one kind for a movie (the same movie can
   * be marked on several nights) and reports whether any of them had changed the media server.
   */
  deleteMarks(profileId: number, movieId: number, kind: FeedbackKind): { deleted: number; serverSynced: boolean } {
    return transaction(this.db, () => {
      const { synced } = this.db
        .prepare('SELECT COALESCE(MAX(plex_synced), 0) AS synced FROM feedback WHERE profile_id = ? AND movie_id = ? AND kind = ?')
        .get(profileId, movieId, kind) as { synced: number };
      const res = this.db
        .prepare('DELETE FROM feedback WHERE profile_id = ? AND movie_id = ? AND kind = ?')
        .run(profileId, movieId, kind);
      return { deleted: Number(res.changes), serverSynced: Boolean(synced) };
    });
  }

  deleteFeedback(profileId: number, id: number): boolean {
    const res = this.db.prepare('DELETE FROM feedback WHERE id = ? AND profile_id = ?').run(id, profileId);
    return Number(res.changes) > 0;
  }

  /** Movies marked "seen", "never" or saved for "later", for the settings screen. */
  markedMovies(profileId: number) {
    return this.db
      .prepare(`
        SELECT MAX(f.id) AS id, f.movie_id AS movieId, f.kind, MAX(f.created_at) AS createdAt
        FROM feedback f WHERE f.profile_id = ? AND f.kind IN ('seen', 'never', 'later')
        GROUP BY f.movie_id, f.kind
        ORDER BY createdAt DESC
      `)
      .all(profileId) as { id: number; movieId: number; kind: 'seen' | 'never' | 'later'; createdAt: number }[];
  }

  /** Shows and skips only matter for a while. Plays started from Curatorr are kept: they're part of a profile's taste. */
  private pruneFeedback() {
    this.db
      .prepare("DELETE FROM feedback WHERE kind IN ('shown', 'skipped') AND created_at < ?")
      .run(Date.now() - FEEDBACK_RETENTION_MS);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

interface Ids {
  tmdbId: number | null;
  imdbId: string | null;
}

/** A movie's TMDB and IMDb ids as keys of the `available` table. */
const idKeys = (m: Ids) => [...(m.tmdbId != null ? [`tmdb:${m.tmdbId}`] : []), ...(m.imdbId ? [`imdb:${m.imdbId}`] : [])];

/** The whole library as stored, by title. Also used by the tagging report, which opens a copy read-only. */
export function readMovies(db: DB): StoredMovie[] {
  const rows = db.prepare('SELECT * FROM movies ORDER BY title').all() as unknown as MovieRow[];
  return rows.map(rowToMovie);
}

function rowToMovie(r: MovieRow): StoredMovie {
  return {
    id: r.id,
    tmdbId: r.tmdb_id,
    imdbId: r.imdb_id,
    title: r.title,
    year: r.year,
    overview: r.overview,
    runtime: r.runtime,
    certification: r.certification,
    genres: JSON.parse(r.genres),
    keywords: JSON.parse(r.keywords),
    themes: JSON.parse(r.themes),
    moods: JSON.parse(r.moods),
    ratings: { rt: r.rt, imdb: r.imdb, tmdb: r.tmdb, metacritic: r.metacritic },
    posterUrl: r.poster_url,
    fanartUrl: r.fanart_url,
    posterPath: r.poster_path,
    fanartPath: r.fanart_path,
    trailerId: r.trailer_id,
    plexRatingKey: r.plex_rating_key,
    plexSlug: r.plex_slug,
    plexGuid: r.plex_guid,
    // Copies of databases from before v8, read by the reports, don't have the column.
    jellyfinId: r.jellyfin_id ?? null,
    saga:
      r.saga_id != null && r.saga_part
        ? { id: r.saga_id, title: r.saga_title ?? '', part: r.saga_part, parts: r.saga_parts ?? r.saga_part }
        : null,
    addedAt: r.added_at,
    // Copies of databases from before v6, read by the reports, don't have the column.
    arrivedAt: r.arrived_at ?? null,
  };
}

export function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    avatarUrl: r.avatar_url,
    isAdmin: Boolean(r.is_admin),
    restrictionProfile: (r.restriction_profile as RestrictionProfile) ?? null,
    pinProtected: Boolean(r.pin_protected),
    // Jellyfin users need no token of their own: Curatorr reads their history with the administrator's.
    linked: Boolean(r.server_token) || r.jellyfin_user_id != null,
  };
}
