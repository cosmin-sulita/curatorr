import { z } from 'zod';
import { parse, within, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { linkProfile, syncWatched } from '../services/profiles.js';
import { clearProfileCookie, requireAdmin, setProfileCookie } from '../session.js';
import { toProfile } from '../store.js';

/** How long selecting a profile waits for its Plex watch history before moving on. */
const WATCHED_WAIT_MS = 8_000;

export const profileRoutes: RouteModule = (app, { store }) => {
  app.get('/api/profiles', async () => store.profileRows().map(toProfile));

  app.post('/api/profiles/:id/select', async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { pin } = parse(z.object({ pin: z.string().max(8).optional() }).default({}), req.body ?? {});

    let row = store.profileRow(id);
    if (!row || row.hidden) throw new HttpError(404, 'Profile not found');

    if (store.plexConfigured() && row.plex_user_id != null && !row.server_token) {
      row = await linkProfile(store, row, pin);
    }

    setProfileCookie(reply, row.id);
    await within(syncWatched(store, row, req.log), WATCHED_WAIT_MS);
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
