import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError, normalizeBaseUrl } from '../http.js';
import { SeerrClient } from '../integrations/seerr.js';
import { syncRequests } from '../services/requests.js';
import { clearAdminCookie, requireAdmin } from '../session.js';
import { toProfile } from '../store.js';

export const settingsRoutes: RouteModule = (app, { store, library }) => {
  app.get('/api/settings', async (req) => {
    requireAdmin(req, store);
    const radarr = store.get('radarr');
    const plex = store.get('plex');
    const seerr = store.get('seerr');
    return {
      radarr: radarr ? { url: radarr.url, hasApiKey: Boolean(radarr.apiKey) } : null,
      seerr: seerr ? { url: seerr.url, hasApiKey: Boolean(seerr.apiKey), ...store.get('seerrSync') } : null,
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
        boostRequests: z.boolean().optional(),
        syncIntervalHours: z.number().int().min(1).max(168).optional(),
      }),
      req.body,
    );
    store.update('app', patch);
    return store.get('app');
  });

  /** Connects Seerr, or changes the connection, then reads the requests straight away. */
  app.put('/api/settings/seerr', async (req) => {
    requireAdmin(req, store);
    const body = parse(z.object({ url: z.string().min(1), apiKey: z.string().optional() }), req.body);
    // An omitted key means "keep the saved one" (the UI never sees it).
    const apiKey = body.apiKey || store.get('seerr')?.apiKey;
    if (!apiKey) throw new HttpError(400, 'API key is required');
    await new SeerrClient(body.url, apiKey).me();
    store.set('seerr', { url: normalizeBaseUrl(body.url), apiKey });
    await syncRequests(store, req.log);
    return store.get('seerrSync');
  });

  app.delete('/api/settings/seerr', async (req) => {
    requireAdmin(req, store);
    store.set('seerr', null);
    store.replaceRequests([]);
    store.set('seerrSync', { at: null, requests: 0, profiles: 0, error: null });
    return { ok: true };
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
