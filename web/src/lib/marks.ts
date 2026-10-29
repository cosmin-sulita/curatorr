// The profile's marks as the app words and lists them: the toasts after a mark, and the lists Settings opens.
import { wantedReasons, type MediaServer, type Pick, type Profile } from '@curatorr/shared';
import { Ban, Bookmark, BookmarkMinus, Eye, RotateCcw, type LucideIcon } from 'lucide-react';
import type { HiddenMovie, ServerSyncResult } from './api';
import { listNames, serverCopy, serverName } from './format';

/** What a pick's buttons do with it. `later` is the Watchlist button's internal name. */
export type Decline = 'skipped' | 'later' | 'seen' | 'never';

/** Toast after a mark, depending on what happened on the media server. Watching together, it names `who`. */
export function markMessage(
  kind: Decline,
  title: string,
  result: ServerSyncResult | undefined,
  server: MediaServer | null,
  who?: string[],
) {
  const name = serverName(server);
  if (kind === 'skipped') return `Not tonight: ${title}`;
  if (who) {
    const failed = result === 'failed' ? `, but couldn't update ${name}` : '';
    if (kind === 'never') return `${title} won't be suggested to ${listNames(who)} again`;
    if (kind === 'seen') return `Marked ${title} as seen for ${listNames(who)}${failed}`;
    const lists = listNames(who.map((n) => `${n}'s`));
    return `Added ${title} to ${lists} ${who.length > 1 ? 'watchlists' : 'watchlist'}${failed}`;
  }
  if (kind === 'never') return `${title} won't be suggested again`;
  if (kind === 'later') {
    if (result === 'synced' || result === 'already') return `${title} is ${serverCopy(server).onWatchlist}`;
    if (result === 'failed') return `Added ${title} to your watchlist, but couldn't reach ${name}`;
    return `Added ${title} to your watchlist`;
  }
  if (result === 'synced') return `Marked ${title} as ${serverCopy(server).watched} in ${name}`;
  if (result === 'failed') return `Marked ${title} as seen, but couldn't update ${name}`;
  return `Marked ${title} as seen`;
}

/** The pick once it's on these people's watchlists only: its chip names who's left, or goes. */
export function withWatchlist(pick: Pick, profileIds: number[], people: Profile[]): Pick {
  const names = people.filter((p) => profileIds.includes(p.id)).map((p) => p.name);
  const who = people.length > 1 ? { requested: [], watchlist: names } : undefined;
  const [chip] = profileIds.length ? wantedReasons({ onWatchlist: true, requested: false }, who) : [];
  const reasons = pick.reasons.flatMap((r) => (r.kind !== 'watchlist' ? [r] : chip ? [chip] : []));
  return { ...pick, onWatchlistOf: profileIds, reasons };
}

/**
 * Toast after taking a movie off watchlists: `off` names whose it came off, `kept` whose it's still on (the
 * server couldn't be reached, or the owner keeps Curatorr from changing an entry made there). Settings' watchlist
 * says the same.
 */
export function unwatchlistMessage(
  title: string,
  result: ServerSyncResult,
  server: MediaServer | null,
  { off, kept, together }: { off: string[]; kept: string[]; together: boolean },
) {
  const name = serverName(server);
  const unreachable = result === 'failed' ? `Couldn't reach ${name}, so ` : '';
  if (together) {
    const lists = (names: string[]) =>
      `${listNames(names.map((n) => `${n}'s`))} ${names.length > 1 ? 'watchlists' : 'watchlist'}`;
    if (!off.length) return `${unreachable}${title} is still on ${lists(kept)}`;
    return `Removed ${title} from ${lists(off)}${kept.length ? `, but it's still on ${lists(kept)}` : ''}`;
  }
  const copy = serverCopy(server);
  if (!off.length) {
    if (unreachable) return `${unreachable}${title} is still on your watchlist`;
    return `${title} is still ${copy.onWatchlist}`;
  }
  return `Removed ${title} from your ${result === 'synced' ? copy.watchlist : 'watchlist'}`;
}

export type MarkListId = 'watchlist' | 'seen' | 'never';

export interface MarkList {
  id: MarkListId;
  kind: HiddenMovie['kind'];
  title: string;
  Icon: LucideIcon;
  /** What the list is, with the media server Curatorr uses. */
  lede: (server: MediaServer | null) => string;
  /** How a movie gets on the list, for an empty one. */
  hint: (server: MediaServer | null) => string;
  action: 'Remove' | 'Restore';
  ActionIcon: LucideIcon;
}

/** The profile's lists, named and ordered like the buttons on a pick. `later` is the Watchlist's internal name. */
export const MARK_LISTS: MarkList[] = [
  {
    id: 'watchlist',
    kind: 'later',
    title: 'Watchlist',
    Icon: Bookmark,
    // Only movies in the library: the server's watchlist can hold anything.
    // Without a media server there's no watchlist of its own to add.
    lede: (server) =>
      server
        ? `Movies ${serverCopy(server).onWatchlist} that are in your library, and ones you added from a pick. Picks favour them.`
        : 'Movies you added from a pick. Picks favour them.',
    hint: (server) =>
      server
        ? `Tap Watchlist on a pick, or add a movie to your ${serverCopy(server).watchlist}`
        : 'Tap Watchlist on a pick to save it',
    action: 'Remove',
    ActionIcon: BookmarkMinus,
  },
  {
    id: 'seen',
    kind: 'seen',
    title: 'Seen it',
    Icon: Eye,
    lede: () => 'Movies you marked as seen. Restore one to see it in picks again.',
    hint: () => "Tap Seen it on a pick you've watched",
    action: 'Restore',
    ActionIcon: RotateCcw,
  },
  {
    id: 'never',
    kind: 'never',
    title: 'Never',
    Icon: Ban,
    lede: () => "Movies that won't be suggested to you. Restore one to see it in picks again.",
    hint: () => "Tap Never on a pick you don't want",
    action: 'Restore',
    ActionIcon: RotateCcw,
  },
];

export const isMarkList = (id: string | undefined): id is MarkListId => MARK_LISTS.some((l) => l.id === id);
