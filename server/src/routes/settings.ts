import type { SettingsResponse } from '@curatorr/shared';
import { z } from 'zod';
import { parse, serviceUrl, type RouteModule } from '../context.js';
import { HttpError, normalizeBaseUrl, savedKeyFor } from '../http.js';
import { SeerrClient } from '../integrations/seerr.js';
import { syncRequests } from '../services/requests.js';
import {
  adminId,
  clearAdminCookie,
  newSessionEpoch,
  requireAdmin,
  setAdminCookie,
  setUnlocks,
  unlocksHere,
} from '../session.js';
import { toProfile } from '../store.js';

export const settingsRoutes: RouteModule = (app, { store, library }) => {
  app.get('/api/settings', async (req): Promise<SettingsResponse> => {
    requireAdmin(req, store);
    const radarr = store.get('radarr');
    const plex = store.get('plex');
    const jellyfin = store.get('jellyfin');
    const seerr = store.get('seerr');
    return {
      server: store.mediaServer(),
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
      // Never the token.
      jellyfin: jellyfin && {
        url: jellyfin.url,
        publicUrl: jellyfin.publicUrl,
        serverName: jellyfin.serverName,
        ownerName: jellyfin.ownerName,
        libraryIds: jellyfin.libraryIds,
      },
      app: store.get('app'),
      sync: { ...store.get('sync'), syncing: library.syncing },
      // The secret in the address Radarr calls; only the owner sees it.
      webhook: store.get('radarrWebhook'),
      profiles: store.profileRows(true).map((r) => ({
        ...toProfile(r),
        hidden: Boolean(r.hidden),
        serverUser: r.plex_user_id != null || r.jellyfin_user_id != null,
      })),
    };
  });

  app.put('/api/settings/app', async (req) => {
    requireAdmin(req, store);
    const patch = parse(
      z.object({
        includeWatched: z.boolean().optional(),
        syncToServer: z.boolean().optional(),
        boostRequests: z.boolean().optional(),
        syncIntervalHours: z.number().int().min(1).max(168).optional(),
      }),
      req.body,
    );
    store.update('app', patch);
    return store.get('app');
  });

  /** Connects Seerr, or changes the connection, then reads the requests straight away once set up. */
  app.put('/api/settings/seerr', async (req) => {
    requireAdmin(req, store);
    const body = parse(z.object({ url: serviceUrl, apiKey: z.string().optional() }), req.body);
    // An omitted key means "keep the saved one" (the UI never sees it), for the same address only.
    const apiKey = body.apiKey || savedKeyFor(store.get('seerr'), body.url);
    if (!apiKey) throw new HttpError(400, 'Enter the API key for this address');
    await new SeerrClient(body.url, apiKey).me();
    store.set('seerr', { url: normalizeBaseUrl(body.url), apiKey });
    // During setup the library is still empty; the first library sync reads the requests.
    if (store.get('setupComplete')) await syncRequests(store, req.log);
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

  /**
   * Signs every other device out of settings, and makes them ask for the PINs entered on them again: for a PIN or a
   * sign-in that got out. This device stays as it was.
   */
  app.post('/api/settings/sign-out-everywhere', async (req, reply) => {
    requireAdmin(req, store);
    // Read before the change, to carry them over to this device's new cookies.
    const account = adminId(req, store);
    const unlocks = unlocksHere(req, store);
    store.set('sessionEpoch', newSessionEpoch());
    if (account) setAdminCookie(reply, store, account);
    setUnlocks(req, reply, store, unlocks);
    return { ok: true };
  });
};
