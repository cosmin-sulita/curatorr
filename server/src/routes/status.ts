import type { AppStatus } from '@curatorr/shared';
import { config } from '../config.js';
import type { RouteModule } from '../context.js';
import { syncServerState } from '../services/mediaServer.js';
import { currentGroup, isAdmin } from '../session.js';
import { toProfile } from '../store.js';

export const statusRoutes: RouteModule = (app, { store, library }) => {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/status', async (req): Promise<AppStatus> => {
    const sync = store.get('sync');
    // The device's profile, then anyone watching with it tonight.
    const [profile, ...together] = currentGroup(req, store);
    // The profile cookie outlives a session, so picking a profile isn't the only time to catch up
    // with the media server: refresh a stale watch history in the background whenever the app opens.
    for (const row of [profile, ...together]) {
      if (!row) continue;
      syncServerState(store, row, req.log).catch((err) => req.log.warn({ err }, 'media server state sync failed'));
    }
    return {
      version: config.version,
      setupComplete: store.get('setupComplete'),
      demo: store.demo,
      server: store.mediaServer(),
      isAdmin: isAdmin(req, store),
      profile: profile ? toProfile(profile) : null,
      together: together.map(toProfile),
      library: { movies: store.movies().length, lastSync: sync.at, syncing: library.syncing, lastError: sync.error },
    };
  });
};
