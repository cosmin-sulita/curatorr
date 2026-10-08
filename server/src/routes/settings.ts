import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { clearAdminCookie, requireAdmin } from '../session.js';
import { toProfile } from '../store.js';

export const settingsRoutes: RouteModule = (app, { store, library }) => {
  app.get('/api/settings', async (req) => {
    requireAdmin(req, store);
    const radarr = store.get('radarr');
    const plex = store.get('plex');
    return {
      radarr: radarr ? { url: radarr.url, hasApiKey: Boolean(radarr.apiKey) } : null,
      plex: {
        signedIn: Boolean(plex.adminToken),
        ownerName: plex.ownerName,
        serverName: plex.serverName,
        serverUrl: plex.serverUrl,
        machineId: plex.machineId,
        sectionIds: plex.sectionIds,
      },
      app: store.get('app'),
      sync: { ...store.get('sync'), syncing: library.syncing },
      profiles: store.profileRows(true).map((r) => ({
        ...toProfile(r),
        hidden: Boolean(r.hidden),
        plexUser: r.plex_user_id != null,
      })),
    };
  });

  app.put('/api/settings/app', async (req) => {
    requireAdmin(req, store);
    const patch = parse(
      z.object({
        includeWatched: z.boolean().optional(),
        syncToPlex: z.boolean().optional(),
        syncIntervalHours: z.number().int().min(1).max(168).optional(),
      }),
      req.body,
    );
    store.update('app', patch);
    return store.get('app');
  });

  app.post('/api/sync', async (req) => {
    requireAdmin(req, store);
    library.trigger();
    return { ok: true };
  });

  app.post('/api/admin/logout', async (_req, reply) => {
    clearAdminCookie(reply);
    return { ok: true };
  });
};
