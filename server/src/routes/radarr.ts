import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parse, type RouteModule } from '../context.js';
import { HttpError } from '../http.js';
import { requireAdmin } from '../session.js';
import { newWebhookToken } from '../store.js';

/** Radarr's events that change which movies have files: an import (or upgrade) and the deletions. */
const LIBRARY_EVENTS = new Set(['Download', 'MovieFileDelete', 'MovieDelete']);

function sameToken(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What Curatorr reads of Radarr's webhook payload; the rest is left out. Health checks name no movie. */
const webhookSchema = z.object({
  eventType: z.string().max(100),
  movie: z.object({ title: z.string().nullish() }).nullish(),
});

export const radarrRoutes: RouteModule = (app, { store, library }) => {
  /**
   * Radarr calls this when a movie is imported or deleted (Settings → Connect → Webhook), so new downloads
   * show up within minutes instead of at the next sync. The secret in the address stands in for a sign-in.
   */
  app.post('/api/radarr/webhook', async (req) => {
    const { token } = parse(z.object({ token: z.string().max(200).optional() }), req.query);
    if (!token || !sameToken(token, store.get('radarrWebhook').token)) {
      throw new HttpError(401, 'This webhook address is wrong or was replaced. Copy it again from Settings in Curatorr.');
    }
    const { eventType, movie } = parse(webhookSchema, req.body ?? {});
    const title = movie?.title?.slice(0, 200) ?? null;
    store.update('radarrWebhook', { at: Date.now(), event: eventType, title });
    const syncing = LIBRARY_EVENTS.has(eventType);
    if (syncing) library.syncSoon();
    req.log.info({ event: eventType, movie: title, syncing }, 'Radarr webhook');
    return { ok: true };
  });

  /** A new address for the webhook, so one that leaked stops working. */
  app.post('/api/settings/webhook', async (req) => {
    requireAdmin(req, store);
    store.set('radarrWebhook', { token: newWebhookToken(), at: null, event: null, title: null });
    return store.get('radarrWebhook');
  });
};
