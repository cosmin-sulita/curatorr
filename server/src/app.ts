import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController } from 'fastify';
import { compressAnswers } from './compress.js';
import { config } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db.js';
import { seedDemo } from './demo.js';
import { HttpError, UpstreamError } from './http.js';
import { imageRoutes } from './routes/images.js';
import { jellyfinRoutes } from './routes/jellyfin.js';
import { pickRoutes } from './routes/picks.js';
import { profileRoutes } from './routes/profiles.js';
import { radarrRoutes } from './routes/radarr.js';
import { settingsRoutes } from './routes/settings.js';
import { setupRoutes } from './routes/setup.js';
import { statusRoutes } from './routes/status.js';
import { LibrarySync } from './services/library.js';
import { Store } from './store.js';

/**
 * The app's pages run only its own scripts, and load only from Curatorr, except pictures (TMDB's, Plex's avatars).
 * There's no frame-ancestors: dashboards like Organizr show the app in a frame.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // The launch screen's markup and motion's animations set styles inline.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp(opts: { configDir?: string; demo?: boolean; logger?: boolean } = {}) {
  const demo = opts.demo ?? config.demo;
  const db = openDb(opts.configDir ?? config.configDir, demo ? 'curatorr-demo.db' : 'curatorr.db');
  const store = new Store(db, demo);
  if (demo) seedDemo(store);

  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
  });
  // JSON bodies only. Any web page can post a form as text/plain, and one on a sibling subdomain would
  // send Curatorr's cookies with it.
  app.removeContentTypeParser('text/plain');
  const library = new LibrarySync(store, app.log);
  library.retag();
  const ctx: AppContext = { store, library };

  await app.register(cookie, { secret: store.get('cookieSecret') });
  // Every response is what it says it is, and links out don't carry Curatorr's address. Framing stays
  // allowed: dashboards like Organizr show the app in a frame.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'same-origin');
  });
  // Another site's page mustn't change anything here with the browser's cookies, and one on a sibling subdomain
  // gets them sent along. Browsers say where a request comes from; Radarr's webhook doesn't, and it passes.
  // Reading stays open to anyone, since no other site can read the answers.
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') throw new HttpError(403, 'Requests from other sites are refused');
  });
  // The picking answers go compressed to browsers that accept it; nothing holding a secret does (compress.ts).
  compressAnswers(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, ...err.details });
    }
    if (err instanceof UpstreamError) {
      req.log.warn({ err: err.message }, 'upstream error');
      return reply.code(502).send({ error: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || (e.statusCode && e.statusCode < 500)) {
      return reply.code(e.statusCode ?? 400).send({ error: e.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'Something went wrong' });
  });

  const routeModules = [
    statusRoutes,
    setupRoutes,
    jellyfinRoutes,
    profileRoutes,
    pickRoutes,
    settingsRoutes,
    radarrRoutes,
    imageRoutes,
  ];
  for (const routes of routeModules) {
    await routes(app, ctx);
  }

  if (existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      // The build puts .br and .gz copies beside the text files; browsers that accept one get it.
      preCompressed: true,
      setHeaders(reply, filePath) {
        // Named as asked for, not as the compressed copy sent.
        const name = path.basename(filePath).replace(/\.(br|gz)$/, '');
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.header('cache-control', 'public, max-age=31536000, immutable');
        } else if (name === 'index.html' || name === 'sw.js' || name.endsWith('.webmanifest')) {
          reply.header('cache-control', 'no-cache');
        }
        if (name === 'index.html') reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply
        .header('cache-control', 'no-cache')
        .header('content-security-policy', CONTENT_SECURITY_POLICY)
        .sendFile('index.html');
    });
  } else {
    app.log.warn(`web build not found at ${config.webDist}; serving the API only`);
  }

  app.addHook('onClose', async () => {
    library.stop();
    db.close();
  });

  return { app, ctx };
}
