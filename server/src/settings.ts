import { randomBytes, randomUUID } from 'node:crypto';

/** What Curatorr keeps in the `settings` table, as JSON by key (read and written through `Store.get`/`set`). */

export interface RadarrSettings {
  url: string;
  apiKey: string;
}

export interface PlexSettings {
  clientId: string;
  adminToken: string | null;
  ownerId: number | null;
  ownerName: string | null;
  machineId: string | null;
  serverName: string | null;
  serverUrl: string | null;
  sectionIds: string[];
}

export interface JellyfinSettings {
  /** Where Curatorr reaches Jellyfin. */
  url: string;
  /** Where people open Jellyfin, for Watch on Jellyfin, when that's another address. */
  publicUrl: string | null;
  serverId: string;
  serverName: string;
  /** Curatorr's device in Jellyfin, which keeps one token per device and user. */
  deviceId: string;
  /** The token of the administrator who connected Curatorr; it reads and marks every user's movies. */
  token: string;
  /** That administrator, who owns Curatorr's settings as the Plex owner does. */
  ownerId: string;
  ownerName: string;
  /** The libraries that hold the Radarr movies. */
  libraryIds: string[];
}

export interface SeerrSettings {
  url: string;
  apiKey: string;
}

export interface AppSettings {
  includeWatched: boolean;
  syncIntervalHours: number;
  /** "Seen it" marks the movie watched on the media server; "Watchlist" adds it to the server's watchlist. */
  syncToServer: boolean;
  /** Unwatched Seerr requests rank higher for whoever made them. */
  boostRequests: boolean;
}

export interface SyncInfo {
  at: number | null;
  movies: number;
  /** Library movies found on the media server. */
  matched: number;
  error: string | null;
}

/** The last read of Seerr: requested movies found in the library, and for how many profiles. */
export interface RequestSyncInfo {
  at: number | null;
  requests: number;
  profiles: number;
  error: string | null;
}

/** Radarr's webhook: the secret in its address, and when Radarr last called, with what. */
export interface RadarrWebhookInfo {
  token: string;
  at: number | null;
  event: string | null;
  /** The movie the last call named. */
  title: string | null;
}

/**
 * Settings sign-ins Curatorr counted as wrong for a Jellyfin administrator: how many, the last one's time, and
 * when Jellyfin last saw them sign in as the count began (null when it didn't say).
 */
export interface JellyfinMisses {
  count: number;
  at: number;
  lastLoginAt: number | null;
}

export interface Settings {
  setupComplete: boolean;
  cookieSecret: string;
  radarr: RadarrSettings | null;
  plex: PlexSettings;
  jellyfin: JellyfinSettings | null;
  app: AppSettings;
  sync: SyncInfo;
  seerr: SeerrSettings | null;
  seerrSync: RequestSyncInfo;
  radarrWebhook: RadarrWebhookInfo;
  /** The newest release on GitHub when Curatorr last looked (services/updates.ts). */
  latestVersion: string | null;
  /** Wrong passwords given for each Jellyfin administrator in Settings sign-in (services/jellyfinSignIn.ts), by user id. */
  jellyfinMisses: Record<string, JellyfinMisses>;
  /** Sign-ins to settings and PINs entered only hold for this epoch; "Sign out all other devices" sets a new one. */
  sessionEpoch: string | null;
}

export type SettingKey = keyof Settings;

/**
 * Each setting's value before anything is saved, made when asked for, so a read only makes its own: a fresh object
 * every time, and the secrets (the cookie secret, Plex's client id, the webhook's token) only where they're needed.
 */
export const DEFAULTS: { [K in SettingKey]: () => Settings[K] } = {
  setupComplete: () => false,
  cookieSecret: () => randomBytes(32).toString('hex'),
  radarr: () => null,
  plex: () => ({
    clientId: randomUUID(),
    adminToken: null,
    ownerId: null,
    ownerName: null,
    machineId: null,
    serverName: null,
    serverUrl: null,
    sectionIds: [],
  }),
  jellyfin: () => null,
  app: () => ({ includeWatched: false, syncIntervalHours: 6, syncToServer: true, boostRequests: true }),
  sync: () => ({ at: null, movies: 0, matched: 0, error: null }),
  seerr: () => null,
  seerrSync: () => ({ at: null, requests: 0, profiles: 0, error: null }),
  // The secret in the address Radarr calls.
  radarrWebhook: () => ({ token: randomBytes(24).toString('base64url'), at: null, event: null, title: null }),
  latestVersion: () => null,
  jellyfinMisses: () => ({}),
  sessionEpoch: () => null,
};

/** Defaults made up on first read that must stay the same afterwards, so they're saved then. */
export const GENERATED: ReadonlySet<SettingKey> = new Set(['cookieSecret', 'plex', 'radarrWebhook']);

/** A setting as stored, with the keys an older version didn't save filled from its default. */
export function withDefaults<K extends SettingKey>(key: K, stored: Settings[K]): Settings[K] {
  if (!isPlainObject(stored)) return stored;
  const fallback = DEFAULTS[key]();
  return isPlainObject(fallback) ? (Object.assign({}, fallback, stored) as Settings[K]) : stored;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
