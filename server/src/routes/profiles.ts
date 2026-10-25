import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse, within, type RouteModule } from '../context.js';
import { Guesses } from '../guesses.js';
import { HttpError } from '../http.js';
import { syncServerState } from '../services/mediaServer.js';
import { hashPin, pinMatches } from '../pins.js';
import { linkProfile, verifyPin } from '../services/profiles.js';
import {
  PIN_HOLDS_MS,
  clearProfileCookie,
  clearTogetherCookie,
  currentProfile,
  pinNeededHere,
  requireAdmin,
  setProfileCookie,
  setTogetherCookie,
  setUnlocks,
  togetherUntil,
  unlocksHere,
} from '../session.js';
import { toProfile, type ProfileRow } from '../store.js';

/** How long selecting a profile waits for its watch history before moving on. */
const WATCHED_WAIT_MS = 8_000;

/** Checks the PIN Curatorr keeps for a Jellyfin profile, as plex.tv does for a Plex Home one. */
function checkKeptPin(row: ProfileRow, pin?: string) {
  if (!pin) throw new HttpError(403, 'PIN required', { needPin: true, profileId: row.id });
  if (!pinMatches(pin, row.pin_hash!)) throw new HttpError(403, 'Wrong PIN, try again', { needPin: true, profileId: row.id });
}

export const profileRoutes: RouteModule = (app, { store }) => {
  const wrongPins = new Guesses();

  /**
   * Readies a profile on this device: a protected one needs its PIN unless it holds here (see `pinNeededHere`),
   * also after it's linked, and a Plex profile without a sign-in gets one. Five wrong PINs in a row pause PIN
   * entry. Says whether the PIN was entered, for the caller to remember.
   */
  async function unlock(req: FastifyRequest, row: ProfileRow, pin?: string) {
    // Counted as wrong before plex.tv checks it, so PINs sent all at once can't all get through.
    const wait = pin ? wrongPins.take(row.id) : null;
    if (wait) throw new HttpError(429, `Too many wrong PINs. Try again in ${wait}`, { needPin: true, profileId: row.id });
    let pinEntered = false;
    try {
      if (pinNeededHere(req, store, row)) {
        // plex.tv checks a Plex Home PIN; Curatorr checks the one it keeps for a Jellyfin profile.
        if (row.plex_user_id != null) await verifyPin(store, row, pin);
        else checkKeptPin(row, pin);
        pinEntered = true;
      }
      if (store.plexConfigured() && row.plex_user_id != null && !row.server_token) {
        row = await linkProfile(store, row, pin);
      }
    } catch (err) {
      // A wrong PIN stays counted; one plex.tv couldn't check doesn't.
      if (pin && !(err instanceof HttpError && err.details?.needPin)) wrongPins.refund(row.id);
      throw err;
    }
    if (pin) wrongPins.hit(row.id);
    return { row, pinEntered };
  }

  app.get('/api/profiles', async (req) =>
    store.profileRows().map((r) => ({ ...toProfile(r), locked: pinNeededHere(req, store, r) })),
  );

  app.post('/api/profiles/:id/select', async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { pin } = parse(z.object({ pin: z.string().max(8).optional() }).default({}), req.body ?? {});

    const found = store.profileRow(id);
    if (!found || found.hidden) throw new HttpError(404, 'Profile not found');
    const unlocks = unlocksHere(req, store);
    const { row, pinEntered } = await unlock(req, found, pin);

    setProfileCookie(reply, row.id);
    // Only this profile's PIN still holds here, as long as before (a year when just entered): a shared tablet
    // handed to a kid doesn't keep a grown-up's profile open.
    const until = unlocks.get(row.id) ?? (pinEntered ? Date.now() + PIN_HOLDS_MS : undefined);
    setUnlocks(req, reply, store, new Map(until ? [[row.id, until]] : []));
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

    // This device's profile leads when it's one of them, so Settings' lists stay its own.
    const current = currentProfile(req, store);
    const leadId = ids.includes(current?.id ?? NaN) ? current!.id : ids[0]!;
    // The lead's PIN holds as long as before (a year when just entered); the others' until the group is over.
    const unlocks = unlocksHere(req, store);
    const groupEnds = togetherUntil(Date.now());
    const until = (id: number) =>
      id === leadId ? (unlocks.get(id) ?? Date.now() + PIN_HOLDS_MS) : Math.min(unlocks.get(id) ?? Infinity, groupEnds);
    const entered = new Set<number>();
    const members: ProfileRow[] = [];
    try {
      for (const row of rows) {
        const unlocked = await unlock(req, row!, body.pin?.id === row!.id ? body.pin.pin : undefined);
        if (unlocked.pinEntered) entered.add(unlocked.row.id);
        members.push(unlocked.row);
      }
    } catch (err) {
      // The PINs entered so far hold: the next try brings the next one.
      if (entered.size) {
        setUnlocks(req, reply, store, new Map([...unlocks, ...[...entered].map((id) => [id, until(id)] as const)]));
      }
      throw err;
    }
    const lead = members.find((m) => m.id === leadId)!;
    const others = members.filter((m) => m !== lead);

    setProfileCookie(reply, lead.id);
    setTogetherCookie(reply, others.map((m) => m.id));
    // Anyone else's PIN locks again, as when picking a profile.
    const held = members.filter((m) => unlocks.has(m.id) || entered.has(m.id));
    setUnlocks(req, reply, store, new Map(held.map((m) => [m.id, until(m.id)])));
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

  /**
   * An administrator gives a Jellyfin profile a PIN of four digits, changes it, or takes it off (null). Jellyfin has
   * no PINs of its own, so Curatorr keeps it, scrambled. Devices that entered the old PIN keep the profile open until
   * they move to another one, or everyone is signed out.
   */
  app.put('/api/profiles/:id/pin', async (req) => {
    requireAdmin(req, store);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4}$/, 'A PIN is four digits').nullable() }), req.body);
    const row = store.profileRow(id);
    if (!row) throw new HttpError(404, 'Profile not found');
    if (row.plex_user_id != null) throw new HttpError(400, 'Plex profiles use the PIN set in Plex');
    if (row.jellyfin_user_id == null) throw new HttpError(400, 'Only Jellyfin profiles get a PIN in Curatorr');
    store.setProfilePin(id, pin ? hashPin(pin) : null);
    return toProfile(store.profileRow(id)!);
  });
};
