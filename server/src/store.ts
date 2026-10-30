import { MARK_KINDS } from '@curatorr/shared';
import type { FeedbackEvent, FeedbackKind, MarkKind, MediaServer, Movie, Profile, RestrictionProfile } from '@curatorr/shared';
import { transaction, type DB } from './db.js';
import { DEFAULTS, GENERATED, withDefaults, type PlexSettings, type SettingKey, type Settings } from './settings.js';

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
  /** A PIN Curatorr keeps for a Jellyfin profile, scrambled (pins.ts); Plex profiles use Plex's. */
  pin_hash: string | null;
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

export class Store {
  private movieCache: StoredMovie[] | null = null;

  constructor(
    readonly db: DB,
    /** Demo mode: fixture library, no Radarr or media server, everyone is admin. */
    readonly demo = false,
  ) {}

  /**
   * Moves with every row inserted, updated or deleted through this connection, Curatorr's only one, so what's worked
   * out from the database can be kept until the next write (see `pickingFor` in services/recommend.ts).
   */
  version(): number {
    return (this.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  }

  // ---- settings -----------------------------------------------------------

  /** A setting (settings.ts), as saved or as it starts out. */
  get<K extends SettingKey>(key: K): Settings[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (row) return withDefaults(key, JSON.parse(row.value) as Settings[K]);
    const fallback = DEFAULTS[key]();
    if (GENERATED.has(key)) this.set(key, fallback);
    return fallback;
  }

  /** Puts a setting back as it starts out: a new webhook address, Seerr's requests forgotten. */
  reset(key: SettingKey) {
    this.set(key, DEFAULTS[key]());
  }

  set<K extends SettingKey>(key: K, value: Settings[K]) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  update<K extends 'plex' | 'app' | 'sync' | 'seerrSync' | 'radarrWebhook'>(key: K, patch: Partial<Settings[K]>) {
    this.set(key, { ...this.get(key), ...patch });
  }

  /** The Plex server Curatorr reads, once the owner has signed in and chosen one; null before. */
  plexConnection(): (PlexSettings & { adminToken: string; machineId: string; serverUrl: string }) | null {
    const plex = this.get('plex');
    const { adminToken, machineId, serverUrl } = plex;
    return adminToken && machineId && serverUrl ? { ...plex, adminToken, machineId, serverUrl } : null;
  }

  plexConfigured(): boolean {
    return this.plexConnection() != null;
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
    this.set('plex', { ...DEFAULTS.plex(), clientId: this.get('plex').clientId });
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

  /** The profiles shown on "Who's watching?", or every one with `includeHidden`. */
  profileRows({ includeHidden = false }: { includeHidden?: boolean } = {}): ProfileRow[] {
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

  createLocalProfile(
    name: string,
    { admin = false, restriction = null }: { admin?: boolean; restriction?: RestrictionProfile } = {},
  ): number {
    const row = this.db
      .prepare('INSERT INTO profiles (name, is_admin, restriction_profile) VALUES (?, ?, ?) RETURNING id')
      .get(name, admin ? 1 : 0, restriction) as { id: number };
    return row.id;
  }

  setProfileTokens(id: number, userToken: string | null, serverToken: string | null) {
    this.db
      .prepare('UPDATE profiles SET user_token = ?, server_token = ?, watched_synced_at = NULL WHERE id = ?')
      .run(userToken, serverToken, id);
  }

  /** Sets a PIN Curatorr keeps for the profile, already scrambled, or takes it off (null). */
  setProfilePin(id: number, pinHash: string | null) {
    this.db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(pinHash, id);
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

  /** Movies the profile watched on the media server, most recent first. */
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
    const available = this.db.prepare('INSERT OR IGNORE INTO available (profile_id, key) VALUES (?, ?)');
    transaction(this.db, () => {
      for (const table of ['watched', 'available']) {
        this.db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
      }
      for (const e of state.watched) watched.run(profileId, e.movieId, e.viewedAt);
      this.writeWatchlist(profileId, state.watchlist, syncedAt);
      for (const item of state.available) for (const key of idKeys(item)) available.run(profileId, key);
      this.db.prepare('UPDATE profiles SET watched_synced_at = ? WHERE id = ?').run(syncedAt, profileId);
    });
  }

  /**
   * The movies a Jellyfin profile can open, as of its last sync; none before one, since its library access
   * and parental controls aren't known yet. Null for other profiles.
   */
  availableMovies(row: ProfileRow): Set<number> | null {
    if (row.jellyfin_user_id == null) return null;
    if (row.watched_synced_at == null) return new Set();
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

  /** The watchlist, newest first: by when Curatorr first saw each movie there, then in the server's order. */
  watchlistEntries(profileId: number): { movieId: number; addedAt: number | null }[] {
    const rows = this.db
      .prepare(`
        SELECT movie_id, added_at FROM watchlist WHERE profile_id = ?
        ORDER BY added_at IS NULL, added_at DESC, rowid
      `)
      .all(profileId) as { movie_id: number; added_at: number | null }[];
    return rows.map((r) => ({ movieId: r.movie_id, addedAt: r.added_at }));
  }

  /** Saves the watchlist as just read, in the server's order. See `writeWatchlist`. */
  replaceWatchlist(profileId: number, movieIds: number[], at = Date.now()) {
    transaction(this.db, () => this.writeWatchlist(profileId, movieIds, at));
  }

  /** Movies still on the watchlist keep the date Curatorr first saw them there; new ones get `at`. */
  private writeWatchlist(profileId: number, movieIds: number[], at: number) {
    const keep = new Set(movieIds);
    const remove = this.db.prepare('DELETE FROM watchlist WHERE profile_id = ? AND movie_id = ?');
    for (const id of this.watchlistIds(profileId)) if (!keep.has(id)) remove.run(profileId, id);
    const insert = this.db.prepare('INSERT OR IGNORE INTO watchlist (profile_id, movie_id, added_at) VALUES (?, ?, ?)');
    for (const id of movieIds) insert.run(profileId, id, at);
  }

  /**
   * Drops the Watchlist marks of movies that were on the server's watchlist when a read began (`before`) and aren't on
   * it now (`after`). Only movies still in the library count: one Curatorr can't match any more hasn't left.
   * Returns the movies taken off. (Only while marks update the server: see `syncServerState`.)
   */
  followWatchlistRemovals(profileId: number, before: Set<number>, after: number[]): number[] {
    const still = new Set(after);
    const removed = [...before].filter((id) => !still.has(id) && this.movie(id));
    transaction(this.db, () => {
      for (const id of removed) this.deleteMarks(profileId, id, 'later');
    });
    return removed;
  }

  addToWatchlist(profileId: number, movieId: number) {
    this.db
      .prepare('INSERT OR IGNORE INTO watchlist (profile_id, movie_id, added_at) VALUES (?, ?, ?)')
      .run(profileId, movieId, Date.now());
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
      .prepare('SELECT movie_id, kind, created_at, plex_synced FROM feedback WHERE profile_id = ?')
      .all(profileId) as { movie_id: number; kind: FeedbackKind; created_at: number; plex_synced: number }[];
    return rows.map((r) => ({
      movieId: r.movie_id,
      kind: r.kind,
      createdAt: r.created_at,
      serverSynced: Boolean(r.plex_synced),
    }));
  }

  addFeedback(profileId: number, movieId: number, kind: FeedbackKind, at = Date.now()): number {
    const row = this.db
      .prepare('INSERT INTO feedback (profile_id, movie_id, kind, created_at) VALUES (?, ?, ?, ?) RETURNING id')
      .get(profileId, movieId, kind, at) as { id: number };
    return row.id;
  }

  /** A feedback row, if it belongs to one of these profiles (the device's, and anyone watching with it). */
  feedbackEntryOf(profileIds: number[], id: number) {
    const row = this.db.prepare('SELECT id, profile_id, movie_id, kind, created_at, plex_synced FROM feedback WHERE id = ?').get(id) as
      | { id: number; profile_id: number; movie_id: number; kind: FeedbackKind; created_at: number; plex_synced: number }
      | undefined;
    if (!row || !profileIds.includes(row.profile_id)) return undefined;
    return {
      id: row.id,
      profileId: row.profile_id,
      movieId: row.movie_id,
      kind: row.kind,
      createdAt: row.created_at,
      serverSynced: Boolean(row.plex_synced),
    };
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
        FROM feedback f WHERE f.profile_id = ? AND f.kind IN (${MARK_KINDS.map((k) => `'${k}'`).join(', ')})
        GROUP BY f.movie_id, f.kind
        ORDER BY createdAt DESC
      `)
      .all(profileId) as { id: number; movieId: number; kind: MarkKind; createdAt: number }[];
  }

  // ---- watching together --------------------------------------------------

  /**
   * Remembers that these profiles started playing a movie together at `at`, unless they already did since `since`
   * (still open), which then stands for both.
   */
  recordTogether(movieId: number, profileIds: number[], at: number, since: number) {
    const members = JSON.stringify([...profileIds].sort((a, b) => a - b));
    const again = this.db
      .prepare('SELECT id FROM together WHERE movie_id = ? AND profile_ids = ? AND done_at IS NULL AND started_at > ?')
      .get(movieId, members, since);
    if (!again) {
      this.db.prepare('INSERT INTO together (movie_id, profile_ids, started_at) VALUES (?, ?, ?)').run(movieId, members, at);
    }
  }

  /** Movies played together that nobody's account has shown watched yet. */
  pendingTogether(): { id: number; movieId: number; profileIds: number[]; startedAt: number }[] {
    const rows = this.db
      .prepare('SELECT id, movie_id, profile_ids, started_at FROM together WHERE done_at IS NULL ORDER BY started_at')
      .all() as { id: number; movie_id: number; profile_ids: string; started_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      movieId: r.movie_id,
      profileIds: JSON.parse(r.profile_ids) as number[],
      startedAt: r.started_at,
    }));
  }

  closeTogether(id: number, at = Date.now()) {
    this.db.prepare('UPDATE together SET done_at = ? WHERE id = ?').run(at, id);
  }

  /** Deletes the shown picks and skips from before `before`. */
  pruneFeedback(before: number) {
    this.db.prepare("DELETE FROM feedback WHERE kind IN ('shown', 'skipped') AND created_at < ?").run(before);
  }
}


interface Ids {
  tmdbId: number | null;
  imdbId: string | null;
}

/** A movie's TMDB and IMDb ids as keys of the `available` table. */
export const idKeys = (m: Ids) => [...(m.tmdbId != null ? [`tmdb:${m.tmdbId}`] : []), ...(m.imdbId ? [`imdb:${m.imdbId}`] : [])];

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

/** A profile as the app sees it. `pinProtected` comes from `hasPin` (session.ts), which knows the media server. */
export function toProfile(r: ProfileRow, pinProtected: boolean): Profile {
  return {
    id: r.id,
    name: r.name,
    avatarUrl: r.avatar_url,
    isAdmin: Boolean(r.is_admin),
    restrictionProfile: (r.restriction_profile as RestrictionProfile) ?? null,
    pinProtected,
    // Jellyfin users need no token of their own: Curatorr reads their history with the administrator's.
    linked: Boolean(r.server_token) || r.jellyfin_user_id != null,
  };
}
