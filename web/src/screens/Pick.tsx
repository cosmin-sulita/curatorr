import type { Pick } from '@curatorr/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, BookmarkPlus, Clapperboard, Eye, Play, RotateCcw, SkipForward } from 'lucide-react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { RatingBadges } from '../components/Ratings';
import { BottomBar, CenteredState, Shell } from '../components/Shell';
import { useToast } from '../components/Toast';
import { Button, buttonClass, Img, Notice, Spinner } from '../components/ui';
import {
  errorMessage,
  sendFeedback,
  undoFeedback,
  useRecommendations,
  useStatus,
  type PlexSyncResult,
} from '../lib/api';
import { fallBackIfStillHere, plexLink, runtime, vibrate, type PlexLink } from '../lib/format';
import { navigate, withQuery } from '../lib/router';
import { criteriaFrom } from './Wizard';

type Decline = 'skipped' | 'later' | 'seen' | 'never';

/** Toast after a mark, depending on what happened in Plex. */
function markMessage(kind: Decline, title: string, plex: PlexSyncResult | undefined) {
  if (kind === 'skipped') return `Skipped ${title}`;
  if (kind === 'never') return `${title} won't be suggested again`;
  if (kind === 'later') {
    if (plex === 'synced' || plex === 'already') return `${title} is on your Plex Watchlist`;
    if (plex === 'failed') return `Added ${title} to your watchlist, but couldn't reach Plex`;
    return `Added ${title} to your watchlist`;
  }
  if (plex === 'synced') return `Marked ${title} as watched in Plex`;
  if (plex === 'failed') return `Marked ${title} as seen, but couldn't update Plex`;
  return `Marked ${title} as seen`;
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
  const { data, isLoading, error, refetch } = useRecommendations(criteria);
  const { data: status } = useStatus();
  const toast = useToast();
  const qc = useQueryClient();

  const [queue, setQueue] = useState<Pick[] | null>(null);
  const shown = useRef(new Set<number>());
  const [swiped, setSwiped] = useState(hasSwiped);
  useEffect(() => setQueue(data?.picks ?? null), [data]);
  // The list stays put while you're here; coming back later re-ranks with today's feedback.
  useEffect(() => () => qc.removeQueries({ queryKey: ['recommendations'] }), [qc]);

  const current = queue?.[0];
  const rest = queue?.slice(1) ?? [];

  // Log what was shown (gently demotes it for a few days) and warm up the next few images.
  useEffect(() => {
    if (current && !shown.current.has(current.movie.id)) {
      shown.current.add(current.movie.id);
      sendFeedback(current.movie.id, 'shown').catch(() => {});
    }
    for (const p of rest.slice(0, 3)) {
      for (const url of [p.movie.posterUrl, p.movie.fanartUrl]) if (url) new Image().src = url;
    }
  }, [current?.movie.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const decline = (kind: Decline) => {
    if (!current) return;
    const pick = current;
    vibrate();
    setQueue((q) => q?.slice(1) ?? null);
    sendFeedback(pick.movie.id, kind)
      .then(({ id, plex }) => {
        // A skip only demotes the movie; the other marks change what the questions can offer.
        if (kind !== 'skipped') qc.invalidateQueries({ queryKey: ['wizard'] });
        toast({
          message: markMessage(kind, pick.movie.title, plex),
          duration: kind === 'skipped' ? 3000 : undefined,
          action: {
            label: 'Undo',
            run: () => {
              setQueue((q) => [pick, ...(q ?? [])]);
              undoFeedback(id)
                .then((res) => {
                  if (res.plex === 'failed') toast({ message: "Undone here, but Plex couldn't be updated" });
                })
                .catch((err) => toast({ message: errorMessage(err) }));
            },
          },
        });
      })
      .catch((err) => toast({ message: errorMessage(err) }));
  };

  const bringForward = (pick: Pick) =>
    setQueue((q) => (q && q[0] ? [pick, ...q.slice(1).filter((p) => p !== pick), q[0]] : q));

  // The tap on the link itself does the navigation; this only records it (and handles demo mode).
  const onWatch = (e: MouseEvent<HTMLAnchorElement>, link: PlexLink) => {
    if (!current) return;
    if (status?.demo) {
      e.preventDefault();
      toast({ message: 'Demo mode: connect Plex in setup to play movies.' });
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
    return (
      <Shell>
        <CenteredState title={hadPicks ? "That's every match" : 'Nothing fits those answers'}>
          <p className="text-muted">
            {hadPicks
              ? 'You passed on all of them. Loosen an answer or start again with a different genre.'
              : 'Try a different combination of answers.'}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {criteria.genre && criteria.genre !== 'any' && (
              <Button onClick={() => navigate(withQuery('/ask/theme', { genre: criteria.genre }))}>
                Keep the genre
              </Button>
            )}
            <Button variant="primary" onClick={() => navigate('/')}>
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
  const link = status?.demo ? { href: '#', newTab: false, fallback: null } : plexLink(m.plexAppUrl, m.plexUrl);
  // Genre and rating are already shown above; chips explain the theme/mood/time match.
  const reasons = current.reasons.filter((r) => r.kind !== 'genre' && r.kind !== 'rating');

  const declines = [
    { kind: 'skipped' as const, label: 'Not tonight', Icon: SkipForward },
    { kind: 'later' as const, label: 'Watchlist', Icon: BookmarkPlus },
    { kind: 'seen' as const, label: 'Seen it', Icon: Eye },
    { kind: 'never' as const, label: 'Never', Icon: Ban },
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
      <Play className="size-5 fill-current" /> Watch on Plex
    </a>
  ) : (
    <Button variant="primary" size="lg" disabled className={watchClass}>
      <Play className="size-5 fill-current" /> Not in Plex yet
    </Button>
  );

  return (
    <>
      <Backdrop src={m.fanartUrl ?? m.posterUrl} />
      <Shell wide>
        <div className="grid gap-5 pt-[2vh] md:grid-cols-[minmax(0,320px)_1fr] md:items-end md:gap-12 md:pt-[24vh]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={m.id}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.7, right: 0.15 }}
              onDragEnd={onDragEnd}
              initial={{ y: 60, opacity: 0, rotate: -3, scale: 0.94 }}
              animate={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
              exit={{ x: -420, opacity: 0, rotate: -12, transition: { duration: 0.28 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="mx-auto w-36 cursor-grab touch-pan-y active:cursor-grabbing sm:w-56 md:mx-0 md:w-full"
            >
              <Img
                src={m.posterUrl}
                alt={`${m.title} poster`}
                draggable={false}
                className="aspect-[2/3] w-full rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10"
              />
              {!swiped && <p className="mt-3 text-center text-xs text-faint md:hidden">Swipe left for the next pick</p>}
            </motion.div>
          </AnimatePresence>

          <motion.div
            key={`details-${m.id}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.35 }}
            className="min-w-0"
          >
            <p className={clsx('text-sm font-semibold', current.closeMatch ? 'text-amber-300' : 'text-indigo-300')}>
              {current.closeMatch ? 'Close match' : "Tonight's pick"}
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
              <span className="text-faint">{m.genres.slice(0, 3).join(', ')}</span>
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
                {reasons.map((r) => (
                  <li key={r.kind + r.label} className="rounded-full bg-white/8 px-3 py-1 text-[13px] text-fg ring-1 ring-line">
                    {r.label}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-5 max-w-[62ch] text-[15px] leading-relaxed text-fg/85">{m.overview}</p>

            {/* Desktop: actions inline with the details. */}
            <div className="mt-7 hidden flex-wrap gap-3 md:flex">
              {watchButton}
              {declines.map(({ kind, label, Icon }) => (
                <Button key={kind} size="lg" variant={kind === 'never' ? 'ghost' : 'secondary'} onClick={() => decline(kind)}>
                  <Icon className="size-4" /> {label}
                </Button>
              ))}
            </div>

            {m.trailerId && (
              <a
                href={`https://www.youtube.com/watch?v=${m.trailerId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-fg"
              >
                <Clapperboard className="size-4" /> Watch the trailer
              </a>
            )}
          </motion.div>
        </div>

        {rest.length > 0 && (
          <section className="mt-14 mb-6" aria-labelledby="more-picks">
            <h2 id="more-picks" className="font-display text-3xl">
              Other good picks
            </h2>
            <ul className="no-scrollbar -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
              {rest.map((p) => (
                <li key={p.movie.id} className="w-28 shrink-0 snap-start sm:w-36">
                  <button onClick={() => bringForward(p)} className="group w-full text-left">
                    <Img
                      src={p.movie.posterUrl}
                      alt=""
                      className="aspect-[2/3] w-full rounded-xl object-cover ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent-2"
                    />
                    <span className="mt-2 line-clamp-2 text-sm font-medium">{p.movie.title}</span>
                    <span className="flex gap-2 text-xs text-muted">
                      {p.movie.ratings.rt != null ? (
                        <span className="font-semibold text-fg/80">{Math.round(p.movie.ratings.rt)}%</span>
                      ) : (
                        p.movie.ratings.imdb != null && <span>IMDb {p.movie.ratings.imdb.toFixed(1)}</span>
                      )}
                      {p.movie.year && <span>{p.movie.year}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="h-40 md:hidden" aria-hidden />
      </Shell>

      {/* Phones: actions stay under the thumb while reading. */}
      <BottomBar>
        {watchButton}
        <div className="mt-2 grid grid-cols-4 gap-2">
          {declines.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              onClick={() => decline(kind)}
              className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl bg-raised/80 text-[13px] font-medium text-fg ring-1 ring-line active:scale-[0.97]"
            >
              <Icon className="size-5 text-muted" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </BottomBar>
    </>
  );
}

/** Full-bleed backdrop, crossfading between picks (Seerr's detail-page treatment). */
function Backdrop({ src }: { src: string | null }) {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 h-[75vh] w-full object-cover [mask-image:linear-gradient(to_bottom,black_55%,transparent)] md:h-full md:[mask-image:none]"
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/85 to-ink md:from-ink/20 md:via-ink/70" />
      <div className="absolute inset-0 hidden bg-gradient-to-r from-ink via-ink/60 to-transparent md:block" />
    </div>
  );
}
