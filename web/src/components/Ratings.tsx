import type { Ratings as RatingsData } from '@curatorr/shared';
import clsx from 'clsx';

/** A generic tomato (fresh) or splat (rotten) mark. */
function TomatoMark({ fresh, className }: { fresh: boolean; className?: string }) {
  if (fresh) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path fill="#fa320a" d="M12 7c5 0 9 3.2 9 7.6S17 22 12 22s-9-2.9-9-7.4S7 7 12 7z" />
        <path fill="#00912d" d="M12 8.6c-1.4-1.7-3.6-2-5-1.3 1.3-.1 2.4.4 3 1.2C8.6 8.5 7 9.4 6.4 10.6 8 9.7 10 9.5 12 10c2-.5 4-.3 5.6.6-.6-1.2-2.2-2.1-3.6-2.1.6-.8 1.7-1.3 3-1.2-1.4-.7-3.6-.4-5 1.3z" />
        <path fill="#00912d" d="M11.3 8.4c.1-1.6.6-3 1.6-4.2l.8.5c-.8 1-1.3 2.3-1.4 3.8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#3bb33b"
        d="M12 3.5l1.6 4 3.6-2.2-.9 4.2 4.3.3-3.3 2.8 3.4 2.6-4.3.5 1.2 4.1-3.7-2.1-1.4 4.1-1.7-4-3.6 2.3.8-4.2-4.3-.2 3.2-2.9L3.5 9.8l4.3-.6L6.5 5l3.7 2z"
      />
    </svg>
  );
}

function metacriticTone(score: number) {
  if (score >= 61) return 'bg-[#00ce7a] text-black';
  if (score >= 40) return 'bg-[#ffbd3f] text-black';
  return 'bg-[#ff6874] text-black';
}

export function RatingBadges({ ratings, size = 'md' }: { ratings: RatingsData; size?: 'sm' | 'md' }) {
  const big = size === 'md';
  return (
    <div className={clsx('flex flex-wrap items-center', big ? 'gap-x-5 gap-y-2' : 'gap-x-3 gap-y-1')}>
      {ratings.rt != null && (
        <span className="inline-flex items-center gap-1.5" title="Rotten Tomatoes tomatometer">
          <TomatoMark fresh={ratings.rt >= 60} className={big ? 'size-7' : 'size-4'} />
          <span className="sr-only">Rotten Tomatoes</span>
          <span className={clsx('font-bold tabular-nums', big ? 'text-2xl font-narrow' : 'text-sm')}>
            {Math.round(ratings.rt)}%
          </span>
        </span>
      )}
      {ratings.imdb != null && (
        <span className="inline-flex items-center gap-1.5" title="IMDb rating">
          <span
            className={clsx(
              'rounded-[4px] bg-imdb font-black tracking-tight text-black',
              big ? 'px-1.5 py-0.5 text-xs' : 'px-1 text-[10px]',
            )}
          >
            IMDb
          </span>
          <span className={clsx('font-semibold tabular-nums', big ? 'text-lg' : 'text-sm')}>{ratings.imdb.toFixed(1)}</span>
        </span>
      )}
      {ratings.metacritic != null && (
        <span className="inline-flex items-center gap-1.5" title="Metacritic metascore">
          <span
            className={clsx(
              'grid place-items-center rounded-[4px] font-bold tabular-nums',
              metacriticTone(ratings.metacritic),
              big ? 'size-7 text-sm' : 'size-5 text-[10px]',
            )}
          >
            {Math.round(ratings.metacritic)}
          </span>
          {big && <span className="text-sm text-muted">Metascore</span>}
        </span>
      )}
    </div>
  );
}
