import type { ImportedProfile, PlexPinClaim, PlexPinStarted, PlexServerOption, ServerLibraries } from '@curatorr/shared';
import { z } from 'zod';
import { parse, serviceUrl, type RouteModule } from '../context.js';
import { HttpError, normalizeBaseUrl, savedKeyFor, TIMEOUT } from '../http.js';
import { RadarrClient } from '../integrations/radarr.js';
import {
  authUrl,
  checkPin,
  connectionCandidates,
  createPin,
  getAccount,
  getServers,
  PlexServerClient,
} from '../integrations/plex.js';
import { importHomeUsers } from '../services/profiles.js';
import { isAdmin, plexPinsHere, profileFor, rememberPlexPin, requireAdmin, setAdminCookie } from '../session.js';

const radarrBody = z.object({ url: serviceUrl, apiKey: z.string().min(1) });

export const setupRoutes: RouteModule = (app, { store, library }) => {
  // Everything here is open until someone signs in with Plex or connects Jellyfin, then admin-only (see isAdmin).
  const guard = (req: Parameters<typeof isAdmin>[0]) => requireAdmin(req, store);

  // ---- Radarr --------------------------------------------------------------

  app.post('/api/setup/radarr/test', async (req) => {
    guard(req);
    const body = parse(radarrBody, req.body);
    const client = new RadarrClient(body.url, body.apiKey);
    const status = await client.status();
    return { ok: true, version: status.version, name: status.instanceName ?? status.appName ?? 'Radarr' };
  });

  app.post('/api/setup/radarr', async (req) => {
    guard(req);
    const body = parse(radarrBody.extend({ apiKey: z.string().optional() }), req.body);
    // An omitted key means "keep the saved one" (the UI never sees it), for the same address only.
    const apiKey = body.apiKey || savedKeyFor(store.get('radarr'), body.url);
    if (!apiKey) throw new HttpError(400, 'Enter the API key for this address');
    const client = new RadarrClient(body.url, apiKey);
    await client.status();
    store.set('radarr', { url: normalizeBaseUrl(body.url), apiKey });
    if (store.get('setupComplete')) library.trigger();
    return { ok: true };
  });

  // ---- Plex sign-in (also used for admin login) ------------------------------

  app.post('/api/plex/pin', async (req, reply): Promise<PlexPinStarted> => {
    const { clientId } = store.get('plex');
    const pin = await createPin(clientId);
    rememberPlexPin(req, reply, pin.id);
    return { id: pin.id, code: pin.code, authUrl: authUrl(clientId, pin.code) };
  });

  app.post('/api/plex/pin/:id/claim', async (req, reply): Promise<PlexPinClaim> => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { purpose } = parse(z.object({ purpose: z.enum(['setup', 'login']) }), req.body);
    if (!plexPinsHere(req).includes(id)) throw new HttpError(404, 'Start the Plex sign-in again');
    const plex = store.get('plex');

    const token = await checkPin(plex.clientId, id);
    if (!token) return { status: 'pending' };
    const account = await getAccount(plex.clientId, token);

    if (purpose === 'login') {
      if (!plex.ownerId || account.id !== plex.ownerId) {
        throw new HttpError(403, `${account.title} is not the owner of this Curatorr instance`);
      }
      setAdminCookie(reply, store, account.id);
      return { status: 'ok', account: { name: account.title, thumb: account.thumb } };
    }

    // The owner can always sign in again, from any device. Another account needs the owner's sign-in on
    // this device (to switch accounts before setup is complete), or a Curatorr nobody has claimed yet.
    if (account.id !== plex.ownerId) {
      guard(req);
      if (plex.ownerId && store.get('setupComplete')) {
        throw new HttpError(403, 'Sign in with the same Plex account that owns this Curatorr instance');
      }
    }
    if (store.get('jellyfin')) {
      if (store.get('setupComplete')) throw new HttpError(409, 'Curatorr is set up with Jellyfin');
      // Setting up with Plex after all: Curatorr uses one media server.
      store.set('jellyfin', null);
    }
    store.update('plex', { adminToken: token, ownerId: account.id, ownerName: account.title });
    setAdminCookie(reply, store, account.id);
    return { status: 'ok', account: { name: account.title, thumb: account.thumb } };
  });

  // ---- Plex server & libraries ---------------------------------------------

  app.get('/api/setup/plex/servers', async (req): Promise<PlexServerOption[]> => {
    guard(req);
    const plex = store.get('plex');
    if (!plex.adminToken) throw new HttpError(400, 'Sign in with Plex first');
    const servers = (await getServers(plex.clientId, plex.adminToken)).filter((s) => s.owned);

    return Promise.all(
      servers.map(async (server) => {
        const candidates = connectionCandidates(server);
        const tested = await Promise.all(
          candidates.map(async (c) => {
            const started = Date.now();
            try {
              const client = new PlexServerClient(c.url, plex.clientId, server.accessToken ?? plex.adminToken!);
              await client.identity(TIMEOUT.probe);
              return { ...c, ok: true, ms: Date.now() - started };
            } catch {
              return { ...c, ok: false, ms: null };
            }
          }),
        );
        return { name: server.name, machineId: server.machineId, connections: tested };
      }),
    );
  });

  app.post('/api/setup/plex/server', async (req): Promise<ServerLibraries> => {
    guard(req);
    const body = parse(z.object({ machineId: z.string().min(1), url: serviceUrl, name: z.string().optional() }), req.body);
    const plex = store.get('plex');
    if (!plex.adminToken) throw new HttpError(400, 'Sign in with Plex first');

    const client = new PlexServerClient(body.url, plex.clientId, plex.adminToken);
    const identity = await client.identity();
    if (identity.machineId !== body.machineId) {
      throw new HttpError(400, 'That URL points to a different Plex server');
    }
    store.update('plex', {
      machineId: body.machineId,
      serverName: body.name ?? plex.serverName,
      serverUrl: client.baseUrl,
    });
    const libraries = await client.movieLibraries();
    return { ok: true, libraries };
  });

  app.get('/api/setup/plex/libraries', async (req) => {
    guard(req);
    const plex = store.get('plex');
    if (!plex.adminToken || !plex.serverUrl) throw new HttpError(400, 'Choose a Plex server first');
    const client = new PlexServerClient(plex.serverUrl, plex.clientId, plex.adminToken);
    return { libraries: await client.movieLibraries(), selected: plex.sectionIds };
  });

  app.post('/api/setup/plex/libraries', async (req) => {
    guard(req);
    const { sectionIds } = parse(z.object({ sectionIds: z.array(z.string()).min(1) }), req.body);
    store.update('plex', { sectionIds });
    if (store.get('setupComplete')) library.trigger();
    return { ok: true };
  });

  app.post('/api/setup/plex/users', async (req): Promise<ImportedProfile[]> => {
    guard(req);
    const rows = await importHomeUsers(store, req.log);
    return rows.map((r) => ({ ...profileFor(store, r), hidden: Boolean(r.hidden) }));
  });

  /** Continue without a media server: one local profile, no watch history. */
  app.post('/api/setup/server/skip', async (req) => {
    guard(req);
    // Letting the media server go would leave no owner, which opens the settings to everyone.
    if (store.get('setupComplete')) throw new HttpError(409, 'Curatorr is already set up');
    store.resetPlex();
    store.set('jellyfin', null);
    if (store.profileRows(true).length === 0) store.createLocalProfile('Me', true);
    return { ok: true };
  });

  app.post('/api/setup/complete', async (req) => {
    guard(req);
    if (!store.get('radarr')) throw new HttpError(400, 'Connect Radarr first');
    if (store.profileRows().length === 0) throw new HttpError(400, 'No profiles yet');
    store.set('setupComplete', true);
    library.trigger();
    return { ok: true };
  });
};
