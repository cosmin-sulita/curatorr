import type { LikeSeed } from '@curatorr/shared';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { BackButton, Shell } from '../components/Shell';
import { Button, Img, Notice, Pending, PICTURE, plainField, sized, Spinner } from '../components/ui';
import { errorMessage, useLikeSeeds, useStatus } from '../lib/api';
import { serverName } from '../lib/format';
import { navigate, withQuery } from '../lib/router';
import { ENTERED, tapped, useAdvance, useEntrance, useLookAhead } from '../lib/wizard';

/** How long a poster stays on screen before its pick loads ahead. On arrival, taps wait out 300 ms anyway. */
const SETTLE_MS = 150;

/**
 * The movies whose posters are on screen, in the grid's order. A list holds up to 60, so only these load what they
 * lead to ahead, and more as the page scrolls.
 */
function usePostersOnScreen(list: RefObject<HTMLUListElement | null>, seeds: LikeSeed[] | undefined) {
  const [onScreen, setOnScreen] = useState<number[]>([]);
  const ids = seeds?.map((s) => s.id) ?? [];
  const key = ids.join(',');
  useEffect(() => {
    const el = list.current;
    if (!el || !ids.length) {
      setOnScreen([]);
      return;
    }
    const visible = new Set<number>();
    let settle = 0;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = Number((e.target as HTMLElement).dataset.id);
        if (e.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      // Only the posters a scroll stops at: those it flies past don't load.
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const next = ids.filter((id) => visible.has(id));
        setOnScreen((prev) => (prev.join(',') === next.join(',') ? prev : next));
      }, SETTLE_MS);
    });
    for (const li of el.children) observer.observe(li);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, [key]); // `key` stands for `ids`, a new array on every render
  // New results show before the observer has looked at them: none of the old ones load meanwhile.
  return onScreen.filter((id) => ids.includes(id));
}

/** "Something like…": pick a movie you loved, then get unwatched ones that resemble it. */
export function LikeScreen({ search }: { search: URLSearchParams }) {
  const query = search.get('q') ?? '';
  const [text, setText] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useLikeSeeds(query);
  const { data: status } = useStatus();
  const searching = query !== '';

  // The search lives in the URL, so Back from a pick returns to the same results.
  const commit = (value: string) => navigate(withQuery('/like', { q: value.trim() }), { replace: true });
  useEffect(() => {
    if (text.trim() === query) return;
    const timer = setTimeout(() => commit(text), 200);
    return () => clearTimeout(timer);
  }, [text, query]); // Not `commit`, a new function on every render that only reads its argument

  const submit = (e: FormEvent) => {
    e.preventDefault();
    commit(text);
    input.current?.blur(); // Puts the keyboard away so the results show.
  };
  // The pick opens once it has loaded. The picks of the posters on screen load ahead, so a tap moves on at once; any
  // other starts loading as a finger lands on it, and its poster stays pressed until then.
  const { go, going, warm } = useAdvance();
  const pickUrl = (id: number) => withQuery('/pick', { like: String(id) });
  const choose = (id: number) => go(String(id), pickUrl(id));
  const entrance = useEntrance();
  const list = useRef<HTMLUListElement>(null);
  const onScreen = usePostersOnScreen(list, data);
  useLookAhead(onScreen.map(pickUrl), data && !isPlaceholderData && onScreen.length ? onScreen.join(',') : null);

  return (
    <Shell>
      <div className="flex h-11 items-center">
        <BackButton />
      </div>

      <motion.section
        initial={entrance}
        animate={ENTERED}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="pt-6 pb-10"
      >
        <h1 className="font-display text-[44px] sm:text-6xl">Which movie did you love?</h1>
        <p className="mt-3 text-muted">Curatorr finds movies you haven't seen that share its themes and keywords.</p>

        <form role="search" onSubmit={submit} className="relative mt-6">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-faint" aria-hidden />
          {/* 16px text, or iOS zooms in on focus. */}
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            enterKeyHint="search"
            autoComplete="off"
            // Titles are names: no correcting them into other words.
            {...plainField}
            className="h-12 w-full rounded-xl bg-surface pr-3.5 pl-11 text-base text-fg ring-1 ring-line placeholder:text-faint focus:ring-2 focus:ring-accent focus:outline-none"
          />
        </form>

        <h2 className="mt-8 text-sm font-semibold text-muted">{searching ? 'In your library' : 'Recently watched'}</h2>

        {isLoading && (
          <div className="grid place-items-center py-16">
            <Spinner className="size-8" />
          </div>
        )}

        {error && (
          <div className="mt-3 flex flex-col items-start gap-3">
            <Notice>{errorMessage(error)}</Notice>
            <Button onClick={() => refetch()}>Try again</Button>
          </div>
        )}

        {data && data.length === 0 && (
          <p className="mt-3 text-muted">
            {searching
              ? `Nothing in your library matches “${query}”.`
              : `Movies you watched in ${serverName(status?.server)} or marked Seen it show up here. Search for one you loved.`}
          </p>
        )}

        {data && data.length > 0 && (
          <ul
            ref={list}
            className={clsx(
              'mt-3 grid grid-cols-3 gap-x-3 gap-y-5 transition-opacity sm:grid-cols-4 md:grid-cols-5',
              isFetching && isPlaceholderData && 'opacity-60',
            )}
          >
            {data.map((m) => {
              const state = tapped(going, String(m.id));
              return (
                <li key={m.id} data-id={m.id}>
                  <button
                    onPointerDown={() => warm(pickUrl(m.id))}
                    onClick={() => choose(m.id)}
                    className={clsx('group press w-full text-left transition', state && 'scale-[0.97]')}
                  >
                    <span className="relative block">
                      <Img
                        src={sized(m.posterUrl, PICTURE.grid)}
                        className="aspect-[2/3] w-full rounded-xl object-cover ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent-2"
                      />
                      {state === 'slow' && <Pending className="rounded-xl" />}
                    </span>
                    <span className="mt-2 line-clamp-2 text-sm font-medium">{m.title}</span>
                    <span className="block text-xs text-muted">
                      {[m.year, searching && m.watched ? 'Watched' : null].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </motion.section>
    </Shell>
  );
}
