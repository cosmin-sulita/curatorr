import type { Pick } from '@curatorr/shared';
import { motion } from 'motion/react';
import type { Ref } from 'react';
import { Img } from '../../components/ui';
import type { useLongPress } from '../../lib/longPress';

/** The profile asked for this movie in Seerr. */
const requested = (p: Pick) => p.reasons.some((r) => r.kind === 'requested');

/**
 * "Other good picks": a rail of posters. A tap makes one the pick; held down (or right-clicked), it opens its menu.
 * It fades in just after the details when it first appears, not again on each pass.
 */
export function OtherPicks({
  title,
  picks,
  railRef,
  hold,
  onChoose,
  onMenu,
}: {
  title: string;
  picks: Pick[];
  railRef: Ref<HTMLUListElement>;
  hold: ReturnType<typeof useLongPress>;
  onChoose: (pick: Pick) => void;
  onMenu: (pick: Pick, el: HTMLElement) => void;
}) {
  return (
    <motion.section
      className="mt-14 mb-6"
      aria-labelledby="more-picks"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.35 }}
    >
      <h2 id="more-picks" className="font-display text-3xl">
        {title}
      </h2>
      {/* Scroll padding lines the first poster up with the heading; pt-1.5 leaves room for the focus ring. */}
      <ul
        ref={railRef}
        className="no-scrollbar -mx-4 mt-2.5 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pt-1.5 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6"
      >
        {/* relative: the screen-reader text is absolutely positioned, and the rail only clips it inside its card. */}
        {picks.map((p) => (
          <li key={p.movie.id} className="relative w-28 shrink-0 snap-start sm:w-36">
            <button
              // Held down, or with a right click or the menu key, it opens a menu of its own (PosterMenu).
              {...hold((el) => onMenu(p, el))}
              aria-haspopup="menu"
              onClick={() => onChoose(p)}
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
  );
}
