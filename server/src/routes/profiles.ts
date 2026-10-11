import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse, within, type RouteModule } from '../context.js';
import { Guesses } from '../guesses.js';
import { HttpError } from '../http.js';
import { syncServerState } from '../services/mediaServer.js';
import { linkProfile, verifyPin } from '../services/profiles.js';
import {
  clearProfileCookie,
  clearTogetherCookie,
  currentProfile,
  pinNeededHere,
  rememberPin,
  requireAdmin,
  setProfileCookie,
  setTogetherCookie,
} from '../session.js';
import { toProfile, type ProfileRow } from '../store.js';

/** How long selecting a profile waits for its watch history before moving on. */
const WATCHED_WAIT_MS = 8_000;

export const profileRoutes: RouteModule = (app, { store }) => {
  const wrongPins = new Guesses();

  /**
   * Readies a profile on this device: a protected one needs its PIN once on each device, also after it's
   * linked, and a Plex profile without a sign-in gets one. Five wrong PINs in a row pause PIN entry.
   */
  async function unlock(req: FastifyRequest, reply: FastifyReply, row: ProfileRow, pin?: string): Promise<ProfileRow> {
    const wait = pin ? wrongPins.wait(row.id) : null;
    if (wait) throw new HttpError(429, `Too many wrong PINs. Try again in ${wait}`, { needPin: true, profileId: row.id });
    try {
      if (pinNeededHere(req, store, row)) {
        await verifyPin(store, row, pin);
        rememberPin(req, reply, row.id);
      }
      if (store.plexConfigured() && row.plex_user_id != null && !row.server_token) {
        row = await linkProfile(store, row, pin);
      }
    } catch (err) {
      if (pin && err instanceof HttpError && err.details?.needPin) wrongPins.miss(row.id);
      throw err;
    }
    if (pin) wrongPins.hit(row.id);
    return row;
  }

  app.get('/api/profiles', async (req) =>
    store.profileRows().map((r) => ({ ...toProfile(r), locked: pinNeededHere(req, store, r) })),
  );

  app.post('/api/profiles/:id/select', async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { pin } = parse(z.object({ pin: z.string().max(8).optional() }).default({}), req.body ?? {});

    const found = store.profileRow(id);
    if (!found || found.hidden) throw new HttpError(404, 'Profile not found');
    const row = await unlock(req, reply, found, pin);

    setProfileCookie(reply, row.id);
    // One profile on its own ends watching together.
    clearTogetherCookie(reply);
    await within(syncServerState(store, row, req.log), WATCHED_WAIT_MS);
    return toProfile(row);
  });

  /**
   * Watching together: these profiles pick as one until the evening is over. Protected ones ask for their
   * PIN once on each device, one at a time: the 403 says whose, and the next try brings it along.
   */
  app.post('/api/profiles/together', async (req, reply) => {
    const body = parse(
      z.object({
        ids: z.array(z.number().int()).max(20),
        pin: z.object({ id: z.number().int(), pin: z.string().max(8) }).optional(),
      }),
      req.body,
    );
    const ids = [...new Set(body.ids)];
    if (ids.length < 2) throw new HttpError(400, 'Pick two or more people');
    const rows = ids.map((id) => store.profileRow(id));
    if (rows.some((r) => !r || r.hidden)) throw new HttpError(404, 'Profile not found');

    const members: ProfileRow[] = [];
    for (const row of rows) members.push(await unlock(req, reply, row!, body.pin?.id === row!.id ? body.pin.pin : undefined));
    // This device's profile leads when it's one of them, so Settings' lists stay its own.
    const current = currentProfile(req, store);
    const lead = members.find((m) => m.id === current?.id) ?? members[0]!;
    const others = members.filter((m) => m !== lead);

    setProfileCookie(reply, lead.id);
    setTogetherCookie(reply, others.map((m) => m.id));
    await within(Promise.all(members.map((m) => syncServerState(store, m, req.log))), WATCHED_WAIT_MS);
    return [lead, ...others].map(toProfile);
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
