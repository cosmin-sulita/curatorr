import { UpstreamError } from '../http.js';
import { PlexServerClient, type PlexItem } from '../integrations/plex.js';
import type { Store } from '../store.js';

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
