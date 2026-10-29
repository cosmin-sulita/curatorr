import type { AppStatus, Pick } from '@curatorr/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import type { ForWhomKind } from '../../components/ForWhom';
import { useToast } from '../../components/Toast';
import { errorMessage, refreshQuestions, removeFromWatchlist, sendFeedback, undoAll } from '../../lib/api';
import { fallBackIfStillHere, serverName, vibrate, type WatchLink } from '../../lib/format';
import { markMessage, unwatchlistMessage, withWatchlist, type Decline } from '../../lib/marks';
import { justArrived } from '../../lib/router';
import type { PickQueue } from './usePickQueue';

/**
 * What a pick's buttons do: each mark takes effect on screen at once, is saved, says how it went in a toast with Undo,
 * and refreshes what it changes. Watching together, Seen it, Watchlist and Never first `ask` who they're for, and so
 * does taking a movie off the watchlist.
 */
export function usePickActions({
  queue,
  status,
  ask,
}: {
  queue: PickQueue;
  status: AppStatus | undefined;
  ask: (kind: ForWhomKind, pick: Pick) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const people = status?.profile ? [status.profile, ...status.together] : [];
  const together = people.length > 1;
  const name = serverName(status?.server);
  const server = status?.server ?? null;

  // The actions ignore the second tap of a double tap that opened this screen (the bar sits where answers were).
  // `target`: a pick from "Other good picks", marked from its poster's menu; otherwise the pick on screen.
  const decline = (kind: Decline, profileIds?: number[], target?: Pick) => {
    const pick = target ?? queue.current;
    if (!pick || justArrived()) return;
    if (together && kind !== 'skipped' && !profileIds) {
      ask(kind, pick);
      return;
    }
    const who = profileIds?.flatMap((id) => people.find((p) => p.id === id)?.name ?? []);
    vibrate();
    // Undo puts it back where it was.
    const putBack = queue.take(pick);
    // A skip only demotes the movie; the other marks change what the questions can offer
    // (and Seen it adds to "Something like…"'s recently watched), and so does undoing them.
    const refresh = () => {
      if (kind !== 'skipped') refreshQuestions(qc);
    };
    sendFeedback(pick.movie.id, kind, { profileIds })
      .then(({ ids, server: result }) => {
        refresh();
        toast({
          message: markMessage(kind, pick.movie.title, result, server, who),
          duration: kind === 'skipped' ? 3000 : undefined,
          action: {
            label: 'Undo',
            run: () => {
              putBack();
              undoAll(ids)
                .then((res) => {
                  refresh();
                  if (res.partial) toast({ message: `Undone, but not for everyone: ${errorMessage(res.partial)}` });
                  else if (res.server === 'failed') toast({ message: `Undone here, but ${name} couldn't be updated` });
                })
                .catch((err) => toast({ message: errorMessage(err) }));
            },
          },
        });
      })
      .catch((err) => {
        // Nothing was saved, so the pick stays to be marked again.
        putBack();
        toast({ message: errorMessage(err) });
      });
  };

  // Takes the pick off the watchlist (watching together, off the watchlists the sheet names). It stays on screen.
  const unwatchlist = (profileIds?: number[], target?: Pick) => {
    const pick = target ?? queue.current;
    if (!pick || justArrived()) return;
    if (together && !profileIds) {
      ask('unwatchlist', pick);
      return;
    }
    const targets = profileIds ?? people.map((p) => p.id);
    const names = (ids: number[]) => people.filter((p) => ids.includes(p.id)).map((p) => p.name);
    vibrate();
    queue.replace(withWatchlist(pick, pick.onWatchlistOf.filter((id) => !targets.includes(id)), people));
    removeFromWatchlist(pick.movie.id, profileIds)
      .then(({ server: result, onWatchlistOf }) => {
        const after = withWatchlist(pick, onWatchlistOf, people);
        queue.replace(after);
        refreshQuestions(qc);
        const off = targets.filter((id) => !onWatchlistOf.includes(id));
        const kept = targets.filter((id) => onWatchlistOf.includes(id));
        toast({
          message: unwatchlistMessage(pick.movie.title, result, server, { off: names(off), kept: names(kept), together }),
          // Nothing to undo when it stayed on.
          action: off.length
            ? {
                label: 'Undo',
                run: () => {
                  queue.replace(pick);
                  sendFeedback(pick.movie.id, 'later', together ? { profileIds: off } : {})
                    .then((res) => {
                      refreshQuestions(qc);
                      if (res.server === 'failed') toast({ message: `Undone here, but ${name} couldn't be updated` });
                    })
                    .catch((err) => {
                      queue.replace(after);
                      toast({ message: errorMessage(err) });
                    });
                },
              }
            : undefined,
        });
      })
      .catch((err) => {
        // Nothing changed, so the pick is as it was.
        queue.replace(pick);
        toast({ message: errorMessage(err) });
      });
  };

  // The tap on the link itself does the navigation; this only records it (and handles demo mode).
  const watch = (e: MouseEvent<HTMLAnchorElement>, link: WatchLink) => {
    if (justArrived()) {
      e.preventDefault();
      return;
    }
    if (!queue.current) return;
    if (status?.demo) {
      e.preventDefault();
      toast({ message: 'Demo mode: connect Plex or Jellyfin in setup to play movies.' });
      return;
    }
    sendFeedback(queue.current.movie.id, 'accepted', { keepalive: true }).catch(() => {});
    if (link.fallback) fallBackIfStillHere(link.fallback);
  };

  return { people, decline, unwatchlist, watch };
}
