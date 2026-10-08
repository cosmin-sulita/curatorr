import { parseChangelog, releasesSince } from '@curatorr/shared';
import changelog from '../../../CHANGELOG.md?raw';

// Bundled with the app, so the notes always describe the code that's running.
export const releases = parseChangelog(changelog);
export const appVersion = releases[0]?.version ?? 'dev';

const KEY = 'curatorr:lastSeenVersion';

function lastSeen() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Releases this device hasn't been told about yet. */
export const unseenReleases = () => releasesSince(releases, lastSeen());

export function markSeen() {
  try {
    localStorage.setItem(KEY, appVersion);
  } catch {
    // Storage blocked: the popup may show again next time, which is harmless.
  }
}
