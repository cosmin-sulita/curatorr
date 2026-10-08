import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, normalizeBaseUrl } from './http.js';
import type { LibrarySync } from './services/library.js';
import type { Store } from './store.js';

export interface AppContext {
  store: Store;
  library: LibrarySync;
}

export type RouteModule = (app: FastifyInstance, ctx: AppContext) => void | Promise<void>;

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input');
  }
  return result.data;
}

/** A Radarr, Seerr or Plex address as typed in a form; the scheme may be left out. */
export const serviceUrl = z
  .string()
  .min(1)
  .refine((v) => URL.canParse(normalizeBaseUrl(v)), 'Enter an address like http://192.168.1.10:7878');

/** Resolves after `ms` or when the promise settles, whichever comes first. */
export function within(promise: Promise<unknown>, ms: number) {
  return Promise.race([promise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
}
