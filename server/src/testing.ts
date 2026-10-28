// Helpers for the server's tests: temporary apps and stores, fake upstream servers, and cookies.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { movieMaker, type MovieFields } from '@curatorr/shared/testing';
import type { FastifyBaseLogger, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { Store, type StoredMovie } from './store.js';

export type App = Awaited<ReturnType<typeof buildApp>>['app'];

const noop = () => {};

/** A logger that says nothing, for services called outside an app. */
export const silentLog: FastifyBaseLogger = {
  level: 'silent',
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
  silent: noop,
  child: () => silentLog,
};

/** A new temporary folder, and how to remove it. */
export function tempDir(name: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `curatorr-${name}-`));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An app on a temporary folder: the demo unless `demo: false`. `close` stops it and removes the folder. */
export async function tempApp(name: string, opts: { demo?: boolean } = {}) {
  const { dir, remove } = tempDir(name);
  const built = await buildApp({ configDir: dir, demo: opts.demo ?? true, logger: false });
  return {
    ...built,
    dir,
    close: async () => {
      await built.app.close();
      remove();
    },
  };
}

/** A store on a temporary folder, outside any app. `close` closes it and removes the folder. */
export function tempStore(name: string, opts: { demo?: boolean } = {}) {
  const { dir, remove } = tempDir(name);
  const db = openDb(dir, 'curatorr.db');
  return {
    store: new Store(db, opts.demo ?? false),
    db,
    dir,
    close: () => {
      db.close();
      remove();
    },
  };
}

/** Starts `server` on a free local port, and returns its address. */
export async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A fake upstream server on a free local port: its address, and how to stop it. */
export async function fakeServer(handler: RequestListener) {
  const server = createServer(handler);
  const base = await listen(server);
  return { server, base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** The first cookie a response set, as a Cookie header. */
export const cookieOf = (res: LightMyRequestResponse) => String(res.headers['set-cookie']).split(';')[0]!;

/** A device's cookies after a response, as a Cookie header: what it set (or cleared), over what the device had. */
export function cookiesOf(res: LightMyRequestResponse, before = '') {
  const split = (pair: string) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)] as const;
  const jar = new Map(before ? before.split('; ').map(split) : []);
  for (const c of [res.headers['set-cookie'] ?? []].flat()) {
    const [name, value] = split(String(c).split(';')[0]!);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** The cookie of an administrator signed in to Settings on this device, as `id` on the media server. */
export const adminCookie = (app: Pick<App, 'signCookie'>, id: string | number) =>
  `curatorr_admin=${encodeURIComponent(app.signCookie(`${id}.${Date.now()}`))}`;

type StoredFields = MovieFields & Partial<Pick<StoredMovie, 'posterPath' | 'fanartPath'>>;

/**
 * Makes stored movies as shared's `movieMaker` makes movies, with no pictures and nothing on a media server unless
 * `defaults` or a call's fields say so.
 */
export function storedMovieMaker(defaults: StoredFields = {}) {
  const { posterPath = null, fanartPath = null, ...movieDefaults } = defaults;
  const movie = movieMaker({ posterUrl: null, fanartUrl: null, plexRatingKey: null, ...movieDefaults });
  return ({ posterPath: p = posterPath, fanartPath: f = fanartPath, ...fields }: StoredFields = {}): StoredMovie => ({
    ...movie(fields),
    posterPath: p,
    fanartPath: f,
  });
}
