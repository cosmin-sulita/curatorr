import type { Profile } from '@curatorr/shared';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { useDialogFocus } from '../lib/dialogFocus';
import { useScrollLock } from '../lib/scrollLock';
import { Avatar, Button } from './ui';

export type PersonalMark = 'seen' | 'later' | 'never';

/** What the sheet asks about: a mark, or taking a movie off watchlists. */
export type ForWhomKind = PersonalMark | 'unwatchlist';

const COPY: Record<ForWhomKind, { title: string; hint: string }> = {
  seen: { title: 'Who has seen it?', hint: "It's marked as seen for them, and left out while you watch together." },
  later: { title: 'Whose watchlist?', hint: 'It goes on their watchlist.' },
  never: { title: 'Never suggest it to…', hint: "It won't come up for them again." },
  unwatchlist: { title: 'Take it off whose watchlist?', hint: 'It comes off their watchlist.' },
};

/**
 * Watching together, Seen it, Watchlist and Never ask who they're for, and so does taking a movie off watchlists.
 * Seen it starts with nobody ticked (usually one person has), and so does taking it off, which is someone's own
 * call; Watchlist and Never start with everyone. Render it outside Shell, like every overlay.
 */
export function ForWhom({
  kind,
  people,
  onDone,
  onCancel,
}: {
  kind: ForWhomKind;
  people: Profile[];
  onDone: (profileIds: number[]) => void;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<number[]>(() =>
    kind === 'seen' || kind === 'unwatchlist' ? [] : people.map((p) => p.id),
  );
  const dialog = useRef<HTMLDivElement>(null);
  useScrollLock();
  useDialogFocus(dialog);
  const toggle = (id: number) => setTicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <motion.div
      ref={dialog}
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/70 backdrop-blur-sm md:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="for-whom-title"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <motion.div
        className="w-full max-w-md rounded-t-3xl bg-surface px-5 pt-6 pb-safe ring-1 ring-line md:rounded-3xl md:pb-6"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      >
        <h2 id="for-whom-title" className="font-display text-3xl">
          {COPY[kind].title}
        </h2>
        <p className="mt-1 text-sm text-muted">{COPY[kind].hint}</p>
        <ul className="mt-5 flex flex-wrap gap-4">
          {people.map((p, i) => {
            const on = ticked.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  autoFocus={i === 0}
                  className="flex w-20 flex-col items-center gap-2 rounded-2xl p-1 text-center"
                >
                  <span className="relative">
                    <Avatar
                      name={p.name}
                      src={p.avatarUrl}
                      className={clsx('size-16 ring-4 transition', on ? 'ring-accent' : 'opacity-60 ring-transparent')}
                    />
                    {on && (
                      <span className="absolute -top-1 -right-1 grid size-7 place-items-center rounded-full bg-accent ring-4 ring-surface">
                        <Check className="size-3.5 text-white" aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 grid grid-cols-2 gap-3 pb-4 md:pb-0">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ticked.length} onClick={() => onDone(ticked)}>
            Done
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
