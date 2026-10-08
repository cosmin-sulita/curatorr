import type { FastifyBaseLogger } from 'fastify';
import { fromRadarr, RadarrClient } from '../integrations/radarr.js';
import { PlexServerClient, type PlexItem } from '../integrations/plex.js';
import type { StoredMovie, Store } from '../store.js';

export interface PlexIndex {
  byTmdb: Map<number, PlexItem>;
  byImdb: Map<string, PlexItem>;
}

export function indexPlexItems(items: PlexItem[]): PlexIndex {
  const byTmdb = new Map<number, PlexItem>();
  const byImdb = new Map<string, PlexItem>();
  for (const item of items) {
    if (item.tmdbId != null) byTmdb.set(item.tmdbId, item);
    if (item.imdbId) byImdb.set(item.imdbId, item);
  }
  return { byTmdb, byImdb };
}

export function findPlexItem(index: PlexIndex, m: { tmdbId: number | null; imdbId: string | null }) {
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
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Pulls the Radarr library, re-tags it and links each movie to its Plex item. */
  async run(): Promise<void> {
    if (this.syncing) return;
    const radarr = this.store.get('radarr');
    if (!radarr) return;

    this.syncing = true;
    const startedAt = Date.now();
    try {
      const client = new RadarrClient(radarr.url, radarr.apiKey);
      const raw = await client.movies();
      const movies: StoredMovie[] = raw.filter((m) => m.hasFile).map(fromRadarr);

      let matched = 0;
      const plex = this.store.get('plex');
      if (this.store.plexConfigured()) {
        const items = await fetchPlexItems(this.store, plex.adminToken!);
        const index = indexPlexItems(items);
        for (const m of movies) {
          const item = findPlexItem(index, m);
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
      this.store.set('sync', { at: startedAt, movies: movies.length, matchedInPlex: matched, error: null });
      this.log.info({ movies: movies.length, matchedInPlex: matched, ms: Date.now() - startedAt }, 'library synced');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.update('sync', { error: message });
      this.log.error({ err }, 'library sync failed');
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  /** Runs `run()` in the background, swallowing errors (they are recorded in settings). */
  trigger() {
    this.run().catch(() => {});
  }

  /** Checks every 10 minutes whether the configured sync interval has elapsed. */
  schedule() {
    const tick = () => {
      if (!this.store.get('setupComplete')) return;
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
