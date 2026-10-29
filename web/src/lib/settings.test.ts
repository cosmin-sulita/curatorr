import type { SettingsProfile, SettingsResponse } from '@curatorr/shared';
import { describe, expect, it } from 'vitest';
import { sized } from './pictures';
import { resumeAt } from './settings';

const profile = (serverUser: boolean) => ({ serverUser }) as SettingsProfile;
const settings = (over: Partial<SettingsResponse>) =>
  ({ radarr: null, server: null, seerr: null, profiles: [], ...over }) as unknown as SettingsResponse;

describe('where setup carries on after a reload', () => {
  const radarr = { url: 'http://radarr', hasApiKey: true };

  it('starts at Radarr, before anything is saved or while the settings are unknown', () => {
    expect(resumeAt(undefined)).toBe('radarr');
    expect(resumeAt(settings({}))).toBe('radarr');
  });

  it('asks for the media server until its users are profiles', () => {
    expect(resumeAt(settings({ radarr }))).toBe('server');
    expect(resumeAt(settings({ radarr, server: 'plex', profiles: [profile(false)] }))).toBe('server');
  });

  it('offers Seerr after the media server, and finishes once it is connected', () => {
    expect(resumeAt(settings({ radarr, server: 'plex', profiles: [profile(true)] }))).toBe('seerr');
    const seerr = { url: 'http://seerr' } as SettingsResponse['seerr'];
    expect(resumeAt(settings({ radarr, server: 'plex', profiles: [profile(true)], seerr }))).toBe('finish');
  });

  it("finishes after the media server was skipped, which leaves a profile of Curatorr's own", () => {
    expect(resumeAt(settings({ radarr, profiles: [profile(false)] }))).toBe('finish');
  });
});

describe('picture sizes', () => {
  it('asks TMDB for another width, and leaves other pictures as they are', () => {
    expect(sized('https://image.tmdb.org/t/p/w500/p.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/p.jpg');
    expect(sized('/api/image/1/poster', 'w185')).toBe('/api/image/1/poster');
    expect(sized(null, 'w185')).toBeNull();
  });
});
