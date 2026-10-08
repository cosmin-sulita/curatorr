import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseChangelog, releasesSince, type Release } from './changelog.js';

const sample = `# Changelog

The commits in each version of Curatorr, newest first.

## 0.3.0 (2026-11-01)

Picks got smarter.

- feat(pick): suggest something shorter after 10 pm ([abc1234](https://github.com/x/curatorr/commit/abc1234))
- perf(sync): sync large libraries faster ([abc1235](https://github.com/x/curatorr/commit/abc1235))
- chore(docker): bump the base image ([abc1236](https://github.com/x/curatorr/commit/abc1236))

## 0.2.2 (2026-10-20)

- ci: cache the docker build ([abc1237](https://github.com/x/curatorr/commit/abc1237))

## 0.2.1 (2026-10-08)

- fix(plex): open picks in the redesigned Plex apps ([fd564ac](https://github.com/x/curatorr/commit/fd564ac))

## 0.1.0 (2026-10-08)

First release.

- Release 0.1.0 ([ee95770](https://github.com/x/curatorr/commit/ee95770))
`;

const versions = (rs: Release[]) => rs.map((r) => r.version);

describe('parseChangelog', () => {
  const releases = parseChangelog(sample);

  it('reads every release, newest first', () => {
    expect(versions(releases)).toEqual(['0.3.0', '0.2.2', '0.2.1', '0.1.0']);
    expect(releases[0]!.date).toBe('2026-11-01');
  });

  it('keeps user-facing commits as readable sentences', () => {
    expect(releases[0]!.notes).toEqual([
      { kind: 'new', text: 'Suggest something shorter after 10 pm' },
      { kind: 'improved', text: 'Sync large libraries faster' },
    ]);
    expect(releases[2]!.notes).toEqual([{ kind: 'fix', text: 'Open picks in the redesigned Plex apps' }]);
  });

  it('drops housekeeping and non-commit lines, keeps the intro', () => {
    expect(releases[1]!.notes).toEqual([]);
    expect(releases[3]).toMatchObject({ intro: 'First release.', notes: [] });
    expect(releases[0]!.intro).toBe('Picks got smarter.');
  });

  it("parses the repo's own CHANGELOG.md", () => {
    const real = parseChangelog(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'));
    expect(real[0]?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(real.find((r) => r.version === '0.2.1')?.notes).toContainEqual({
      kind: 'fix',
      text: 'Open picks in the redesigned Plex apps',
    });
  });
});

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.2.1', '0.3.0')).toBeLessThan(0);
  });
});

describe('releasesSince', () => {
  const releases = parseChangelog(sample);

  it('lists every newer release that has something to say', () => {
    expect(versions(releasesSince(releases, '0.2.0'))).toEqual(['0.3.0', '0.2.1']);
    expect(versions(releasesSince(releases, '0.2.1'))).toEqual(['0.3.0']);
  });

  it('shows only the newest release without a usable last-seen version', () => {
    expect(versions(releasesSince(releases, null))).toEqual(['0.3.0']);
    expect(versions(releasesSince(releases, 'dev'))).toEqual(['0.3.0']);
    expect(versions(releasesSince(releases, 'latest'))).toEqual(['0.3.0']);
  });

  it('shows nothing when up to date, downgraded, or the news is all housekeeping', () => {
    expect(releasesSince(releases, '0.3.0')).toEqual([]);
    expect(releasesSince(releases, '9.9.9')).toEqual([]);
    expect(releasesSince(releases.slice(1), '0.2.1')).toEqual([]);
  });
});
