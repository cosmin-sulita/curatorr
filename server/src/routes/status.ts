import type { AppStatus } from '@curatorr/shared';
import { config } from '../config.js';
import type { RouteModule } from '../context.js';
import { currentProfile, isAdmin } from '../session.js';
import { toProfile } from '../store.js';

export const statusRoutes: RouteModule = (app, { store, library }) => {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/status', async (req): Promise<AppStatus> => {
    const sync = store.get('sync');
    const profile = currentProfile(req, store);
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
