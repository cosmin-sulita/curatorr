import { onServer, tagMovie } from '@curatorr/shared';
import type { FastifyBaseLogger } from 'fastify';
import { assignSagas, fromRadarr, RadarrClient } from '../integrations/radarr.js';
import { JellyfinClient } from '../integrations/jellyfin.js';
import type { StoredMovie, Store } from '../store.js';
import { findByIds, indexByIds } from './matching.js';
import { refreshProfiles } from './mediaServer.js';
import { fetchPlexItems } from './plexLibrary.js';
import { syncRequests } from './requests.js';

/** Radarr reports an import before Plex or Jellyfin has scanned the file, so its webhook syncs this much later. */
const WEBHOOK_SYNC_DELAY_MS = 2 * 60 * 1000;
/** A movie that arrived this recently and isn't on the media server yet makes the scheduler sync again. */
const AWAIT_SERVER_MS = 60 * 60 * 1000;

export class LibrarySync {
  syncing = false;
  /** Asked to sync during a sync: settings may have changed under it, so it runs once more. */
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  /** A sync Radarr's webhook asked for, waiting for the media server to catch up. */
  private soon: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Pulls the Radarr library, re-tags it and links each movie to its item on the media server. */
  async run(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return;
    }
    const radarr = this.store.get('radarr');
    if (!radarr) return;

    this.syncing = true;
    const startedAt = Date.now();
    try {
      const client = new RadarrClient(radarr.url, radarr.apiKey);
      const raw = await client.movies();
      // Movies whose genres, keywords, plot and runtime haven't changed keep their tags: tagging is the slow part.
      const stored = new Map(this.store.movies().map((m) => [m.id, m]));
      const movies: StoredMovie[] = raw.filter((m) => m.hasFile).map((m) => fromRadarr(m, stored.get(m.id)));
      // Collections give each saga's full part list; without them only owned parts are counted.
      const collections = await client.collections().catch((err) => {
        this.log.warn({ err }, 'could not read Radarr collections; numbering owned parts only');
        return null;
      });
      assignSagas(movies, collections);

      let matched = 0;
      const server = this.store.mediaServer();
      const plex = this.store.plexConnection();
      if (server === 'plex' && plex) {
        const items = await fetchPlexItems(this.store, plex.adminToken);
        const index = indexByIds(items);
        for (const m of movies) {
          const item = findByIds(index, m);
          if (item) {
            m.plexRatingKey = item.ratingKey;
            m.plexSlug = item.slug;
            // Listings always carry the guid, so "none" here is final (legacy agent).
            m.plexGuid = item.plexGuid ?? '';
            matched++;
          }
        }
      }
      const jellyfin = this.store.get('jellyfin');
      if (server === 'jellyfin' && jellyfin) {
        const client = JellyfinClient.connected(jellyfin);
        const items = (await Promise.all(jellyfin.libraryIds.map((libraryId) => client.movies({ libraryId })))).flat();
        const index = indexByIds(items);
        for (const m of movies) {
          const item = findByIds(index, m);
          if (item) {
            m.jellyfinId = item.id;
            matched++;
          }
        }
      }

      this.store.replaceMovies(movies, startedAt);
      this.store.set('sync', { at: startedAt, movies: movies.length, matched, error: null });
      this.log.info({ movies: movies.length, matched, ms: Date.now() - startedAt }, 'library synced');
      // A PIN, a parental limit or an administrator's rights may have changed on the media server since.
      await refreshProfiles(this.store, this.log).catch((err) => this.log.warn({ err }, 'could not refresh profiles'));
      // Requested movies only show up once they're in the library, so read requests after it.
      await syncRequests(this.store, this.log);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.update('sync', { error: message });
      this.log.error({ err }, 'library sync failed');
      throw err;
    } finally {
      this.syncing = false;
      if (this.again) {
        this.again = false;
        this.trigger();
      }
    }
  }

  /**
   * Re-derives the stored movies' themes and moods from their genres, keywords and overview, so a
   * new vocabulary applies as soon as Curatorr restarts instead of at the next library sync.
   */
  retag(): number {
    const changed = this.store.movies().flatMap((m) => {
      const tags = tagMovie(m);
      const same = JSON.stringify([tags.themes, tags.moods]) === JSON.stringify([m.themes, m.moods]);
      return same ? [] : [{ id: m.id, ...tags }];
    });
    if (changed.length) {
      this.store.updateTags(changed);
      this.log.info({ movies: changed.length }, 're-tagged movies for the current vocabulary');
    }
    return changed.length;
  }

  /** Runs `run()` in the background, swallowing errors (they are recorded in settings). */
  trigger() {
    this.run().catch(() => {});
  }

  /** Syncs once Plex or Jellyfin has had time to scan a new file. A burst of calls makes one sync. */
  syncSoon() {
    if (this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      this.trigger();
    }, WEBHOOK_SYNC_DELAY_MS);
    this.soon.unref();
  }

  /** Whether the scheduler should sync now. */
  syncDue(now = Date.now()): boolean {
    const { at } = this.store.get('sync');
    const intervalMs = this.store.get('app').syncIntervalHours * 60 * 60 * 1000;
    // Movies synced by an older version lack Plex ids that newer features rely on.
    const outdated = this.store.movies().some((m) => m.plexRatingKey && m.plexGuid == null);
    return !at || now - at >= intervalMs || outdated || this.awaitingServer(now);
  }

  /**
   * A movie arrived in the last hour, but the media server, which has the others, hasn't added it yet.
   * A sync right after an import can come before the server's scan, and picks only offer what it has.
   */
  private awaitingServer(now: number): boolean {
    const server = this.store.mediaServer();
    const movies = this.store.movies();
    if (!server || !movies.some((m) => onServer(m, server))) return false;
    return movies.some((m) => !onServer(m, server) && Date.parse(m.arrivedAt ?? '') > now - AWAIT_SERVER_MS);
  }

  /** Checks every 10 minutes whether a sync is due. */
  schedule() {
    const tick = () => {
      if (this.syncing || !this.store.get('setupComplete')) return;
      if (this.syncDue()) this.trigger();
    };
    tick();
    this.timer = setInterval(tick, 10 * 60 * 1000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.soon = null;
  }
}
