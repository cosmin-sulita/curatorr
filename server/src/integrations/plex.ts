import { XMLParser } from 'fast-xml-parser';
import type { RestrictionProfile } from '@curatorr/shared';
import { config } from '../config.js';
import { normalizeBaseUrl, request, requestJson, UpstreamError } from '../http.js';

/** Plex's cloud hosts. Exported so tests can point them at a fake server. */
export const PLEX_HOSTS = {
  tv: 'https://plex.tv',
  /** Plex Discover: the Watchlist lives here. */
  discover: 'https://discover.provider.plex.tv',
};
const SERVICE = 'Plex';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false });

export function plexHeaders(clientId: string, token?: string | null): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Product': 'Curatorr',
    'X-Plex-Version': config.version,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Platform': 'Web',
    'X-Plex-Device': 'Curatorr',
    'X-Plex-Device-Name': 'Curatorr',
    ...(token ? { 'X-Plex-Token': token } : {}),
  };
}

/** Some plex.tv v1 endpoints ignore Accept and answer in XML. */
async function jsonOrXml(res: Response): Promise<any> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(text);
  return xml.parse(text);
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

// ---------------------------------------------------------------------------
// plex.tv: sign in, account, servers, Plex Home
// ---------------------------------------------------------------------------

export interface PlexPin {
  id: number;
  code: string;
}

export async function createPin(clientId: string): Promise<PlexPin> {
  const pin = await requestJson<{ id: number; code: string }>(SERVICE, `${PLEX_HOSTS.tv}/api/v2/pins?strong=true`, {
    method: 'POST',
    headers: plexHeaders(clientId),
  });
  return { id: pin.id, code: pin.code };
}

export function authUrl(clientId: string, code: string): string {
  const params = new URLSearchParams({
    clientID: clientId,
    code,
    'context[device][product]': 'Curatorr',
  });
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

export async function checkPin(clientId: string, id: number): Promise<string | null> {
  const pin = await requestJson<{ authToken: string | null }>(SERVICE, `${PLEX_HOSTS.tv}/api/v2/pins/${id}`, {
    headers: plexHeaders(clientId),
  });
  return pin.authToken || null;
}

export interface PlexAccount {
  id: number;
  uuid: string;
  username: string;
  title: string;
  thumb: string | null;
}

export async function getAccount(clientId: string, token: string): Promise<PlexAccount> {
  const a = await requestJson<any>(SERVICE, `${PLEX_HOSTS.tv}/api/v2/user`, { headers: plexHeaders(clientId, token) });
  return { id: Number(a.id), uuid: a.uuid, username: a.username, title: a.title || a.username, thumb: a.thumb ?? null };
}

export interface PlexConnection {
  uri: string;
  address: string;
  port: number;
  protocol: string;
  local: boolean;
  relay: boolean;
}

export interface PlexServer {
  name: string;
  machineId: string;
  accessToken: string | null;
  owned: boolean;
  connections: PlexConnection[];
}

export async function getServers(clientId: string, token: string): Promise<PlexServer[]> {
  const resources = await requestJson<any[]>(
    SERVICE,
    `${PLEX_HOSTS.tv}/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=0`,
    { headers: plexHeaders(clientId, token) },
  );
  return resources
    .filter((r) => String(r.provides ?? '').split(',').includes('server'))
    .map((r) => ({
      name: r.name,
      machineId: r.clientIdentifier,
      accessToken: r.accessToken ?? null,
      owned: bool(r.owned),
      connections: asArray<any>(r.connections).map((c) => ({
        uri: c.uri,
        address: c.address,
        port: Number(c.port),
        protocol: c.protocol,
        local: bool(c.local),
        relay: bool(c.relay),
      })),
    }));
}

export interface PlexHomeUser {
  id: number;
  uuid: string | null;
  title: string;
  thumb: string | null;
  admin: boolean;
  guest: boolean;
  restricted: boolean;
  protected: boolean;
  restrictionProfile: RestrictionProfile;
}

const RESTRICTIONS = new Set(['little_kid', 'older_kid', 'teen']);

function toRestriction(user: any): RestrictionProfile {
  const value = user.restrictionProfile ?? user.restriction_profile;
  if (RESTRICTIONS.has(value)) return value;
  // Restricted users without an explicit profile get the most cautious "teen" ceiling.
  return bool(user.restricted) ? 'teen' : null;
}

export async function getHomeUsers(clientId: string, token: string): Promise<PlexHomeUser[]> {
  const res = await request(SERVICE, `${PLEX_HOSTS.tv}/api/home/users`, { headers: plexHeaders(clientId, token) });
  const body = await jsonOrXml(res);
  const users = asArray<any>(body.users ?? body.MediaContainer?.User);
  return users.map((u) => ({
    id: Number(u.id),
    uuid: u.uuid ?? null,
    title: u.title || u.username || 'Plex user',
    thumb: u.thumb ?? null,
    admin: bool(u.admin),
    guest: bool(u.guest),
    restricted: bool(u.restricted),
    protected: bool(u.protected),
    restrictionProfile: toRestriction(u),
  }));
}

/** Switches to a Plex Home user and returns that user's plex.tv token. */
export async function switchHomeUser(clientId: string, adminToken: string, userId: number, pin?: string) {
  const qs = pin ? `?pin=${encodeURIComponent(pin)}` : '';
  try {
    const res = await request(SERVICE, `${PLEX_HOSTS.tv}/api/home/users/${userId}/switch${qs}`, {
      method: 'POST',
      headers: plexHeaders(clientId, adminToken),
    });
    const body = await jsonOrXml(res);
    const user = body.user ?? body;
    const token = user.authToken ?? user.authenticationToken;
    if (!token) throw new UpstreamError(SERVICE, 'switching user returned no token');
    return token as string;
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
      throw new UpstreamError(SERVICE, pin ? 'wrong PIN' : 'this profile needs its PIN', err.status);
    }
    throw err;
  }
}

