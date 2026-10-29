import clsx from 'clsx';
import { Play, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { MouseEvent, ReactNode } from 'react';
import { BottomBar } from '../../components/Shell';
import { Button, buttonClass } from '../../components/ui';
import type { WatchLink } from '../../lib/format';

/** One of a pick's buttons: Not tonight, Watchlist (or On watchlist, `on`), Seen it, Never. */
export interface PickAction {
  key: string;
  label: string;
  Icon: LucideIcon;
  run: () => void;
  on?: boolean;
}

const WATCH_CLASS = 'w-full md:w-auto md:min-w-52';

/** Watch on Plex (or Jellyfin), or why it can't be yet. */
export function WatchButton({
  link,
  server,
  onWatch,
}: {
  link: WatchLink | null;
  server: string;
  onWatch: (e: MouseEvent<HTMLAnchorElement>, link: WatchLink) => void;
}) {
  return link ? (
    <a
      href={link.href}
      target={link.newTab ? '_blank' : undefined}
      rel="noopener noreferrer"
      onClick={(e) => onWatch(e, link)}
      className={buttonClass('primary', 'lg', WATCH_CLASS)}
    >
      <Play className="size-5 fill-current" /> Watch on {server}
    </a>
  ) : (
    <Button variant="primary" size="lg" disabled className={WATCH_CLASS}>
      <Play className="size-5 fill-current" /> Not in {server} yet
    </Button>
  );
}

/**
 * Desktop: actions inline with the details, laid out like the phone bar. They sit outside the details, which are
 * rebuilt for each pick, so a button keeps keyboard focus from one pick to the next.
 */
export function DesktopActions({ watch, actions }: { watch: ReactNode; actions: PickAction[] }) {
  return (
    <div className="mt-7 hidden md:block">
      {watch}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map(({ key, label, Icon, run, on }) => (
          <Button key={key} variant={on ? 'selected' : key === 'never' ? 'ghost' : 'secondary'} onClick={run}>
            <Icon className="size-4" /> {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Phones: actions stay under the thumb while reading. They fade in once a shuffle lands (`fadeIn`); opacity only,
 * since a transform would break the bar's fixed positioning.
 */
export function PhoneActions({ watch, actions, fadeIn }: { watch: ReactNode; actions: PickAction[]; fadeIn: boolean }) {
  return (
    <motion.div className="relative z-30" initial={fadeIn ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <BottomBar>
        {watch}
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
  );
}
