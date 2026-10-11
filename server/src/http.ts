/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: Record<string, unknown>,
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

export async function request(
  service: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
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
