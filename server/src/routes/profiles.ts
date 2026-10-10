import { z } from 'zod';
import { parse, within, type RouteModule } from '../context.js';
import { Guesses } from '../guesses.js';
import { HttpError } from '../http.js';
import { syncServerState } from '../services/mediaServer.js';
import { linkProfile, verifyPin } from '../services/profiles.js';
import { clearProfileCookie, pinNeededHere, rememberPin, requireAdmin, setProfileCookie } from '../session.js';
import { toProfile } from '../store.js';

/** How long selecting a profile waits for its watch history before moving on. */
const WATCHED_WAIT_MS = 8_000;

export const profileRoutes: RouteModule = (app, { store }) => {
  const wrongPins = new Guesses();

  app.get('/api/profiles', async (req) =>
    store.profileRows().map((r) => ({ ...toProfile(r), locked: pinNeededHere(req, store, r) })),
  );

  app.post('/api/profiles/:id/select', async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { pin } = parse(z.object({ pin: z.string().max(8).optional() }).default({}), req.body ?? {});

    let row = store.profileRow(id);
    if (!row || row.hidden) throw new HttpError(404, 'Profile not found');

    const wait = pin ? wrongPins.wait(id) : null;
    if (wait) throw new HttpError(429, `Too many wrong PINs. Try again in ${wait}`, { needPin: true });
    try {
      // A protected profile needs its PIN once on each device, also after it's linked.
      if (pinNeededHere(req, store, row)) {
        await verifyPin(store, row, pin);
        rememberPin(req, reply, row.id);
      }
      if (store.plexConfigured() && row.plex_user_id != null && !row.server_token) {
        row = await linkProfile(store, row, pin);
      }
    } catch (err) {
      if (pin && err instanceof HttpError && err.details?.needPin) wrongPins.miss(id);
      throw err;
    }
    if (pin) wrongPins.hit(id);

    setProfileCookie(reply, row.id);
    await within(syncServerState(store, row, req.log), WATCHED_WAIT_MS);
    return toProfile(row);
  });

  app.post('/api/profiles/logout', async (_req, reply) => {
    clearProfileCookie(reply);
    return { ok: true };
  });

  app.patch('/api/profiles/:id', async (req) => {
    requireAdmin(req, store);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { hidden } = parse(z.object({ hidden: z.boolean() }), req.body);
    const row = store.profileRow(id);
    if (!row) throw new HttpError(404, 'Profile not found');
    if (hidden) {
      // The Plex owner always shows. A Jellyfin administrator may be an account nobody watches with.
      if (row.is_admin && row.jellyfin_user_id == null) throw new HttpError(400, "The owner's profile can't be hidden");
      if (!store.profileRows().some((p) => p.id !== id)) {
        throw new HttpError(400, "Keep at least one profile on Who's watching");
      }
    }
    store.setProfileHidden(id, hidden);
    return { ok: true };
  });
};
