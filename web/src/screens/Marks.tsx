import { useQueryClient } from '@tanstack/react-query';
import { Ban, Bookmark, BookmarkMinus, Eye, RotateCcw, Search, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { BackButton, Shell } from '../components/Shell';
import { useToast } from '../components/Toast';
import { Button, Img, Notice, Spinner } from '../components/ui';
import {
  errorMessage,
  removeFromWatchlist,
  sendFeedback,
  undoFeedback,
  useHidden,
  useStatus,
  type HiddenMovie,
} from '../lib/api';
import { plural, serverName } from '../lib/format';
import { unwatchlistMessage } from './Pick';

export type MarkListId = 'watchlist' | 'seen' | 'never';

interface MarkList {
  id: MarkListId;
  kind: HiddenMovie['kind'];
  title: string;
  Icon: LucideIcon;
  /** What the list is. */
  lede: string;
  /** How a movie gets on the list, for an empty one. */
  hint: string;
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
    lede: 'Movies you added from a pick. Picks favour them.',
    hint: 'Tap Watchlist on a pick to save it',
    action: 'Remove',
    ActionIcon: BookmarkMinus,
  },
  {
    id: 'seen',
    kind: 'seen',
    title: 'Seen it',
    Icon: Eye,
    lede: 'Movies you marked as seen. Restore one to see it in picks again.',
    hint: "Tap Seen it on a pick you've watched",
    action: 'Restore',
    ActionIcon: RotateCcw,
  },
  {
    id: 'never',
    kind: 'never',
    title: 'Never',
    Icon: Ban,
    lede: "Movies that won't be suggested to you. Restore one to see it in picks again.",
    hint: "Tap Never on a pick you don't want",
    action: 'Restore',
    ActionIcon: RotateCcw,
  },
];

export const isMarkList = (id: string | undefined): id is MarkListId => MARK_LISTS.some((l) => l.id === id);

/** Posters shown at a time: each one is fetched as soon as it's on the page, and a list can grow to hundreds. */
const PAGE = 30;
/** Longer lists get a search field. */
const SEARCH_FROM = 12;

