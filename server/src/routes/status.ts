import type { AppStatus } from '@curatorr/shared';
import { config } from '../config.js';
import type { RouteModule } from '../context.js';
import { syncServerState } from '../services/mediaServer.js';
import { updateFor } from '../services/updates.js';
import { currentGroup, isAdmin, profileFor, togetherUntil } from '../session.js';

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
    const admin = isAdmin(req, store);
    // A sync error names Radarr's or the media server's address, which only the owner needs to see.
    const lastError = sync.error && (admin ? sync.error : 'The last library sync failed');
    return {
      version: config.version,
      // Only an admin can update the container, so only they hear about a new release.
      update: admin ? updateFor(config.version, store.get('latestVersion')) : null,
      setupComplete: store.get('setupComplete'),
      demo: store.demo,
      server: store.mediaServer(),
      isAdmin: admin,
      profile: profile ? profileFor(store, profile) : null,
      together: together.map((r) => profileFor(store, r)),
      library: { movies: store.movies().length, lastSync: sync.at, syncing: library.syncing, lastError },
      turnover: togetherUntil(Date.now()),
    };
  });
};
