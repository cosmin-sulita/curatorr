import type { RestrictionProfile } from '@curatorr/shared';
import { config } from '../config.js';
import { normalizeBaseUrl, request, requestJson, TIMEOUT, UpstreamError } from '../http.js';

const SERVICE = 'Jellyfin';

/**
 * The `Authorization` header Jellyfin reads: Jellyfin 12 stopped accepting the `X-Emby-*` headers
 * and `api_key`. Values are quoted and URL-encoded.
 */
export function jellyfinAuthorization(deviceId: string, token?: string | null): string {
  const fields: [string, string][] = [
    ['Client', 'Curatorr'],
    ['Device', 'Curatorr'],
    ['DeviceId', deviceId],
    ['Version', config.version],
  ];
  if (token) fields.push(['Token', token]);
  return `MediaBrowser ${fields.map(([k, v]) => `${k}="${encodeURIComponent(v)}"`).join(', ')}`;
}

export interface JellyfinUser {
  id: string;
  /** The name people sign in with. */
  name: string;
  admin: boolean;
  disabled: boolean;
  /** Jellyfin's parental limit, as an age (G 0, PG 10, PG-13 13, R 17); null for none. */
  maxParentalRating: number | null;
  /** Set when the user has a picture of their own. */
  imageTag: string | null;
  /** When the user last signed in to Jellyfin, in any app; null when Jellyfin doesn't say. */
  lastLoginAt: number | null;
  /** After how many wrong passwords in a row Jellyfin disables the account; null when it never does. */
  lockoutAfter: number | null;
  /** Wrong passwords since the last right one, in any app, as Jellyfin counts them. */
  wrongPasswords: number;
}

/**
 * Jellyfin's "maximum login attempts before lockout", as Jellyfin 12.2 applies it: -1 (what it gives every
 * user) never locks, 0 is saved as 3, and N disables the account at the N-th wrong password in a row.
 */
function lockoutAfter(setting: unknown): number | null {
  if (typeof setting !== 'number' || setting < 0) return null;
  return setting === 0 ? 3 : setting;
}

export function toJellyfinUser(u: any): JellyfinUser {
  const policy = u.Policy ?? {};
  return {
    id: String(u.Id),
    name: u.Name || 'Jellyfin user',
    admin: Boolean(policy.IsAdministrator),
    disabled: Boolean(policy.IsDisabled),
    maxParentalRating: typeof policy.MaxParentalRating === 'number' ? policy.MaxParentalRating : null,
    imageTag: u.PrimaryImageTag || null,
    lastLoginAt: parseDate(u.LastLoginDate),
    lockoutAfter: lockoutAfter(policy.LoginAttemptsBeforeLockout),
    wrongPasswords: typeof policy.InvalidLoginAttemptCount === 'number' ? policy.InvalidLoginAttemptCount : 0,
  };
}

export interface JellyfinItem {
  id: string;
  title: string;
  tmdbId: number | null;
  imdbId: string | null;
  /** The person's marks, when the movies were read for one. */
  played: boolean;
  lastPlayedAt: number | null;
  favorite: boolean;
}

/** A provider id, whatever case the metadata plugin wrote its name in. */
function providerId(ids: Record<string, unknown> | undefined, name: string): string | null {
  for (const [key, value] of Object.entries(ids ?? {})) if (key.toLowerCase() === name && value) return String(value);
  return null;
}

/** Jellyfin's dates carry seven decimal places; JavaScript only reads three. */
function parseDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(time) ? null : time;
}

export function toJellyfinItem(m: any): JellyfinItem {
  const tmdb = Number(providerId(m.ProviderIds, 'tmdb'));
  return {
    id: String(m.Id),
    title: m.Name ?? '',
    tmdbId: Number.isInteger(tmdb) && tmdb > 0 ? tmdb : null,
    imdbId: providerId(m.ProviderIds, 'imdb'),
    played: Boolean(m.UserData?.Played),
    lastPlayedAt: parseDate(m.UserData?.LastPlayedDate),
    favorite: Boolean(m.UserData?.IsFavorite),
  };
}

/**
 * Jellyfin's parental limit as the nearest Curatorr restriction at or below it, so picks never show
 * more than Jellyfin would. The limit is an age that every country's ratings map onto: G 0, PG 10,
 * PG-13 13, R 17. Administrators, like the Plex owner, are never restricted.
 */
export function jellyfinRestriction(maxParentalRating: number | null, admin: boolean): RestrictionProfile {
  if (admin || maxParentalRating == null) return null;
  if (maxParentalRating < 10) return 'little_kid';
  if (maxParentalRating < 13) return 'older_kid';
  if (maxParentalRating < 17) return 'teen';
  return null;
}

/** The movie's page in Jellyfin's web app. The Jellyfin apps don't open links, so phones get it too. */
export function jellyfinLink(baseUrl: string, serverId: string, itemId: string): string {
  return `${baseUrl}/web/#/details?id=${encodeURIComponent(itemId)}&serverId=${encodeURIComponent(serverId)}`;
}

/** Jellyfin 10.9 brought the routes Curatorr uses (`/Items?userId=`, `/UserPlayedItems`…). */
export function supportedJellyfin(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  return major! > 10 || (major === 10 && minor! >= 9);
}

