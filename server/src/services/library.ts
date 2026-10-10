import { tagMovie } from '@curatorr/shared';
import type { FastifyBaseLogger } from 'fastify';
import { assignSagas, fromRadarr, RadarrClient } from '../integrations/radarr.js';
import { PlexServerClient, type PlexItem } from '../integrations/plex.js';
import type { StoredMovie, Store } from '../store.js';
import { syncRequests } from './requests.js';

interface Ids {
  tmdbId: number | null;
  imdbId: string | null;
}

/** A media server's items by TMDB and IMDb id, to find the one for each Radarr movie. */
export interface IdIndex<T> {
  byTmdb: Map<number, T>;
  byImdb: Map<string, T>;
}

export function indexByIds<T extends Ids>(items: T[]): IdIndex<T> {
  const byTmdb = new Map<number, T>();
  const byImdb = new Map<string, T>();
  for (const item of items) {
    if (item.tmdbId != null) byTmdb.set(item.tmdbId, item);
    if (item.imdbId) byImdb.set(item.imdbId, item);
  }
  return { byTmdb, byImdb };
}

export function findByIds<T>(index: IdIndex<T>, m: Ids): T | undefined {
  return (m.tmdbId != null ? index.byTmdb.get(m.tmdbId) : undefined) ?? (m.imdbId ? index.byImdb.get(m.imdbId) : undefined);
}

export async function fetchPlexItems(store: Store, token: string): Promise<PlexItem[]> {
  const plex = store.get('plex');
  if (!plex.serverUrl) return [];
  const client = new PlexServerClient(plex.serverUrl, plex.clientId, token);
  const all: PlexItem[] = [];
  for (const section of plex.sectionIds) all.push(...(await client.movies(section)));
  return all;
}

export class LibrarySync {
  syncing = false;
  /** Asked to sync during a sync: settings may have changed under it, so it runs once more. */
  private again = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Pulls the Radarr library, re-tags it and links each movie to its Plex item. */
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
      const movies: StoredMovie[] = raw.filter((m) => m.hasFile).map(fromRadarr);
      // Collections give each saga's full part list; without them only owned parts are counted.
      const collections = await client.collections().catch((err) => {
        this.log.warn({ err }, 'could not read Radarr collections; numbering owned parts only');
        return null;
      });
      assignSagas(movies, collections);

      let matched = 0;
      const plex = this.store.get('plex');
      if (this.store.plexConfigured()) {
        const items = await fetchPlexItems(this.store, plex.adminToken!);
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

      this.store.replaceMovies(movies, startedAt);
      this.store.set('sync', { at: startedAt, movies: movies.length, matched, error: null });
      this.log.info({ movies: movies.length, matched, ms: Date.now() - startedAt }, 'library synced');
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

  /** Checks every 10 minutes whether the configured sync interval has elapsed. */
  schedule() {
    const tick = () => {
      if (this.syncing || !this.store.get('setupComplete')) return;
      const { at } = this.store.get('sync');
      const intervalMs = this.store.get('app').syncIntervalHours * 60 * 60 * 1000;
      // Movies synced by an older version lack Plex ids that newer features rely on.
      const outdated = this.store.movies().some((m) => m.plexRatingKey && m.plexGuid == null);
      if (!at || Date.now() - at >= intervalMs || outdated) this.trigger();
    };
    tick();
    this.timer = setInterval(tick, 10 * 60 * 1000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
