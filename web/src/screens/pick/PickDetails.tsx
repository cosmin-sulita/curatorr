import { genreById, type Pick } from '@curatorr/shared';
import clsx from 'clsx';
import { Inbox } from 'lucide-react';
import { motion } from 'motion/react';
import { RatingBadges } from '../../components/Ratings';
import { plural, runtime } from '../../lib/format';

/** What the pick is: its kind of pick, title, year, length, rating, saga, why it was picked, and its plot. */
export function PickDetails({
  pick,
  heading,
  shuffling,
  libraryTotal,
}: {
  pick: Pick;
  /** "Tonight's pick", "Close match", "Something like …", a shortcut's own. */
  heading: string;
  /** "Surprise me" is dealing posters: only that shows, so the pick isn't given away. */
  shuffling: boolean;
  /** How many movies the shuffle deals from, when known. */
  libraryTotal: number | undefined;
}) {
  const m = pick.movie;
  // Genre and rating are already shown above; chips explain the theme/mood/time match.
  const reasons = pick.reasons.filter((r) => r.kind !== 'genre' && r.kind !== 'rating');
  return (
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
          <p className={clsx('text-sm font-semibold', pick.closeMatch ? 'text-amber-300' : 'text-indigo-200')}>{heading}</p>
          {/* Long titles step down on phones so the ratings still clear the action bar. */}
          <h1
            className={clsx('mt-2 font-display text-balance sm:text-6xl lg:text-7xl', m.title.length > 28 ? 'text-[40px]' : 'text-5xl')}
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
  );
}
