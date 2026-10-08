import { z } from 'zod';
import { parse, within, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { linkProfile, syncPlexState, verifyPin } from '../services/profiles.js';
import { clearProfileCookie, pinNeededHere, rememberPin, requireAdmin, setProfileCookie } from '../session.js';
import { toProfile } from '../store.js';

/** How long selecting a profile waits for its Plex watch history before moving on. */
const WATCHED_WAIT_MS = 8_000;
/** After this many wrong PINs in a row, a profile takes one try per pause. */
const MAX_WRONG_PINS = 5;
const PIN_PAUSE_MS = 10 * 60 * 1000;

export const profileRoutes: RouteModule = (app, { store }) => {
  // Wrong PINs per profile since its last right one, so nobody can try them all through Curatorr.
  // Kept in memory: a restart forgives them.
  const wrongPins = new Map<number, { count: number; until: number }>();

  app.get('/api/profiles', async (req) =>
    store.profileRows().map((r) => ({ ...toProfile(r), locked: pinNeededHere(req, store, r) })),
  );

  app.post('/api/profiles/:id/select', async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { pin } = parse(z.object({ pin: z.string().max(8).optional() }).default({}), req.body ?? {});

    let row = store.profileRow(id);
    if (!row || row.hidden) throw new HttpError(404, 'Profile not found');

    const tries = wrongPins.get(id);
    if (pin && tries && tries.until > Date.now()) {
      const minutes = Math.ceil((tries.until - Date.now()) / 60_000);
      const wait = minutes === 1 ? 'a minute' : `${minutes} minutes`;
      throw new HttpError(429, `Too many wrong PINs. Try again in ${wait}`, { needPin: true });
    }
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
      if (pin && err instanceof HttpError && err.details?.needPin) {
        const count = (tries?.count ?? 0) + 1;
        wrongPins.set(id, { count, until: count >= MAX_WRONG_PINS ? Date.now() + PIN_PAUSE_MS : 0 });
      }
      throw err;
    }
    if (pin) wrongPins.delete(id);

    setProfileCookie(reply, row.id);
    await within(syncPlexState(store, row, req.log), WATCHED_WAIT_MS);
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
    if (row.is_admin && hidden) throw new HttpError(400, "The owner's profile can't be hidden");
    store.setProfileHidden(id, hidden);
    return { ok: true };
  });
};
