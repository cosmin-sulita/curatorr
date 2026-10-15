import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from '../lib/router';
import { Img } from './ui';

/** How each poster leans, by how many there are: three fan out like a hand of cards, two lean apart, one stands. */
const TILTS = [[''], ['-rotate-6 translate-x-2', 'rotate-6 -translate-x-2'], ['-rotate-6 translate-x-4', 'z-10', 'rotate-6 -translate-x-4']];

/** Up to three posters, centred in the room three take, so cards stacked above each other line up. */
export function PosterFan({ images }: { images: string[] }) {
  const shown = images.slice(0, 3);
  const tilt = TILTS[shown.length - 1] ?? [];
  return (
    <span className="-mr-2 flex w-30 shrink-0 items-center justify-center sm:w-33" aria-hidden>
      {shown.map((src, i) => (
        <Img
          key={src}
          src={src}
          className={clsx(
            'h-14 w-10 rounded-md object-cover shadow-lg shadow-black/50 ring-1 ring-black/40 sm:h-16 sm:w-11',
            tilt[i],
          )}
        />
      ))}
    </span>
  );
}

/**
 * A card that opens a list of movies: an icon, a title and a line under it, with posters from the list. Without
 * `to` there's nothing to open (an empty list), and it only says how to fill it.
 */
export function FanCard({
  to,
  icon,
  title,
  subtitle,
  posters = [],
  className,
}: {
  to?: string;
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  posters?: string[];
  className?: string;
}) {
  const content = (
    <>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-raised text-indigo-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block leading-snug font-semibold">{title}</span>
        <span className="block text-sm text-muted">{subtitle}</span>
      </span>
      {posters.length > 0 && <PosterFan images={posters} />}
    </>
  );
  const card = 'flex items-center gap-4 rounded-2xl bg-surface py-3 pr-5 pl-4 ring-1 ring-line';
  return to ? (
    <Link to={to} className={clsx(className, card, 'transition hover:bg-raised active:scale-[0.99]')}>
      {content}
    </Link>
  ) : (
    <div className={clsx(className, card)}>{content}</div>
  );
}
