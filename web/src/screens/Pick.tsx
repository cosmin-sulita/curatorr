import {
  JUST_ARRIVED,
  genreById,
  shelfById,
  wantedReasons,
  type MediaServer,
  type Pick,
  type Profile,
  type WizardOptionsResponse,
} from '@curatorr/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Ban,
  BookmarkCheck,
  BookmarkMinus,
  BookmarkPlus,
  ChevronLeft,
  Clapperboard,
  Eye,
  Heart,
  Inbox,
  Play,
  RotateCcw,
  SkipForward,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotionConfig, type PanInfo } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { PosterShuffle } from '../components/PosterShuffle';
import { RatingBadges } from '../components/Ratings';
import { ForWhom, type ForWhomKind } from '../components/ForWhom';
import { PosterMenu, type MenuAction } from '../components/PosterMenu';
import { BottomBar, CenteredState, Shell } from '../components/Shell';
import { useToast } from '../components/Toast';
import {
  Button,
  buttonClass,
  CROSS_ORIGIN,
  Img,
  isCached,
  Notice,
  retryWithoutCors,
  Spinner,
  warmImages,
} from '../components/ui';
import {
  errorMessage,
  removeFromWatchlist,
  sendFeedback,
  undoAll,
  useRecommendations,
  useStatus,
  type ServerSyncResult,
} from '../lib/api';
import { fallBackIfStillHere, listNames, plural, runtime, serverName, vibrate, watchLink, type WatchLink } from '../lib/format';
import { useLongPress } from '../lib/longPress';
import { justArrived, navigate, withQuery } from '../lib/router';
import { clearSurprise, surprisePending } from '../lib/surprise';
import { criteriaFrom, useAdvance } from '../lib/wizard';

type Decline = 'skipped' | 'later' | 'seen' | 'never';

/** The profile asked for this movie in Seerr. */
const requested = (p: Pick) => p.reasons.some((r) => r.kind === 'requested');

/** How the screen names the picks of a shortcut from the first question. */
function shelfCopy(shelf: string | null | undefined): { pick: string; more: string } | null {
  const def = shelf ? shelfById.get(shelf) : undefined;
  if (!def) return null;
  if (def.id === JUST_ARRIVED.id) return { pick: 'Just arrived', more: 'More new arrivals' };
  return { pick: `${def.label} pick`, more: `More for ${def.label}` };
}

/** Toast after a mark, depending on what happened on the media server. Watching together, it names `who`. */
function markMessage(
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
    if (result === 'synced' || result === 'already') {
      return server === 'jellyfin' ? `${title} is in your Jellyfin favourites` : `${title} is on your Plex Watchlist`;
    }
    if (result === 'failed') return `Added ${title} to your watchlist, but couldn't reach ${name}`;
    return `Added ${title} to your watchlist`;
  }
  if (result === 'synced') {
    return server === 'jellyfin' ? `Marked ${title} as played in Jellyfin` : `Marked ${title} as watched in Plex`;
  }
  if (result === 'failed') return `Marked ${title} as seen, but couldn't update ${name}`;
  return `Marked ${title} as seen`;
}

/** The pick once it's on these people's watchlists only: its chip names who's left, or goes. */
function withWatchlist(pick: Pick, profileIds: number[], people: Profile[]): Pick {
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
  const serverList = server === 'jellyfin' ? 'Jellyfin favourites' : 'Plex Watchlist';
  if (!off.length) {
    if (unreachable) return `${unreachable}${title} is still on your watchlist`;
    return `${title} is still ${server === 'jellyfin' ? 'in' : 'on'} your ${serverList}`;
  }
  return `Removed ${title} from your ${result === 'synced' ? serverList : 'watchlist'}`;
}

// Once someone has swiped a pick away, the hint under the poster has done its job.
const SWIPED_KEY = 'curatorr:swiped';

