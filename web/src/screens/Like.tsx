import clsx from 'clsx';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BackButton, Shell } from '../components/Shell';
import { Button, Img, Notice, Pending, PICTURE, plainField, sized, Spinner } from '../components/ui';
import { errorMessage, useLikeSeeds, useStatus } from '../lib/api';
import { serverName } from '../lib/format';
import { navigate, withQuery } from '../lib/router';
import { ENTERED, tapped, useAdvance, useEntrance } from '../lib/wizard';

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
  }, [text, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => {
    e.preventDefault();
    commit(text);
    input.current?.blur(); // Puts the keyboard away so the results show.
  };
  // The pick opens once it has loaded, which starts as a finger lands on a poster; until then the poster stays pressed.
  const { go, going, warm } = useAdvance();
  const pickUrl = (id: number) => withQuery('/pick', { like: String(id) });
  const choose = (id: number) => go(String(id), pickUrl(id));
  const entrance = useEntrance();

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
            className={clsx(
              'mt-3 grid grid-cols-3 gap-x-3 gap-y-5 transition-opacity sm:grid-cols-4 md:grid-cols-5',
              isFetching && isPlaceholderData && 'opacity-60',
            )}
          >
            {data.map((m) => {
              const state = tapped(going, String(m.id));
              return (
                <li key={m.id}>
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
