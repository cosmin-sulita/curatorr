import { compareVersions, isVersion, type AppStatus } from '@curatorr/shared';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { requestJson } from '../http.js';
import type { Store } from '../store.js';

const REPO = 'cosmin-sulita/curatorr';
/**
 * CI publishes a release only once its image is on ghcr.io, so the latest release is the newest image there is.
 * GitHub's "latest" leaves out drafts and pre-releases.
 */
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
/** GitHub allows 60 requests an hour without a token: this is 4 a day. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** The release to tell admins about: one newer than the running version. A build from source (`dev`) has none. */
export function updateFor(running: string, latest: string | null): AppStatus['update'] {
  if (!latest || !isVersion(running) || compareVersions(latest, running) <= 0) return null;
  return { version: latest, url: `https://github.com/${REPO}/releases/tag/v${latest}` };
}

/** Reads the latest release's version from GitHub into the `latestVersion` setting. Never throws. */
export async function checkForUpdates(store: Store, log: FastifyBaseLogger, url = LATEST_RELEASE) {
  try {
    const release = await requestJson<{ tag_name?: unknown }>('GitHub', url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Curatorr/${config.version}` },
      timeoutMs: 10_000,
    });
    const tag = release.tag_name;
    const version = typeof tag === 'string' ? /^v?(\d+\.\d+\.\d+)$/.exec(tag)?.[1] : undefined;
    if (!version) throw new Error(`the latest release has no version in its tag (${JSON.stringify(tag)})`);
    if (version !== store.get('latestVersion') && updateFor(config.version, version)) {
      log.info(`Curatorr ${version} is out (running ${config.version})`);
    }
    store.set('latestVersion', version);
  } catch (err) {
    // Offline, rate limited or GitHub is down: the last version read stands until the next look.
    log.warn({ err: err instanceof Error ? err.message : err }, 'could not check GitHub for a new release');
  }
}

/** Looks when Curatorr starts, then every 6 hours. The timer doesn't keep the process alive. */
export function scheduleUpdateChecks(store: Store, log: FastifyBaseLogger) {
  if (!isVersion(config.version)) return () => {};
  const check = () => void checkForUpdates(store, log);
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
