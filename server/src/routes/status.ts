import type { AppStatus } from '@curatorr/shared';
import { config } from '../config.js';
import type { RouteModule } from '../context.js';
import { syncPlexState } from '../services/profiles.js';
import { currentProfile, isAdmin } from '../session.js';
import { toProfile } from '../store.js';

export const statusRoutes: RouteModule = (app, { store, library }) => {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/status', async (req): Promise<AppStatus> => {
    const sync = store.get('sync');
    const profile = currentProfile(req, store);
    // The profile cookie outlives a session, so picking a profile isn't the only time to catch
    // up with Plex: refresh a stale watch history in the background whenever the app opens.
    if (profile) {
      syncPlexState(store, profile, req.log).catch((err) => req.log.warn({ err }, 'plex state sync failed'));
    }
    return {
      version: config.version,
      setupComplete: store.get('setupComplete'),
      demo: store.demo,
      plexConfigured: store.plexConfigured(),
      isAdmin: isAdmin(req, store),
      profile: profile ? toProfile(profile) : null,
      library: { movies: store.movies().length, lastSync: sync.at, syncing: library.syncing, lastError: sync.error },
    };
  });
};