/** Lower case and without accents, so "amelie" finds Amélie. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Every movie on one of the profile's lists, newest first, each with Restore (or Remove, on the watchlist). */
export function MarksScreen({ list: id }: { list: MarkListId }) {
  const list = MARK_LISTS.find((l) => l.id === id)!;
  const { data: status } = useStatus();
  const server = serverName(status?.server);
  const marked = useHidden();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  // Restored here: off the page at once, and kept off while the list reloads, so a reload that started before
  // a second Restore went through can't bring that movie back for a moment.
  const [gone, setGone] = useState<ReadonlySet<number>>(() => new Set());
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const all = marked.data?.filter((m) => m.kind === list.kind && !gone.has(m.id)) ?? [];
  const q = fold(query.trim());
  const found = q ? all.filter((m) => fold(`${m.movie.title} ${m.movie.year ?? ''}`).includes(q)) : all;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['hidden'] });
    qc.invalidateQueries({ queryKey: ['wizard'] });
    qc.invalidateQueries({ queryKey: ['like'] });
    qc.removeQueries({ queryKey: ['recommendations'] });
  };

  // Undo marks the movie again.
  const undo = (h: HiddenMovie) => ({
    label: 'Undo',
    run: () =>
      sendFeedback(h.movie.id, h.kind)
        .then((r) => {
          if (r.server === 'failed') toast({ message: `Undone here, but ${server} couldn't be updated` });
        })
        .catch((err) => toast({ message: errorMessage(err) }))
        .finally(refresh),
  });

  // Like the marks on a pick: say what happened, and offer Undo.
  const unmark = async (h: HiddenMovie, e: MouseEvent<HTMLButtonElement>) => {
    // The button leaves with its movie, so keyboard focus moves on to the next movie's.
    const item = e.currentTarget.closest('li');
    const next = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector('button');
    if (document.activeElement === e.currentTarget) next?.focus();
    setGone((g) => new Set(g).add(h.id));
    try {
      if (h.kind === 'later') {
        // As "On watchlist" does on a pick: off the media server's watchlist too, unless it was put there in Plex
        // or Jellyfin while marks don't update the server. Then it's still on that one, with nothing to undo.
        const res = await removeFromWatchlist(h.movie.id);
        const who = [status?.profile?.name ?? ''];
        const kept = res.onWatchlistOf.includes(status?.profile?.id ?? -1);
        toast({
          message: unwatchlistMessage(h.movie.title, res.server, status?.server ?? null, {
            off: kept ? [] : who,
            kept: kept ? who : [],
            together: false,
          }),
          action: kept ? undefined : undo(h),
        });
      } else {
        const res = await undoFeedback(h.id);
        const done = `Restored ${h.movie.title}`;
        toast({ message: res.server === 'failed' ? `${done}, but couldn't update ${server}` : done, action: undo(h) });
      }
    } catch (err) {
      setGone((g) => {
        const back = new Set(g);
        back.delete(h.id);
        return back;
      });
      toast({ message: errorMessage(err) });
    }
    refresh();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    input.current?.blur(); // Puts the keyboard away so the results show.
  };

  return (
    <Shell>
      <div className="flex h-11 items-center">
        <BackButton />
      </div>

      <motion.section
        initial={{ opacity: 0, x: 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="pt-6 pb-10"
      >
        <h1 className="font-display text-[44px] sm:text-6xl">{list.title}</h1>
        {marked.data && (
          <p className="mt-3 text-muted">
            {all.length ? list.lede : `Nothing here. ${list.hint}.`}
          </p>
        )}

        {(all.length > SEARCH_FROM || query) && (
          <form role="search" onSubmit={submit} className="relative mt-6">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-faint" aria-hidden />
            {/* 16px text, or iOS zooms in on focus. */}
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${plural(all.length, 'movie')}`}
              aria-label="Search this list"
              enterKeyHint="search"
              autoComplete="off"
              className="h-12 w-full rounded-xl bg-surface pr-3.5 pl-11 text-base text-fg ring-1 ring-line placeholder:text-faint focus:ring-2 focus:ring-accent focus:outline-none"
            />
          </form>
        )}

        {marked.isLoading && (
          <div className="grid place-items-center py-16">
            <Spinner className="size-8" />
          </div>
        )}

        {marked.error && (
          <div className="mt-6 flex flex-col items-start gap-3">
            <Notice>{errorMessage(marked.error)}</Notice>
            <Button onClick={() => marked.refetch()}>Try again</Button>
          </div>
        )}

        {q && found.length === 0 && <p className="mt-6 text-muted">Nothing on this list matches “{query.trim()}”.</p>}

        {found.length > 0 && (
          // Keyed by the search, so typing swaps the results at once instead of fading out the ones that went.
          <ul key={q} className="relative mt-6 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
            <AnimatePresence mode="popLayout" initial={false}>
              {found.slice(0, limit).map((h) => (
                <motion.li
                  key={h.id}
                  layout
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
                  className="flex flex-col"
                >
                  <Img src={h.movie.posterUrl} className="aspect-[2/3] w-full rounded-xl object-cover ring-1 ring-line" />
                  <span className="mt-2 line-clamp-2 text-sm font-medium">{h.movie.title}</span>
                  {h.movie.year && <span className="text-xs text-muted">{h.movie.year}</span>}
                  {/* At the foot of the row, so the buttons line up whether a title takes one line or two. */}
                  <button
                    type="button"
                    onClick={(e) => unmark(h, e)}
                    aria-label={`${list.action} ${h.movie.title}`}
                    className="mt-auto -ml-2 inline-flex h-11 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-semibold text-muted transition hover:bg-white/5 hover:text-fg"
                  >
                    <list.ActionIcon className="size-4" aria-hidden />
                    {list.action}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        {found.length > limit && (
          <Button className="mt-8" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, found.length - limit)} more
          </Button>
        )}
      </motion.section>
    </Shell>
  );
}