/** Jellyfin writes its ids without dashes, and others may not: one spelling to compare them by. */
export const jellyfinIdKey = (id: string) => id.replace(/-/g, '').toLowerCase();

export interface JellyfinLibrary {
  key: string;
  title: string;
}

export class JellyfinClient {
  readonly baseUrl: string;

  constructor(
    url: string,
    private readonly deviceId: string,
    private readonly token: string | null = null,
  ) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  /** Signed in as Curatorr, from the saved connection. */
  static connected(c: { url: string; deviceId: string; token: string }) {
    return new JellyfinClient(c.url, c.deviceId, c.token);
  }

  private init({ headers, ...init }: RequestInit & { headers?: Record<string, string>; timeoutMs?: number } = {}) {
    return {
      ...init,
      headers: {
        // Jellyfin picks its JSON casing from this, and 12.2 answers in camelCase without it.
        Accept: 'application/json; profile="PascalCase"',
        Authorization: jellyfinAuthorization(this.deviceId, this.token),
        ...headers,
      },
    };
  }

  private get<T>(path: string, timeoutMs: number = TIMEOUT.read) {
    return requestJson<T>(SERVICE, `${this.baseUrl}${path}`, this.init({ timeoutMs }));
  }

  /** Answers without signing in, so it tells whether the address is Jellyfin, and which version. */
  async publicInfo(timeoutMs: number = TIMEOUT.quick): Promise<{ id: string; name: string; version: string }> {
    const body = await this.get<any>('/System/Info/Public', timeoutMs);
    if (!body?.Id) throw new UpstreamError(SERVICE, 'that address answered, but not as Jellyfin');
    return { id: String(body.Id), name: body.ServerName || 'Jellyfin', version: String(body.Version ?? '') };
  }

  /** Signs a user in. Jellyfin keeps one token per device and user, so this replaces that user's last one here. */
  async authenticate(username: string, password: string): Promise<{ token: string; user: JellyfinUser }> {
    const body = await requestJson<any>(
      SERVICE,
      `${this.baseUrl}/Users/AuthenticateByName`,
      this.init({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: username, Pw: password }),
        timeoutMs: 10_000,
      }),
    );
    // Without a token there's nothing to keep: the string "undefined" would pass for one.
    if (!body?.AccessToken || !body.User) throw new UpstreamError(SERVICE, 'the sign-in answered without a session');
    return { token: String(body.AccessToken), user: toJellyfinUser(body.User) };
  }

  /** Ends this token's session, which also takes the device off Jellyfin's list. */
  async logout() {
    await request(SERVICE, `${this.baseUrl}/Sessions/Logout`, this.init({ method: 'POST', timeoutMs: TIMEOUT.quick }));
  }

  async users(): Promise<JellyfinUser[]> {
    return (await this.get<any[]>('/Users')).map(toJellyfinUser);
  }

  /** The libraries that can hold movies: movie libraries, and mixed ones. */
  async movieLibraries(): Promise<JellyfinLibrary[]> {
    const folders = await this.get<any[]>('/Library/VirtualFolders');
    return folders
      .filter((f) => !f.CollectionType || f.CollectionType === 'movies' || f.CollectionType === 'mixed')
      .map((f) => ({ key: String(f.ItemId), title: f.Name }));
  }

  /**
   * The movies in a library or, with `userId`, every movie that person can open (their library
   * access and parental controls decide), with their played and favourite marks.
   */
  async movies({ libraryId, userId }: { libraryId?: string; userId?: string }): Promise<JellyfinItem[]> {
    const qs = new URLSearchParams({
      includeItemTypes: 'Movie',
      recursive: 'true',
      fields: 'ProviderIds',
      enableImages: 'false',
      enableUserData: String(Boolean(userId)),
    });
    if (libraryId) qs.set('parentId', libraryId);
    if (userId) qs.set('userId', userId);
    const body = await this.get<{ Items?: unknown[] }>(`/Items?${qs}`, TIMEOUT.listing);
    return (body.Items ?? []).map(toJellyfinItem);
  }

  /** Marks a movie played, or not, for a user. An administrator's token may do it for anyone. */
  async setPlayed(userId: string, itemId: string, played: boolean) {
    await this.userData('UserPlayedItems', userId, itemId, played);
  }

  /** Adds a movie to a user's favourites, or takes it off. */
  async setFavorite(userId: string, itemId: string, favorite: boolean) {
    await this.userData('UserFavoriteItems', userId, itemId, favorite);
  }

  private async userData(route: string, userId: string, itemId: string, on: boolean) {
    const url = `${this.baseUrl}/${route}/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`;
    await request(SERVICE, url, this.init({ method: on ? 'POST' : 'DELETE', timeoutMs: TIMEOUT.quick }));
  }

  /** A user's picture, as Jellyfin serves it. */
  userImage(userId: string, tag?: string) {
    const qs = new URLSearchParams({ userId, ...(tag ? { tag } : {}) });
    return request(SERVICE, `${this.baseUrl}/UserImage?${qs}`, this.init({ timeoutMs: 10_000 }));
  }
}
