import type { ErrorFlags } from '@curatorr/shared';

/** An error that maps directly to an HTTP response, with flags the app acts on. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: ErrorFlags,
  ) {
    super(message);
  }
}

/** A failure talking to Radarr, Plex, plex.tv, Jellyfin or Seerr. */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${service}: ${message}`);
  }
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * The saved API key when a form leaves it out, but only for the address it was saved with: a key
 * must never be sent to a new address that only came with the form.
 */
export function savedKeyFor(saved: { url: string; apiKey: string } | null, url: string): string | undefined {
  return saved && saved.url === normalizeBaseUrl(url) ? saved.apiKey : undefined;
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `${cause.code}${cause.message ? ` (${cause.message})` : ''}`;
    return err.message;
  }
  return String(err);
}

/** How long Curatorr waits for Radarr, Plex, plex.tv, Jellyfin or Seerr, by what it asks. */
export const TIMEOUT = {
  /** A mark, a sign-out, or a quick look at an address: someone is waiting on it. */
  quick: 5_000,
  /** One of a Plex server's addresses tried during setup, or a movie's Plex ids: several go at once. */
  probe: 4_000,
  /** An ordinary read. */
  read: 15_000,
  /** A whole library, which a big one takes a while to send. */
  listing: 120_000,
} as const;

export async function request(
  service: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = TIMEOUT.read, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new UpstreamError(service, `could not reach ${new URL(url).origin}: ${describeNetworkError(err)}`);
  }
  if (!res.ok) {
    const hint = res.status === 401 ? 'unauthorized (check the API key / token)' : `HTTP ${res.status}`;
    const detail = errorDetail(await res.text().catch(() => ''));
    throw new UpstreamError(service, detail ? `${hint}: ${detail}` : hint, res.status);
  }
  return res;
}

/** Pulls a readable message out of an error body; ignores empty JSON and HTML pages. */
function errorDetail(body: string): string {
  const text = body.trim();
  if (!text || text.startsWith('<')) return '';
  try {
    const json = JSON.parse(text);
    const message = json?.message ?? json?.error ?? json?.errors?.[0]?.message;
    return typeof message === 'string' ? message.slice(0, 200) : '';
  } catch {
    return text.slice(0, 200);
  }
}

export async function requestJson<T>(service: string, url: string, init?: RequestInit & { timeoutMs?: number }) {
  const res = await request(service, url, init);
  return (await res.json()) as T;
}
