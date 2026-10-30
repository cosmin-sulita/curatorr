import type { FastifyBaseLogger } from 'fastify';
import { matchRequests, SeerrClient } from '../integrations/seerr.js';
import type { Store } from '../store.js';

/**
 * Reads every movie request from Seerr and keeps the ones now in the library, per profile.
 * Never throws: a failure is recorded in settings and the last good requests are kept.
 */
export async function syncRequests(store: Store, log: FastifyBaseLogger) {
  const seerr = store.get('seerr');
  if (!seerr) return;
  try {
    const client = new SeerrClient(seerr.url, seerr.apiKey);
    const [users, requests] = await Promise.all([client.users(), client.movieRequests()]);
    const entries = matchRequests(store.profileRows({ includeHidden: true }), store.movies(), users, requests);
    store.replaceRequests(entries);
    const profiles = new Set(entries.map((e) => e.profileId)).size;
    store.set('seerrSync', { at: Date.now(), requests: entries.length, profiles, error: null });
    log.info({ requests: requests.length, inLibrary: entries.length, profiles }, 'Seerr requests synced');
  } catch (err) {
    store.update('seerrSync', { error: err instanceof Error ? err.message : String(err) });
    log.warn({ err }, 'Seerr request sync failed');
  }
}
