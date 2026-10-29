import { UpstreamError } from '../http.js';
import { PlexServerClient, type PlexItem } from '../integrations/plex.js';
import type { StoredMovie, Store } from '../store.js';

/** Id lookups happen while the picks load, so keep them short. */
const ID_LOOKUP_MS = 2_500;
/** After the Plex server couldn't be reached, picks skip the lookups for this long. */
const LOOKUP_PAUSE_MS = 60_000;
const lookupsPausedUntil = new WeakMap<Store, number>();

/**
 * The movies in Curatorr's Plex libraries, as the token's user sees them. With `sharedOnly`, libraries Plex
 * refuses that user are left out: the owner needn't share every library with everyone at home.
 */
export async function fetchPlexItems(store: Store, token: string, { sharedOnly = false } = {}): Promise<PlexItem[]> {
  const plex = store.get('plex');
  if (!plex.serverUrl) return [];
  const client = new PlexServerClient(plex.serverUrl, plex.clientId, token);
  const all: PlexItem[] = [];
  for (const section of plex.sectionIds) {
    try {
      all.push(...(await client.movies(section)));
    } catch (err) {
      if (!(sharedOnly && err instanceof UpstreamError && err.status === 403)) throw err;
    }
  }
  return all;
}

/** A movie's watch.plex.tv slug and Plex guid id: '' when Plex has none (legacy agents), null when not known yet. */
export type PlexIds = Pick<StoredMovie, 'plexSlug' | 'plexGuid'>;

/**
 * Fills in the watch.plex.tv slug and Plex guid id when the library listing didn't include them, asking the Plex server
 * for each item's full metadata, and answers each movie's ids as known now. Results are stored, so each movie is looked
 * up at most once; failures are retried next time.
 */
export async function ensurePlexIds(store: Store, movies: StoredMovie[]): Promise<Map<number, PlexIds>> {
  const ids = new Map<number, PlexIds>(movies.map((m) => [m.id, { plexSlug: m.plexSlug, plexGuid: m.plexGuid }]));
  const plex = store.plexConnection();
  if (!plex || Date.now() < (lookupsPausedUntil.get(store) ?? 0)) return ids;
  const missing = movies.filter((m) => m.plexRatingKey && (m.plexSlug == null || m.plexGuid == null));
  if (!missing.length) return ids;

  const client = new PlexServerClient(plex.serverUrl, plex.clientId, plex.adminToken);
  await Promise.all(
    missing.map(async (m) => {
      try {
        const item = await client.item(m.plexRatingKey!, ID_LOOKUP_MS);
        const found = { slug: item?.slug ?? m.plexSlug ?? '', guid: item?.plexGuid ?? m.plexGuid ?? '' };
        store.setPlexIds(m.id, found);
        ids.set(m.id, { plexSlug: found.slug, plexGuid: found.guid });
      } catch (err) {
        // Item gone or server unreachable: keep it unknown and try again later. An unreachable
        // server would make every list of picks wait for the lookups, so stop asking for a while.
        if (!(err instanceof UpstreamError && err.status)) lookupsPausedUntil.set(store, Date.now() + LOOKUP_PAUSE_MS);
      }
    }),
  );
  return ids;
}
