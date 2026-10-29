import type { Pick, Profile } from '@curatorr/shared';
import { describe, expect, it } from 'vitest';
import { isMarkList, markMessage, unwatchlistMessage, withWatchlist } from './marks';

const person = (id: number, name: string): Profile => ({
  id,
  name,
  avatarUrl: null,
  isAdmin: false,
  restrictionProfile: null,
  pinProtected: false,
  linked: true,
});

describe('what a mark says', () => {
  it('tells what happened on the media server', () => {
    expect(markMessage('later', 'Heat', 'synced', 'plex')).toBe('Heat is on your Plex Watchlist');
    expect(markMessage('later', 'Heat', 'synced', 'jellyfin')).toBe('Heat is in your Jellyfin favourites');
    expect(markMessage('later', 'Heat', 'failed', 'plex')).toBe("Added Heat to your watchlist, but couldn't reach Plex");
    expect(markMessage('seen', 'Heat', 'synced', 'jellyfin')).toBe('Marked Heat as played in Jellyfin');
    expect(markMessage('seen', 'Heat', 'skipped', null)).toBe('Marked Heat as seen');
    expect(markMessage('skipped', 'Heat', undefined, 'plex')).toBe('Not tonight: Heat');
  });

  it('names who, when several watch together', () => {
    expect(markMessage('never', 'Heat', undefined, 'plex', ['A', 'B'])).toBe("Heat won't be suggested to A and B again");
    expect(markMessage('later', 'Heat', 'failed', 'plex', ['A', 'B'])).toBe(
      "Added Heat to A's and B's watchlists, but couldn't update Plex",
    );
  });

  it('says whose watchlist a movie came off, and whose it stays on', () => {
    expect(unwatchlistMessage('Heat', 'synced', 'plex', { off: ['A'], kept: [], together: false })).toBe(
      'Removed Heat from your Plex Watchlist',
    );
    expect(unwatchlistMessage('Heat', 'skipped', 'plex', { off: [], kept: ['A'], together: false })).toBe(
      'Heat is still on your Plex Watchlist',
    );
    expect(unwatchlistMessage('Heat', 'failed', 'plex', { off: [], kept: [], together: false })).toBe(
      "Couldn't reach Plex, so Heat is still on your watchlist",
    );
    expect(unwatchlistMessage('Heat', 'synced', 'plex', { off: ['A'], kept: ['B'], together: true })).toBe(
      "Removed Heat from A's watchlist, but it's still on B's watchlist",
    );
  });
});

describe('a pick taken off watchlists', () => {
  const pick = {
    movie: { id: 1 },
    reasons: [
      { kind: 'watchlist', label: "On A's and B's watchlists" },
      { kind: 'theme', label: 'Heist' },
    ],
    onWatchlistOf: [1, 2],
  } as unknown as Pick;

  it("names who's left in its chip", () => {
    const left = withWatchlist(pick, [2], [person(1, 'A'), person(2, 'B')]);
    expect(left.onWatchlistOf).toEqual([2]);
    expect(left.reasons).toEqual([
      { kind: 'watchlist', label: "On B's watchlist" },
      { kind: 'theme', label: 'Heist' },
    ]);
  });

  it('drops the chip once nobody has it', () => {
    expect(withWatchlist(pick, [], [person(1, 'A')]).reasons).toEqual([{ kind: 'theme', label: 'Heist' }]);
  });
});

it("knows the profile's lists by their address", () => {
  expect(isMarkList('watchlist')).toBe(true);
  expect(isMarkList('later')).toBe(false);
});