function hasSwiped() {
  try {
    return localStorage.getItem(SWIPED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSwipe() {
  try {
    localStorage.setItem(SWIPED_KEY, '1');
  } catch {
    // Storage blocked: the hint keeps showing, which is harmless.
  }
}

export function PickScreen({ search }: { search: URLSearchParams }) {
  const criteria = criteriaFrom(search);
  // "Something like…": picks resemble this movie instead of matching answers.
  const like = search.get('like');
  const shelf = shelfCopy(criteria.shelf);
  const { data, isLoading, isFetching, error, refetch } = useRecommendations(criteria, like);
  const { data: status } = useStatus();
  const name = serverName(status?.server);
  const toast = useToast();
  const qc = useQueryClient();
  // Watching together: Seen it, Watchlist and Never first ask who they're for, and so does taking a movie off.
  const people = status?.profile ? [status.profile, ...status.together] : [];
  const together = people.length > 1;
  const [asking, setAsking] = useState<{ kind: ForWhomKind; pick: Pick } | null>(null);
  // A poster from "Other good picks" held down, and where it is on screen.
  const [menu, setMenu] = useState<{ pick: Pick; anchor: DOMRect } | null>(null);
  const chosen = useRef<MenuAction | null>(null);
  const hold = useLongPress();
  const { go } = useAdvance();

  // Picks loaded before the screen opened show on its first frame.
  const [queue, setQueue] = useState<Pick[] | null>(() => data?.picks ?? null);
  const shown = useRef(new Set<number>());
  const [swiped, setSwiped] = useState(hasSwiped);
  useEffect(() => setQueue(data?.picks ?? null), [data]);
  // The list stays put while you're here; coming back re-ranks with your marks and skips
  // (picks you've only seen don't move until the next evening).
  useEffect(() => () => qc.removeQueries({ queryKey: ['recommendations'] }), [qc]);

  const current = queue?.[0];
  const rest = queue?.slice(1) ?? [];

  // Log what was shown (gently demotes it for a few days) and warm up the next few images.
  useEffect(() => {
    if (current && !shown.current.has(current.movie.id)) {
      shown.current.add(current.movie.id);
      sendFeedback(current.movie.id, 'shown').catch(() => {});
    }
    warmImages(rest.slice(0, 3).flatMap((p) => [p.movie.posterUrl, p.movie.fanartUrl]), 'low');
  }, [current?.movie.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each new pick starts at the top. Passing on one or choosing from "Other good picks" often
  // happens scrolled down, which would leave the next poster and title out of view.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
  }, [current?.movie.id]);

  // Undo puts a pick back in front, which slides a card into the start of the rail. Scroll
  // snapping keeps the previous first card in place and hides the new one, so start over.
  const rail = useRef<HTMLUListElement>(null);
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!restored.current) return;
    restored.current = false;
    rail.current?.scrollTo({ left: 0 });
  }, [current?.movie.id]);

  // "Surprise me" deals a few of the other candidates' posters before the pick lands.
  const reduceMotion = useReducedMotionConfig();
  const [shuffle, setShuffle] = useState<'pending' | 'done' | null>(() =>
    surprisePending() && !reduceMotion ? 'pending' : null,
  );
  useEffect(() => clearSurprise(), []);
  const shufflePosters = rest.flatMap((p) => (p.movie.posterUrl ? [p.movie.posterUrl] : []));
  // The genre question's "N movies to choose from", still cached from a moment ago (picks are capped at 12).
  const libraryTotal = qc.getQueryData<WizardOptionsResponse>(['wizard', 'genre', {}])?.total;
  const shuffling = shuffle === 'pending' && shufflePosters.length >= 3;
  // Too few posters to make a show of it (or nothing to pick): just land.
  useEffect(() => {
    if (shuffle === 'pending' && queue && !shuffling) setShuffle(null);
  }, [queue, shuffle, shuffling]);

  // The actions ignore the second tap of a double tap that opened this screen (the bar sits where answers were).
  // `target`: a pick from "Other good picks", marked from its poster's menu; otherwise the pick on screen.
  const decline = (kind: Decline, profileIds?: number[], target?: Pick) => {
    const pick = target ?? current;
    if (!pick || justArrived()) return;
    if (together && kind !== 'skipped' && !profileIds) {
      setAsking({ kind, pick });
      return;
    }
    const who = profileIds?.flatMap((id) => people.find((p) => p.id === id)?.name ?? []);
    vibrate();
    // Undo puts it back where it was.
    const at = Math.max(0, queue?.findIndex((p) => p.movie.id === pick.movie.id) ?? 0);
    setQueue((q) => q?.filter((p) => p.movie.id !== pick.movie.id) ?? null);
    const putBack = () => {
      if (at === 0) restored.current = true;
      setQueue((q) => (q ? [...q.slice(0, at), pick, ...q.slice(at)] : [pick]));
    };
    // A skip only demotes the movie; the other marks change what the questions can offer
    // (and Seen it adds to "Something like…"'s recently watched), and so does undoing them.
    const refreshQuestions = () => {
      if (kind === 'skipped') return;
      qc.invalidateQueries({ queryKey: ['wizard'] });
      qc.invalidateQueries({ queryKey: ['like'] });
    };
    sendFeedback(pick.movie.id, kind, { profileIds })
      .then(({ ids, server }) => {
        refreshQuestions();
        toast({
          message: markMessage(kind, pick.movie.title, server, status?.server ?? null, who),
          duration: kind === 'skipped' ? 3000 : undefined,
          action: {
            label: 'Undo',
            run: () => {
              putBack();
              undoAll(ids)
                .then((res) => {
                  refreshQuestions();
                  if (res.server === 'failed') toast({ message: `Undone here, but ${name} couldn't be updated` });
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
    const pick = target ?? current;
    if (!pick || justArrived()) return;
    if (together && !profileIds) {
      setAsking({ kind: 'unwatchlist', pick });
      return;
    }
    const targets = profileIds ?? people.map((p) => p.id);
    const names = (ids: number[]) => people.filter((p) => ids.includes(p.id)).map((p) => p.name);
    const show = (p: Pick) => setQueue((q) => q && q.map((x) => (x.movie.id === p.movie.id ? p : x)));
    vibrate();
    show(withWatchlist(pick, pick.onWatchlistOf.filter((id) => !targets.includes(id)), people));
    removeFromWatchlist(pick.movie.id, profileIds)
      .then(({ server, onWatchlistOf }) => {
        const after = withWatchlist(pick, onWatchlistOf, people);
        show(after);
        const off = targets.filter((id) => !onWatchlistOf.includes(id));
        const kept = targets.filter((id) => onWatchlistOf.includes(id));
        toast({
          message: unwatchlistMessage(pick.movie.title, server, status?.server ?? null, {
            off: names(off),
            kept: names(kept),
            together,
          }),
          // Nothing to undo when it stayed on.
          action: off.length
            ? {
                label: 'Undo',
                run: () => {
                  show(pick);
                  sendFeedback(pick.movie.id, 'later', together ? { profileIds: off } : {})
                    .then((res) => {
                      if (res.server === 'failed') toast({ message: `Undone here, but ${name} couldn't be updated` });
                    })
                    .catch((err) => {
                      show(after);
                      toast({ message: errorMessage(err) });
                    });
                },
              }
            : undefined,
        });
      })
      .catch((err) => {
        // Nothing changed, so the pick is as it was.
        show(pick);
        toast({ message: errorMessage(err) });
      });
  };

  const bringForward = (pick: Pick) =>
    setQueue((q) => (q && q[0] ? [pick, ...q.slice(1).filter((p) => p !== pick), q[0]] : q));

  // The tap on the link itself does the navigation; this only records it (and handles demo mode).
  const onWatch = (e: MouseEvent<HTMLAnchorElement>, link: WatchLink) => {
    if (justArrived()) {
      e.preventDefault();
      return;
    }
    if (!current) return;
    if (status?.demo) {
      e.preventDefault();
      toast({ message: 'Demo mode: connect Plex or Jellyfin in setup to play movies.' });
      return;
    }
    sendFeedback(current.movie.id, 'accepted', { keepalive: true }).catch(() => {});
    if (link.fallback) fallBackIfStillHere(link.fallback);
  };

  if (isLoading || (data && !queue)) {
    return (
      <Shell>
        <div className="grid place-items-center py-40">
          <Spinner className="size-8" />
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <CenteredState title="Couldn't find a pick">
          <Notice>{errorMessage(error)}</Notice>
          <Button onClick={() => refetch()}>Try again</Button>
        </CenteredState>
      </Shell>
    );
  }

  if (!current) {
    const hadPicks = Boolean(data?.picks.length);
    // Skips only demote a movie, so a fresh list brings them back, or the next best ones.
    const lookAgain = () => refetch().then((r) => setQueue(r.data?.picks ?? []));
    const likeTitle = data?.like?.title;
    let title = hadPicks ? "That's every match" : 'Nothing fits those answers';
    let hint = hadPicks ? 'You passed on all of them. Change an answer or look again.' : 'Try a different combination of answers.';
    if (like) {
      if (!hadPicks) title = 'Nothing like that left to watch';
      hint = hadPicks
        ? 'You passed on all of them. Pick another movie or look again.'
        : `You've seen everything like ${likeTitle ?? 'it'}. Try another movie.`;
    } else if (shelf) {
      if (!hadPicks) title = 'Nothing to pick right now';
      hint = hadPicks ? 'You passed on all of them. Look again, or answer the questions instead.' : 'Answer the questions instead.';
    }
    return (
      <Shell>
        <CenteredState title={title}>
          <p className="text-muted">{hint}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => window.history.back()}>
              <ChevronLeft className="size-4" /> {like ? 'Pick another movie' : shelf ? 'Back' : 'Change answers'}
            </Button>
            {hadPicks && (
              <Button onClick={lookAgain} loading={isFetching}>
                Look again
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate('/', { back: true })}>
              <RotateCcw className="size-4" /> Start over
            </Button>
          </div>
        </CenteredState>
      </Shell>
    );
  }

  const m = current.movie;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -110 || info.velocity.x < -650) {
      decline('skipped');
      if (!swiped) {
        rememberSwipe();
        setSwiped(true);
      }
    }
  };
  const link = status?.demo ? { href: '#', newTab: false, fallback: null } : watchLink(m.watchAppUrl, m.watchUrl);
  // Genre and rating are already shown above; chips explain the theme/mood/time match.
  const reasons = current.reasons.filter((r) => r.kind !== 'genre' && r.kind !== 'rating');

  // Once the pick is on everyone's watchlist, the Watchlist button says so, and takes it off. Watching together,
  // taking it off offers those who have it, and adding those who don't.
  const listedFor = (p: Pick) => people.length > 0 && people.every((x) => p.onWatchlistOf.includes(x.id));
  const listed = listedFor(current);
  const sheetPeople =
    asking?.kind === 'later'
      ? people.filter((p) => !asking.pick.onWatchlistOf.includes(p.id))
      : asking?.kind === 'unwatchlist'
        ? people.filter((p) => asking.pick.onWatchlistOf.includes(p.id))
        : people;
  const openMenu = (pick: Pick, el: HTMLElement) =>
    setMenu({ pick, anchor: (el.querySelector('img') ?? el).getBoundingClientRect() });
  // What holding a poster from "Other good picks" offers: the pick's own marks, and its likeness.
  const menuFor = (p: Pick): MenuAction[] => [
    listedFor(p)
      ? { key: 'later', label: 'Take off watchlist', Icon: BookmarkMinus, run: () => unwatchlist(undefined, p) }
      : { key: 'later', label: 'Watchlist', Icon: BookmarkPlus, run: () => decline('later', undefined, p) },
    { key: 'seen', label: 'Seen it', Icon: Eye, run: () => decline('seen', undefined, p) },
    {
      key: 'like',
      label: 'Something like this',
      Icon: Heart,
      run: () => go(`like:${p.movie.id}`, withQuery('/pick', { like: String(p.movie.id) })),
    },
    { key: 'never', label: 'Never', Icon: Ban, run: () => decline('never', undefined, p), danger: true },
  ];
  // The Watchlist button keeps its key when it flips, so it keeps keyboard focus.
  const actions: { key: string; label: string; Icon: LucideIcon; run: () => void; on?: boolean }[] = [
    { key: 'skipped', label: 'Not tonight', Icon: SkipForward, run: () => decline('skipped') },
    listed
      ? { key: 'later', label: 'On watchlist', Icon: BookmarkCheck, run: () => unwatchlist(), on: true }
      : { key: 'later', label: 'Watchlist', Icon: BookmarkPlus, run: () => decline('later') },
    { key: 'seen', label: 'Seen it', Icon: Eye, run: () => decline('seen') },
    { key: 'never', label: 'Never', Icon: Ban, run: () => decline('never') },
  ];

  const watchClass = 'w-full md:w-auto md:min-w-52';
  const watchButton = link ? (
    <a
      href={link.href}
      target={link.newTab ? '_blank' : undefined}
      rel="noopener noreferrer"
      onClick={(e) => onWatch(e, link)}
      className={buttonClass('primary', 'lg', watchClass)}
    >
      <Play className="size-5 fill-current" /> Watch on {name}
    </a>
  ) : (
    <Button variant="primary" size="lg" disabled className={watchClass}>
      <Play className="size-5 fill-current" /> Not in {name} yet
    </Button>
  );

  return (
    <>
      {/* No backdrop while shuffling: the pick's fanart would give it away. */}
      <Backdrop src={shuffling ? null : (m.fanartUrl ?? m.posterUrl)} />
      <Shell wide>
        {/* Desktop leaves room for the backdrop above, but little enough to keep the actions on a laptop screen. */}
        <div className="grid gap-5 pt-[2vh] md:grid-cols-[minmax(0,320px)_1fr] md:items-end md:gap-12 md:pt-[16vh]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={m.id}
              drag={shuffling ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.7, right: 0.15 }}
              onDragEnd={onDragEnd}
              initial={{ y: 60, opacity: 0, rotate: -3, scale: 0.94 }}
              animate={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
              exit={{ x: -420, opacity: 0, rotate: -12, transition: { duration: 0.28 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              // Short phones (an iPhone SE) get a smaller poster, so the ratings still clear the action bar.
              className="mx-auto w-36 cursor-grab touch-pan-y active:cursor-grabbing max-md:[@media(max-height:700px)]:w-28 sm:w-56 md:mx-0 md:w-full"
            >
              {shuffling ? (
                <PosterShuffle posters={shufflePosters} final={m.posterUrl} onDone={() => setShuffle('done')} />
              ) : (
                <Img
                  src={m.posterUrl}
                  alt={`${m.title} poster`}
                  draggable={false}
                  className="aspect-[2/3] w-full rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10"
                />
              )}
              {!swiped && !shuffling && (
                <p className="-mx-6 mt-3 text-center text-xs text-muted md:hidden">Swipe left for the next pick</p>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="min-w-0">
            <motion.div
              key={shuffling ? 'details-shuffle' : `details-${m.id}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.35 }}
            >
              {shuffling ? (
                <p className="text-sm font-semibold text-indigo-300" role="status">
                  Shuffling {libraryTotal ? plural(libraryTotal, 'movie') : 'your movies'}…
                </p>
              ) : (
                <>
                  <p className={clsx('text-sm font-semibold', current.closeMatch ? 'text-amber-300' : 'text-indigo-200')}>
                    {data?.like
                      ? `${current.closeMatch ? 'A bit like' : 'Something like'} ${data.like.title}`
                      : current.closeMatch
                        ? 'Close match'
                        : (shelf?.pick ?? "Tonight's pick")}
                  </p>
                  {/* Long titles step down on phones so the ratings still clear the action bar. */}
                  <h1
                    className={clsx(
                      'mt-2 font-display text-balance sm:text-6xl lg:text-7xl',
                      m.title.length > 28 ? 'text-[40px]' : 'text-5xl',
                    )}
                  >
                    {m.title}
                  </h1>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-muted">
                    {m.year && <span>{m.year}</span>}
                    {runtime(m.runtime) && <span>{runtime(m.runtime)}</span>}
                    {m.certification && (
                      <span className="rounded-md px-1.5 py-0.5 text-xs font-semibold ring-1 ring-white/25">{m.certification}</span>
                    )}
                    {/* Named as on the genre tiles: Sci-Fi, not TMDB's Science Fiction. */}
                    <span className="text-faint">
                      {m.genres
                        .slice(0, 3)
                        .map((g) => genreById.get(g)?.label ?? g)
                        .join(', ')}
                    </span>
                  </div>
                  {m.saga && (
                    <p className="mt-2 text-[15px] text-muted">
                      Part {m.saga.part} of {m.saga.parts} in <span className="text-fg">{m.saga.title}</span>
                    </p>
                  )}

                  <div className="mt-5">
                    <RatingBadges ratings={m.ratings} />
                  </div>

                  {reasons.length > 0 && (
                    <ul className="mt-5 flex flex-wrap gap-2" aria-label="Why this pick">
                      {reasons.map((r) =>
                        r.kind === 'requested' ? (
                          <li
                            key={r.kind}
                            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1 text-[13px] font-medium text-indigo-200 ring-1 ring-indigo-400/40"
                          >
                            <Inbox className="size-3.5" aria-hidden />
                            {r.label}
                          </li>
                        ) : (
                          <li key={r.kind + r.label} className="rounded-full bg-white/8 px-3 py-1 text-[13px] text-fg ring-1 ring-line">
                            {r.label}
                          </li>
                        ),
                      )}
                    </ul>
                  )}

                  <p className="selectable mt-5 max-w-[62ch] text-[15px] leading-relaxed text-fg/85">{m.overview}</p>
                </>
              )}
            </motion.div>

            {!shuffling && (
              <>
                {/* Desktop: actions inline with the details, laid out like the phone bar. They sit outside the block
                    above, which is rebuilt for each pick, so a button keeps keyboard focus from one pick to the next. */}
                <div className="mt-7 hidden md:block">
                  {watchButton}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.map(({ key, label, Icon, run, on }) => (
                      <Button key={key} variant={on ? 'selected' : key === 'never' ? 'ghost' : 'secondary'} onClick={run}>
                        <Icon className="size-4" /> {label}
                      </Button>
                    ))}
                  </div>
                </div>

                {m.trailerId && (
                  <a
                    href={`https://www.youtube.com/watch?v=${m.trailerId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="press-dim mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted transition hover:text-fg"
                  >
                    <Clapperboard className="size-4" /> Watch the trailer
                  </a>
                )}
              </>
            )}
          </div>
        </div>

        {/* The other picks fade in just after the details when they first appear, not again on each pass. */}
        {!shuffling && rest.length > 0 && (
          <motion.section
            className="mt-14 mb-6"
            aria-labelledby="more-picks"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.35 }}
          >
            <h2 id="more-picks" className="font-display text-3xl">
              {data?.like ? `More like ${data.like.title}` : (shelf?.more ?? 'Other good picks')}
            </h2>
            {/* Scroll padding lines the first poster up with the heading; pt-1.5 leaves room for the focus ring. */}
            <ul
              ref={rail}
              className="no-scrollbar -mx-4 mt-2.5 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pt-1.5 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6"
            >
              {/* relative: the screen-reader text is absolutely positioned, and the rail only clips it inside its card. */}
              {rest.map((p) => (
                <li key={p.movie.id} className="relative w-28 shrink-0 snap-start sm:w-36">
                  <button
                    // Held down, it opens a menu of its own (PosterMenu).
                    {...hold((el) => openMenu(p, el))}
                    onClick={() => bringForward(p)}
                    className="group press w-full text-left transition"
                  >
                    <span className="relative block">
                      <Img
                        src={p.movie.posterUrl}
                        alt=""
                        className="aspect-[2/3] w-full rounded-xl object-cover ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent-2"
                      />
                      {requested(p) && (
                        <span
                          className="absolute top-1.5 left-1.5 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-md shadow-black/40"
                          aria-hidden
                        >
                          Requested
                        </span>
                      )}
                    </span>
                    <span className="mt-2 line-clamp-2 text-sm font-medium">
                      {p.movie.title}
                      {requested(p) && <span className="sr-only">, {p.reasons.find((r) => r.kind === 'requested')!.label}</span>}
                    </span>
                    <span className="flex gap-2 text-xs text-muted">
                      {p.movie.ratings.rt != null ? (
                        <span className="font-semibold text-fg/80">
                          <span className="sr-only">Rotten Tomatoes </span>
                          {Math.round(p.movie.ratings.rt)}%
                        </span>
                      ) : (
                        p.movie.ratings.imdb != null && <span>IMDb {p.movie.ratings.imdb.toFixed(1)}</span>
                      )}
                      {p.movie.year && <span>{p.movie.year}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.section>
        )}
        <div className="h-40 md:hidden" aria-hidden />
      </Shell>

      {/* Phones: actions stay under the thumb while reading. They fade in once a shuffle lands;
          opacity only, since a transform would break the bar's fixed positioning. */}
      {!shuffling && (
        <motion.div
          className="relative z-30"
          initial={shuffle === 'done' ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <BottomBar>
            {watchButton}
            <div className="mt-2 grid grid-cols-4 gap-2">
              {actions.map(({ key, label, Icon, run, on }) => (
                <button
                  key={key}
                  onClick={run}
                  className={clsx(
                    'press flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[13px] font-medium ring-1 transition',
                    on ? 'bg-indigo-500/15 text-indigo-100 ring-indigo-400/40' : 'bg-raised/80 text-fg ring-line',
                  )}
                >
                  <Icon className={clsx('size-5', on ? 'text-indigo-300' : 'text-muted')} aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </BottomBar>
        </motion.div>
      )}

      {/* Outside Shell: its <main> is a stacking context below the header. */}
      <AnimatePresence>
        {asking && (
          <ForWhom
            key={asking.kind}
            kind={asking.kind}
            people={sheetPeople}
            onCancel={() => setAsking(null)}
            onDone={(profileIds) => {
              setAsking(null);
              if (asking.kind === 'unwatchlist') unwatchlist(profileIds, asking.pick);
              else decline(asking.kind, profileIds, asking.pick);
            }}
          />
        )}
      </AnimatePresence>
      {/* The chosen action runs once the menu has gone. */}
      <AnimatePresence
        onExitComplete={() => {
          const action = chosen.current;
          chosen.current = null;
          if (action) requestAnimationFrame(action.run);
        }}
      >
        {menu && (
          <PosterMenu
            anchor={menu.anchor}
            src={menu.pick.movie.posterUrl}
            title={menu.pick.movie.title}
            actions={menuFor(menu.pick)}
            onChoose={(action) => {
              chosen.current = action;
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** Full-bleed backdrop, crossfading between picks (Seerr's detail-page treatment). */
function Backdrop({ src }: { src: string | null }) {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <AnimatePresence initial={false}>{src && <BackdropImage key={src} src={src} />}</AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/85 to-ink md:from-ink/30 md:via-ink/75" />
      <div className="absolute inset-0 hidden bg-gradient-to-r from-ink via-ink/75 to-transparent md:block" />
      {/* Keeps the header readable when the fanart is bright. */}
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-ink/80 to-transparent md:h-40 md:from-ink/90" />
    </div>
  );
}

/** Fades in once it has loaded (at once when it already has), so a slow backdrop eases in instead of popping in. */
function BackdropImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(() => isCached(src));
  return (
    <motion.img
      src={src}
      alt=""
      crossOrigin={CROSS_ORIGIN}
      onError={(e) => retryWithoutCors(e.currentTarget)}
      initial={{ opacity: 0 }}
      animate={{ opacity: loaded ? 1 : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      onLoad={() => setLoaded(true)}
      className="absolute inset-0 h-[75vh] w-full object-cover [mask-image:linear-gradient(to_bottom,black_55%,transparent)] md:h-full md:[mask-image:none]"
    />
  );
}
