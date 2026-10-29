/** What changed in one version of Curatorr, as shown in the "What's new" popup. */
export interface Release {
  version: string;
  date: string | null;
  /** Hand-written text under the version heading, if any. */
  intro: string;
  notes: ReleaseNote[];
}

export interface ReleaseNote {
  kind: 'new' | 'fix' | 'improved';
  text: string;
}

// Only these commit types are worth telling people about; chore, ci, docs, refactor... stay in the changelog.
const KINDS: Record<string, ReleaseNote['kind']> = { feat: 'new', fix: 'fix', perf: 'improved' };

/** A release's version, x.y.z. The app, the server's update check and the What's new popup all read it this way. */
export const isVersion = (s: string) => /^\d+\.\d+\.\d+$/.test(s);

/** A link to the commit after a bullet's subject: "([fd564ac](https://...))". */
const COMMIT_LINK = /\s*\(\[[0-9a-f]+\]\([^)]*\)\)$/i;

/**
 * Parses CHANGELOG.md into releases, newest first. Each bullet is a Conventional Commit subject; text before the first
 * bullet is the release's intro, and an indented line after one carries on that bullet. Any other `## ` heading ends
 * the release above it.
 */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  /** The bullet a wrapped line carries on: a note, or one of a kind that isn't shown. */
  let bullet: ReleaseNote | 'hidden' | null = null;

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      const heading = /^## (\d+\.\d+\.\d+)(?: \((.+)\))?$/.exec(line);
      current = heading ? { version: heading[1]!, date: heading[2] ?? null, intro: '', notes: [] } : null;
      if (current) releases.push(current);
      bullet = null;
      continue;
    }
    if (!current || !line || line.startsWith('#')) continue;

    if (line.startsWith('- ')) {
      const subject = line.slice(2).replace(COMMIT_LINK, '');
      const commit = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject);
      const kind = commit && KINDS[commit[1]!.toLowerCase()];
      bullet = kind ? { kind, text: commit[2]!.charAt(0).toUpperCase() + commit[2]!.slice(1) } : 'hidden';
      if (bullet !== 'hidden') current.notes.push(bullet);
    } else if (bullet) {
      // A long bullet wrapped onto the next line.
      if (bullet !== 'hidden') bullet.text = `${bullet.text} ${line.replace(COMMIT_LINK, '')}`;
    } else {
      current.intro = current.intro ? `${current.intro} ${line}` : line;
    }
  }
  return releases;
}

/** Numeric comparison of two x.y.z versions: negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

const hasNews = (r: Release) => r.notes.length > 0 || r.intro !== '';

/**
 * Whether these releases are worth interrupting someone for: a new feature or a hand-written
 * intro. Fixes alone stay in the Settings list instead of popping up.
 */
export const hasHeadlineNews = (releases: Release[]) =>
  releases.some((r) => r.intro !== '' || r.notes.some((n) => n.kind === 'new'));

/** How many releases to show when it's unknown what someone has already seen. */
const RECENT = 3;

/**
 * The releases to show someone who last opened `lastSeen`: everything newer that has something to say.
 * Without a usable last-seen version (a device from before the popup existed), the latest few that do.
 */
export function releasesSince(releases: Release[], lastSeen: string | null): Release[] {
  const withNews = releases.filter(hasNews);
  if (!lastSeen || !isVersion(lastSeen)) return withNews.slice(0, RECENT);
  return withNews.filter((r) => compareVersions(r.version, lastSeen) > 0);
}
