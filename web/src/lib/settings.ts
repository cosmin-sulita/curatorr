// The changes Settings, setup and the connect screens make, one typed call each. What a change refreshes is up to the
// screen that knows what's on it (see the refreshes in api.ts).
import type { ImportedProfile, MediaServer, PlexServerOption, ServerLibraries, SettingsResponse } from '@curatorr/shared';
import { api } from './api';

/** Settings → Library and Picks. */
export const saveAppSettings = (patch: Partial<SettingsResponse['app']>) =>
  api('/api/settings/app', { method: 'PUT', json: patch });

export const syncNow = () => api('/api/sync', { json: {} });

/** A new address for Radarr's webhook; the old one stops working. */
export const renewWebhook = () => api('/api/settings/webhook', { json: {} });

/** Radarr, or Seerr: an address and an API key (none keeps the saved one, for the same address). */
export const saveRadarr = (url: string, apiKey?: string) => api('/api/setup/radarr', { json: { url, apiKey } });
export const saveSeerr = (url: string, apiKey?: string) =>
  api('/api/settings/seerr', { method: 'PUT', json: { url, apiKey } });
export const removeSeerr = () => api('/api/settings/seerr', { method: 'DELETE' });

export const showProfile = (id: number, show: boolean) =>
  api(`/api/profiles/${id}`, { method: 'PATCH', json: { hidden: !show } });

/** A PIN Curatorr keeps for a Jellyfin profile; null takes it away. */
export const setProfilePin = (id: number, pin: string | null) =>
  api(`/api/profiles/${id}/pin`, { method: 'PUT', json: { pin } });

/** Turns the media server's users into profiles: who became one. */
export const importUsers = (server: MediaServer) =>
  api<ImportedProfile[]>(`/api/setup/${server}/users`, { json: {} });

export const skipServer = () => api('/api/setup/server/skip', { json: {} });
export const completeSetup = () => api('/api/setup/complete', { json: {} });

/** Signing out of settings on this device, or every other device. */
export const signOutHere = () => api('/api/admin/logout', { json: {} });
export const signOutEverywhere = () => api('/api/settings/sign-out-everywhere', { json: {} });

/** The Plex servers the signed-in owner can use. Trying each of their addresses takes a while. */
export const plexServers = () => api<PlexServerOption[]>('/api/setup/plex/servers', { timeout: 60_000 });
export const choosePlexServer = (server: { machineId: string; url: string; name: string }) =>
  api<ServerLibraries>('/api/setup/plex/server', { json: server });
export const savePlexLibraries = (sectionIds: string[]) => api('/api/setup/plex/libraries', { json: { sectionIds } });

/** Connects Jellyfin as an administrator: no password keeps the sign-in made at the same address. */
export const connectJellyfin = (form: { url: string; username: string; password?: string; publicUrl: string }) =>
  api<ServerLibraries>('/api/setup/jellyfin', { json: form });
export const saveJellyfinLibraries = (libraryIds: string[]) =>
  api('/api/setup/jellyfin/libraries', { json: { libraryIds } });

/** A Jellyfin administrator signs in to manage Curatorr on this device. */
export const jellyfinSignIn = (username: string, password: string) =>
  api('/api/jellyfin/login', { json: { username, password } });

/** Setup's steps, in order. */
export type SetupStep = 'radarr' | 'server' | 'seerr' | 'finish';

/**
 * After a reload, setup carries on at the first step still to do. The server is done once its users are profiles, or
 * once it was skipped, which leaves a profile of Curatorr's own; Seerr needs a server, so finishing is all that's left.
 */
export function resumeAt(s: SettingsResponse | undefined): SetupStep {
  if (!s?.radarr) return 'radarr';
  if (!s.server && s.profiles.length) return 'finish';
  if (!s.profiles.some((p) => p.serverUser)) return 'server';
  return s.seerr ? 'finish' : 'seerr';
}