/** The token a given plex.tv user must use against a specific server. */
export async function serverTokenFor(clientId: string, userToken: string, machineId: string): Promise<string | null> {
  const servers = await getServers(clientId, userToken);
  return servers.find((s) => s.machineId === machineId)?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// Plex Media Server
// ---------------------------------------------------------------------------

export interface PlexLibrary {
  key: string;
  title: string;
  count?: number;
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  year: number | null;
  viewCount: number;
  lastViewedAt: number | null;
  /** watch.plex.tv identifier, e.g. "godzilla-2014". */
  slug: string | null;
  /** Plex metadata id from the `plex://movie/<id>` guid; the Watchlist is keyed by it. */
  plexGuid: string | null;
  tmdbId: number | null;
  imdbId: string | null;
}

export class PlexServerClient {
  readonly baseUrl: string;

  constructor(
    url: string,
    private readonly clientId: string,
    private readonly token: string,
  ) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  private get<T>(path: string, timeoutMs = 15_000) {
    return requestJson<T>(SERVICE, `${this.baseUrl}${path}`, {
      headers: plexHeaders(this.clientId, this.token),
      timeoutMs,
    });
  }

  async identity(timeoutMs = 5_000): Promise<{ machineId: string; version: string }> {
    const body = await this.get<any>('/identity', timeoutMs);
    return { machineId: body.MediaContainer.machineIdentifier, version: body.MediaContainer.version };
  }

  async movieLibraries(): Promise<PlexLibrary[]> {
    const body = await this.get<any>('/library/sections');
    return asArray<any>(body.MediaContainer?.Directory)
      .filter((d) => d.type === 'movie')
      .map((d) => ({ key: String(d.key), title: d.title }));
  }

  async movies(sectionKey: string): Promise<PlexItem[]> {
    const body = await this.get<any>(`/library/sections/${sectionKey}/all?type=1&includeGuids=1`, 120_000);
    return asArray<any>(body.MediaContainer?.Metadata).map(toPlexItem);
  }

  /** Marks an item watched for the user this client's token belongs to. */
  async scrobble(ratingKey: string) {
    await request(SERVICE, `${this.baseUrl}/:/scrobble?${scrobbleQuery(ratingKey)}`, {
      headers: plexHeaders(this.clientId, this.token),
      timeoutMs: 5_000,
    });
  }

  /** Marks an item unwatched for the user this client's token belongs to. */
  async unscrobble(ratingKey: string) {
    await request(SERVICE, `${this.baseUrl}/:/unscrobble?${scrobbleQuery(ratingKey)}`, {
      headers: plexHeaders(this.clientId, this.token),
      timeoutMs: 5_000,
    });
  }

  /** Full metadata for one item; includes the slug even when library listings leave it out. */
  async item(ratingKey: string, timeoutMs = 4_000): Promise<PlexItem | null> {
    const body = await this.get<any>(`/library/metadata/${encodeURIComponent(ratingKey)}`, timeoutMs);
    const m = asArray<any>(body.MediaContainer?.Metadata)[0];
    return m ? toPlexItem(m) : null;
  }
}

const scrobbleQuery = (ratingKey: string) =>
  new URLSearchParams({ key: ratingKey, identifier: 'com.plexapp.plugins.library' }).toString();

/** The id in a modern-agent guid (`plex://movie/5d776825880197001ec967c8`), else null. */
export function plexGuidId(guid: unknown): string | null {
  if (typeof guid !== 'string') return null;
  return /^plex:\/\/movie\/([0-9a-z]+)$/i.exec(guid)?.[1] ?? null;
}

export function toPlexItem(m: any): PlexItem {
  const ids = parseGuids([...asArray<any>(m.Guid).map((g) => g.id), m.guid]);
  return {
    ratingKey: String(m.ratingKey),
    title: m.title,
    year: m.year ?? null,
    viewCount: Number(m.viewCount ?? 0),
    lastViewedAt: m.lastViewedAt ? Number(m.lastViewedAt) * 1000 : null,
    // Only items matched by the modern "Plex Movie" agent have one.
    slug: typeof m.slug === 'string' && m.slug ? m.slug : null,
    plexGuid: plexGuidId(m.guid),
    ...ids,
  };
}

// ---------------------------------------------------------------------------
// Plex Watchlist (per plex.tv user)
// ---------------------------------------------------------------------------

const WATCHLIST_PAGE = 100;

/** The Plex guid ids of every movie on the user's Watchlist. */
export async function getWatchlist(clientId: string, userToken: string): Promise<string[]> {
  const ids: string[] = [];
  for (let start = 0; start < 10_000; start += WATCHLIST_PAGE) {
    const qs = new URLSearchParams({
      type: '1',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(WATCHLIST_PAGE),
    });
    const body = await requestJson<any>(SERVICE, `${PLEX_HOSTS.discover}/library/sections/watchlist/all?${qs}`, {
      headers: plexHeaders(clientId, userToken),
    });
    const items = asArray<any>(body.MediaContainer?.Metadata);
    for (const m of items) {
      const id = plexGuidId(m.guid);
      if (id) ids.push(id);
    }
    const total = Number(body.MediaContainer?.totalSize ?? 0);
    if (items.length < WATCHLIST_PAGE || start + WATCHLIST_PAGE >= total) break;
  }
  return ids;
}

/** Adds a movie (by Plex guid id) to the user's Watchlist. */
export async function addToWatchlist(clientId: string, userToken: string, plexGuid: string) {
  await watchlistAction('addToWatchlist', clientId, userToken, plexGuid);
}

/** Removes a movie (by Plex guid id) from the user's Watchlist. */
export async function removeFromWatchlist(clientId: string, userToken: string, plexGuid: string) {
  await watchlistAction('removeFromWatchlist', clientId, userToken, plexGuid);
}

async function watchlistAction(action: string, clientId: string, userToken: string, plexGuid: string) {
  await request(SERVICE, `${PLEX_HOSTS.discover}/actions/${action}?ratingKey=${encodeURIComponent(plexGuid)}`, {
    method: 'PUT',
    headers: plexHeaders(clientId, userToken),
    timeoutMs: 5_000,
  });
}

/**
 * Extracts TMDB/IMDb ids from Plex guids. Handles the modern agent
 * (`tmdb://603`, `imdb://tt0133093`) and legacy agents
 * (`com.plexapp.agents.themoviedb://603?lang=en`, `com.plexapp.agents.imdb://tt0133093?lang=en`).
 */
export function parseGuids(guids: (string | undefined | null)[]): { tmdbId: number | null; imdbId: string | null } {
  let tmdbId: number | null = null;
  let imdbId: string | null = null;
  for (const guid of guids) {
    if (!guid) continue;
    const tmdb = /(?:^tmdb|themoviedb):\/\/(\d+)/.exec(guid);
    if (tmdb && tmdbId == null) tmdbId = Number(tmdb[1]);
    const imdb = /(tt\d+)/.exec(guid);
    if (imdb && imdbId == null && /imdb/.test(guid)) imdbId = imdb[1]!;
  }
  return { tmdbId, imdbId };
}

/**
 * Links that open a movie in Plex.
 *
 * - `web`: Plex Web, straight to the item on this server (desktop).
 * - `app`: the mobile apps. The redesigned apps ignore the old `plex://preplay` deep link
 *   (they open on Home), but they claim `watch.plex.tv/movie/<slug>` as a universal/app link
 *   and show its details page, which lists this server as a place to play it. Movies without a
 *   slug (legacy metadata agents) fall back to `plex://preplay`, which older apps still honour.
 */
export function plexLinks(machineId: string, ratingKey: string, slug?: string | null) {
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return {
    web: `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=${key}`,
    app: slug
      ? `https://watch.plex.tv/movie/${encodeURIComponent(slug)}`
      : `plex://preplay/?metadataKey=${key}&metadataType=1&server=${machineId}`,
  };
}

/** Candidate URLs for reaching a server from inside the container, best first. */
export function connectionCandidates(server: PlexServer): { url: string; local: boolean; relay: boolean }[] {
  const out: { url: string; local: boolean; relay: boolean }[] = [];
  const seen = new Set<string>();
  const add = (url: string, local: boolean, relay: boolean) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, local, relay });
  };
  const sorted = [...server.connections].sort((a, b) => Number(b.local) - Number(a.local) || Number(a.relay) - Number(b.relay));
  for (const c of sorted) {
    if (c.local && !c.relay) add(`http://${c.address}:${c.port}`, true, false);
    add(c.uri, c.local, c.relay);
  }
  return out;
}
