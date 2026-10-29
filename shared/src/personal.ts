// What the profile did and wants: skips, picks it passed over, its watchlist and requests, new arrivals, and the
// daily shuffle. "Something like…" adds these as they are; the wizard's picks weigh what's wanted more (ranking.ts).
import { DAY, pickingDay } from './clock.js';
import type { RankOptions } from './ranking.js';
import { daysInLibrary } from './shelves.js';
import type { FeedbackEvent, Movie, Reason } from './types.js';

/** "Not tonight" keeps a movie down for two weeks, and two more for each other skip in the last 90 days. */
const SKIP_PENALTY = 15;
const SKIP_WINDOW = 14 * DAY;
const SKIP_MEMORY = 90 * DAY;
/**
 * The first earlier evening a pick was shown and not played costs this, the second twice as much, and so on, for a
 * month: 4, 12, 24, 40 in all. A movie passed over night after night makes way, however well rated it is.
 */
const SHOWN_PENALTY = 4;
const SHOWN_WINDOW = 30 * DAY;
/** A pick shown this evening isn't demoted yet, so answering the same way again gives the same pick. */
const SHOWN_GRACE = 3 * 60 * 60 * 1000;
const JITTER = 1.5;
/**
 * Movies the profile wants to watch: on its media server's watchlist or added with "Watchlist" in a pick. As for the
 * two bonuses below, the wizard's picks count WANTED_WEIGHT times this (ranking.ts).
 */
const WATCHLIST_BONUS = 6;
/** Movies the profile asked for in Seerr and hasn't watched yet. */
const REQUEST_BONUS = 8;
/**
 * Movies that just arrived: half of what a household watches is under a month old in the library.
 * The bonus fades with the days since the movie's file arrived, not since Radarr added it: a movie
 * requested before its release would look old by the time it lands.
 */
const ADDED_BONUS = 12;
const ADDED_FADE_DAYS = 21;
/** The "Added … ago" chip shows while the bonus is at least this (about two weeks). */
const ADDED_CHIP_BONUS = 6;

/** Small deterministic hash → [0, 1). Keeps the order stable for a day, then rotates it. */
export function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * The movies a profile wants to watch: on its media server's watchlist (the Plex Watchlist, Jellyfin favourites), or
 * saved with Watchlist in Curatorr. The ranking's bonus and the pick's "On watchlist" both go by this.
 */
export function wantedIds(watchlist: Iterable<number> | undefined, feedback: FeedbackEvent[]): Set<number> {
  return new Set([...(watchlist ?? []), ...latestByKind(feedback, 'later').keys()]);
}

function latestByKind(feedback: FeedbackEvent[], kind: FeedbackEvent['kind']) {
  const map = new Map<number, number>();
  for (const e of feedback) {
    if (e.kind !== kind) continue;
    map.set(e.movieId, Math.max(map.get(e.movieId) ?? 0, e.createdAt));
  }
  return map;
}

/** What the profile did lately, looked up once per ranking. */
export interface ProfileSignals {
  /** When each movie was last skipped, and how many times in the last 90 days. */
  skips: Map<number, { last: number; count: number }>;
  /** On how many earlier evenings of the last month each movie was shown. */
  shownEvenings: Map<number, number>;
  wanted: Set<number>;
  requested: Set<number>;
  day: string;
}

export function profileSignals(feedback: FeedbackEvent[], opts: RankOptions): ProfileSignals {
  const skips = new Map<number, { last: number; count: number }>();
  const shownDays = new Map<number, Set<string>>();
  for (const e of feedback) {
    const age = opts.now - e.createdAt;
    if (e.kind === 'skipped' && age < SKIP_MEMORY) {
      const s = skips.get(e.movieId);
      skips.set(e.movieId, { last: Math.max(s?.last ?? 0, e.createdAt), count: (s?.count ?? 0) + 1 });
    } else if (e.kind === 'shown' && age > SHOWN_GRACE && age < SHOWN_WINDOW) {
      // Shown twice in one evening is still one evening.
      const days = shownDays.get(e.movieId) ?? new Set<string>();
      days.add(pickingDay(e.createdAt));
      shownDays.set(e.movieId, days);
    }
  }
  return {
    skips,
    shownEvenings: new Map([...shownDays].map(([id, days]) => [id, days.size])),
    wanted: wantedIds(opts.watchlist, feedback),
    requested: opts.requested ?? new Set(),
    day: pickingDay(opts.now),
  };
}

/** Skip and shown penalties, the request or watchlist bonus, the newly added bonus and the daily jitter. */
export function personalAdjustment(m: Movie, s: ProfileSignals, opts: RankOptions) {
  const skip = s.skips.get(m.id);
  const shown = s.shownEvenings.get(m.id) ?? 0;
  const onWatchlist = s.wanted.has(m.id);
  const requested = s.requested.has(m.id);
  const days = daysInLibrary(m, opts.now);
  const parts = {
    skip: skip && opts.now - skip.last < SKIP_WINDOW * skip.count ? -SKIP_PENALTY : 0,
    shown: -(SHOWN_PENALTY * shown * (shown + 1)) / 2,
    // Seerr can auto-request Watchlist items, so the two bonuses don't stack: it's one wish.
    wanted: requested ? REQUEST_BONUS : onWatchlist ? WATCHLIST_BONUS : 0,
    arrival: days == null ? 0 : ADDED_BONUS * Math.exp(-days / ADDED_FADE_DAYS),
    jitter: (seededUnit(`${opts.seed}|${s.day}|${m.id}`) * 2 - 1) * JITTER,
  };
  const delta = parts.skip + parts.shown + parts.wanted + parts.arrival + parts.jitter;
  return { delta, parts, onWatchlist, requested, addedDaysAgo: parts.arrival >= ADDED_CHIP_BONUS ? days : null };
}

/** Who wants a movie, when several watch together: who requested it, and whose watchlist it's on. */
export interface WantedBy {
  requested: string[];
  watchlist: string[];
}

/** "Alex", "Alex and Sam", "Alex, Sam and Kids"; `last` joins the final two. */
export function listNames(names: string[], last = ' and ') {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}${last}${names.at(-1)}` : (names[0] ?? '');
}

/** Chips for movies the profile wants to watch: requested in Seerr first, then the watchlist. Groups name who. */
export function wantedReasons(adj: { onWatchlist: boolean; requested: boolean }, who?: WantedBy): Reason[] {
  const requested = who?.requested.length ? `${listNames(who.requested)} requested this` : 'You requested this';
  const lists = who?.watchlist.length ?? 0;
  const watchlist = lists
    ? `On ${listNames(who!.watchlist.map((name) => `${name}'s`))} ${lists > 1 ? 'watchlists' : 'watchlist'}`
    : 'On your watchlist';
  return [
    ...(adj.requested ? [{ kind: 'requested' as const, label: requested }] : []),
    ...(adj.onWatchlist ? [{ kind: 'watchlist' as const, label: watchlist }] : []),
  ];
}

/** The chip for a movie that just arrived in the library. */
export function addedReasons(adj: { addedDaysAgo: number | null }): Reason[] {
  if (adj.addedDaysAgo == null) return [];
  const days = Math.floor(adj.addedDaysAgo);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return [{ kind: 'added', label: `Added ${when}` }];
}
