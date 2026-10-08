import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { vibrate } from '../lib/format';

// Gaps between cards, easing out so the deck visibly slows before the pick lands.
const GAPS = [70, 75, 85, 100, 125, 160, 220];
// From the pick landing to handing over: its spring settles, then it sits for a beat.
const SETTLE = 450;
// Don't keep the surprise waiting on a slow image; a card without one just shows its tint.
const PRELOAD_CAP = 600;

const card = 'aspect-[2/3] w-full rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10';

function shuffled<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function preload(urls: string[]) {
  const all = Promise.all(
    urls.map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => {});
    }),
  );
  return Promise.race([all, new Promise((resolve) => setTimeout(resolve, PRELOAD_CAP))]);
}

/**
 * "Surprise me": deals a few of the other candidates' posters onto a pile, slowing down,
 * then lands tonight's pick on top. Sized like the poster it hands over to.
 */
export function PosterShuffle({ posters, final, onDone }: { posters: string[]; final: string | null; onDone: () => void }) {
  const [deck] = useState(() => {
    const cards = shuffled(posters).slice(0, GAPS.length);
    return {
      cards: [...cards, final],
      gaps: GAPS.slice(GAPS.length - cards.length),
      tilts: cards.map(() => (Math.random() * 2 - 1) * 7),
    };
  });
  const [top, setTop] = useState(-1);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    preload(deck.cards.filter((src): src is string => Boolean(src))).then(() => {
      if (cancelled) return;
      // gaps[i] separates card i from card i + 1, so the loop ends at the moment the pick lands.
      let at = 0;
      deck.cards.forEach((_, i) => {
        timers.push(window.setTimeout(() => setTop(i), at));
        at += deck.gaps[i] ?? 0;
      });
      timers.push(window.setTimeout(() => vibrate(), at));
      timers.push(window.setTimeout(() => done.current(), at + SETTLE));
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [deck]);

  const last = deck.cards.length - 1;
  return (
    <div className="relative" aria-hidden>
      {/* Holds the poster's size, and stands in for it until the first card is dealt. */}
      <div className={clsx(card, 'bg-raised', top >= 0 && 'opacity-0')} />
      {deck.cards.slice(0, top + 1).map((src, i) => {
        const isPick = i === last;
        const tilt = isPick ? 0 : deck.tilts[i]!;
        return (
          <motion.div
            key={i}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.9, x: 28, rotate: tilt * 1.6 }}
            animate={{ opacity: 1, scale: 1, x: 0, rotate: tilt }}
            transition={isPick ? { type: 'spring', stiffness: 500, damping: 20 } : { duration: 0.12, ease: 'easeOut' }}
          >
            {src ? (
              <img src={src} alt="" draggable={false} className={card} />
            ) : (
              <div className={clsx(card, 'bg-raised')} />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
