import { parseChangelog, releasesSince } from '@curatorr/shared';
import changelog from '../../../CHANGELOG.md?raw';
import { readStored, writeStored } from './storage';

// Bundled with the app, so the notes always describe the code that's running.
export const releases = parseChangelog(changelog);
export const appVersion = releases[0]?.version ?? 'dev';
/** The latest few releases with something to say, for the "What's new" link in Settings. */
export const recentReleases = releasesSince(releases, null);

const KEY = 'curatorr:lastSeenVersion';

/** Releases this device hasn't been told about yet. */
export const unseenReleases = () => releasesSince(releases, readStored(KEY));

/** Where storage is blocked, the popup may show again next time, which is harmless. */
export const markSeen = () => writeStored(KEY, appVersion);
