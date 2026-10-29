import { afterEach, describe, expect, it, vi } from 'vitest';
import { listNames, plural, relativeTime, runtime, serverCopy, serverName, watchLink } from './format';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0';
const onDevice = (userAgent: string) => vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 0 });

afterEach(() => vi.unstubAllGlobals());

describe('watch links', () => {
  const app = 'https://watch.plex.tv/movie/heat';
  const web = 'https://app.plex.tv/desktop/#!/server/m/details?key=1';

  it('sends phones to watch.plex.tv, in the same tab', () => {
    onDevice(IPHONE);
    expect(watchLink(app, web)).toEqual({ href: app, newTab: false, fallback: null });
  });

  it("falls back to Plex Web when a plex:// link opens no app", () => {
    onDevice(IPHONE);
    expect(watchLink('plex://preplay/?metadataKey=1', web)).toEqual({ href: 'plex://preplay/?metadataKey=1', newTab: false, fallback: web });
  });

  it('opens Plex Web (or Jellyfin) in a new tab on a computer, and nothing without an address', () => {
    onDevice(DESKTOP);
    expect(watchLink(app, web)).toEqual({ href: web, newTab: true, fallback: null });
    expect(watchLink(null, null)).toBeNull();
  });
});

describe('words', () => {
  it('lists names as a sentence does', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A and B');
    expect(listNames(['A', 'B', 'C'], ' & ')).toBe('A, B & C');
  });

  it('counts, and writes a length', () => {
    expect(plural(1, 'movie')).toBe('1 movie');
    expect(plural(3, 'movie')).toBe('3 movies');
    expect(runtime(125)).toBe('2h 05m');
    expect(runtime(null)).toBeNull();
  });

  it('says how long ago', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-29T20:00:00Z') });
    try {
      expect(relativeTime(null)).toBe('never');
      expect(relativeTime(Date.now() - 2 * 60 * 60_000)).toBe('2 h ago');
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the media server, and Plex's words without one", () => {
    expect(serverName('jellyfin')).toBe('Jellyfin');
    expect(serverName(null)).toBe('Plex');
    expect(serverCopy('jellyfin').watchlist).toBe('Jellyfin favourites');
    expect(serverCopy(undefined).onWatchlist).toBe('on your Plex Watchlist');
  });
});
