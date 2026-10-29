import { JUST_ARRIVED, shelfById, type Pick } from '@curatorr/shared';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import { Ban, BookmarkCheck, BookmarkMinus, BookmarkPlus, Clapperboard, Eye, Heart, SkipForward } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotionConfig, type PanInfo } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ForWhom, type ForWhomKind } from '../components/ForWhom';
import { PosterMenu, type MenuAction } from '../components/PosterMenu';
import { PosterShuffle } from '../components/PosterShuffle';
import { CenteredState, Shell } from '../components/Shell';
import { Button, Img, Notice, Spinner, warmImages } from '../components/ui';
import {
  errorMessage,
  keys,
  recommendationsQuery,
  sendFeedback,
  useRecommendations,
  useStatus,
  wizardQuery,
} from '../lib/api';
import { serverName, watchLink } from '../lib/format';
import { useLongPress } from '../lib/longPress';
import { withQuery } from '../lib/router';
import { clearSurprise, surprisePending } from '../lib/surprise';
import { criteriaFrom, useAdvance } from '../lib/wizard';
import { Backdrop } from './pick/Backdrop';
import { NoPicks } from './pick/NoPicks';
import { OtherPicks } from './pick/OtherPicks';
import { DesktopActions, PhoneActions, WatchButton, type PickAction } from './pick/PickActions';
import { PickDetails } from './pick/PickDetails';
import { usePickActions } from './pick/usePickActions';
import { usePickQueue } from './pick/usePickQueue';

/** How the screen names the picks of a shortcut from the first question. */
function shelfCopy(shelf: string | null | undefined): { pick: string; more: string } | null {
  const def = shelf ? shelfById.get(shelf) : undefined;
  if (!def) return null;
  if (def.id === JUST_ARRIVED.id) return { pick: 'Just arrived', more: 'More new arrivals' };
  return { pick: `${def.label} pick`, more: `More for ${def.label}` };
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
  const qc = useQueryClient();
  const queue = usePickQueue(data?.picks);
  const { current, rest } = queue;
  // Watching together: Seen it, Watchlist and Never first ask who they're for, and so does taking a movie off.
  const [asking, setAsking] = useState<{ kind: ForWhomKind; pick: Pick } | null>(null);
  const { people, decline, unwatchlist, watch } = usePickActions({
    queue,
    status,
    ask: (kind, pick) => setAsking({ kind, pick }),
  });
  // A poster from "Other good picks" held down, and where it is on screen.
  const [menu, setMenu] = useState<{ pick: Pick; anchor: DOMRect } | null>(null);
  const chosen = useRef<MenuAction | null>(null);
  const hold = useLongPress();
  const { go } = useAdvance();
  const shown = useRef(new Set<number>());
  const [swiped, setSwiped] = useState(hasSwiped);

  // The list stays put while you're here; coming back re-ranks with your marks and skips
  // (picks you've only seen don't move until the next evening). The picks of the screen opening next stay: "Something
  // like this" from a poster loads them before this screen closes, and this runs before that screen subscribes.
  useEffect(
    () => () => {
      const next = new URL(window.location.href);
      const keep =
        next.pathname === '/pick'
          ? hashKey(recommendationsQuery(criteriaFrom(next.searchParams), next.searchParams.get('like')).queryKey)
          : null;
      qc.removeQueries({ queryKey: keys.recommendations, predicate: (q) => q.queryHash !== keep });
    },
    [qc],
  );

  // Log what was shown (gently demotes it for a few days) and warm up the next few images. Only a new pick does it:
  // the rest of the list changing (a mark from a poster's menu) doesn't.
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
  useLayoutEffect(() => {
    if (!queue.restored.current) return;
    queue.restored.current = false;
    rail.current?.scrollTo({ left: 0 });
  }, [current?.movie.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Surprise me" deals a few of the other candidates' posters before the pick lands.
  const reduceMotion = useReducedMotionConfig();
  const [shuffle, setShuffle] = useState<'pending' | 'done' | null>(() =>
    surprisePending() && !reduceMotion ? 'pending' : null,
  );
  useEffect(() => clearSurprise(), []);
  const shufflePosters = rest.flatMap((p) => (p.movie.posterUrl ? [p.movie.posterUrl] : []));
  // The genre question's "N movies to choose from", still cached from a moment ago (picks are capped at 12).
  const libraryTotal = qc.getQueryData(wizardQuery('genre', {}).queryKey)?.total;
  const shuffling = shuffle === 'pending' && shufflePosters.length >= 3;
  // Too few posters to make a show of it (or nothing to pick): just land.
  useEffect(() => {
    if (shuffle === 'pending' && queue.queue && !shuffling) setShuffle(null);
  }, [queue.queue, shuffle, shuffling]);

  if (isLoading || (data && !queue.queue)) {
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
    return (
      <NoPicks
        hadPicks={Boolean(data?.picks.length)}
        like={Boolean(like)}
        likeTitle={data?.like?.title}
        shortcut={Boolean(shelf)}
        // Skips only demote a movie, so a fresh list brings them back, or the next best ones.
        lookAgain={() => refetch().then((r) => queue.reset(r.data?.picks ?? []))}
        looking={isFetching}
      />
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

  // Once the pick is on everyone's watchlist, the Watchlist button says so, and takes it off. Watching together,
  // taking it off offers those who have it, and adding those who don't.
  const listedFor = (p: Pick) => people.length > 0 && people.every((x) => p.onWatchlistOf.includes(x.id));
  const sheetPeople =
    asking?.kind === 'later'
      ? people.filter((p) => !asking.pick.onWatchlistOf.includes(p.id))
      : asking?.kind === 'unwatchlist'
        ? people.filter((p) => asking.pick.onWatchlistOf.includes(p.id))
        : people;
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
  const actions: PickAction[] = [
    { key: 'skipped', label: 'Not tonight', Icon: SkipForward, run: () => decline('skipped') },
    listedFor(current)
      ? { key: 'later', label: 'On watchlist', Icon: BookmarkCheck, run: () => unwatchlist(), on: true }
      : { key: 'later', label: 'Watchlist', Icon: BookmarkPlus, run: () => decline('later') },
    { key: 'seen', label: 'Seen it', Icon: Eye, run: () => decline('seen') },
    { key: 'never', label: 'Never', Icon: Ban, run: () => decline('never') },
  ];
  const watchButton = <WatchButton link={link} server={name} onWatch={watch} />;
  const heading = data?.like
    ? `${current.closeMatch ? 'A bit like' : 'Something like'} ${data.like.title}`
    : current.closeMatch
      ? 'Close match'
      : (shelf?.pick ?? "Tonight's pick");

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
            <PickDetails pick={current} heading={heading} shuffling={shuffling} libraryTotal={libraryTotal} />
            {!shuffling && (
              <>
                <DesktopActions watch={watchButton} actions={actions} />
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

        {!shuffling && rest.length > 0 && (
          <OtherPicks
            title={data?.like ? `More like ${data.like.title}` : (shelf?.more ?? 'Other good picks')}
            picks={rest}
            railRef={rail}
            hold={hold}
            onChoose={queue.bringForward}
            onMenu={(pick, el) => setMenu({ pick, anchor: (el.querySelector('img') ?? el).getBoundingClientRect() })}
          />
        )}
        <div className="h-40 md:hidden" aria-hidden />
      </Shell>

      {!shuffling && <PhoneActions watch={watchButton} actions={actions} fadeIn={shuffle === 'done'} />}

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
