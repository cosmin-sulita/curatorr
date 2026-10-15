import { STEP_ORDER, genreById, type Criteria, type LikeSeed, type WizardOption, type WizardStep } from '@curatorr/shared';
import clsx from 'clsx';
import { Shuffle } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { FanCard, PosterFan } from '../components/FanCard';
import { InstallHint } from '../components/InstallHint';
import { BackButton, BottomBar, CenteredState, Shell } from '../components/Shell';
import { Button, Img, Notice, Spinner } from '../components/ui';
import { errorMessage, useLikeSeeds, useStatus, useWizardOptions } from '../lib/api';
import { plural } from '../lib/format';
import { TagIcon } from '../lib/icons';
import { Link, navigate, withQuery } from '../lib/router';
import { requestSurprise } from '../lib/surprise';

const COPY: Record<WizardStep, { title: string; any: string | null }> = {
  genre: { title: 'What kind of movie tonight?', any: 'Surprise me' },
  theme: { title: 'Anything in particular?', any: "Doesn't matter" },
  mood: { title: 'How should it feel?', any: 'Any mood is fine' },
  time: { title: 'How much time do you have?', any: null },
};

export function criteriaFrom(search: URLSearchParams): Criteria {
  return {
    genre: search.get('genre'),
    theme: search.get('theme'),
    mood: search.get('mood'),
    time: search.get('time'),
    shelf: search.get('shelf'),
  };
}

/** Answers given before `step`; later answers are dropped when going back. */
function answersBefore(step: WizardStep, c: Criteria): Criteria {
  const out: Criteria = {};
  for (const s of STEP_ORDER) {
    if (s === step) break;
    out[s] = c[s] ?? null;
  }
  return out;
}

function nextUrl(step: WizardStep, c: Criteria, value: string) {
  const answers = { ...answersBefore(step, c), [step]: value };
  const index = STEP_ORDER.indexOf(step);
  const next = STEP_ORDER[index + 1];
  return withQuery(next ? `/ask/${next}` : '/pick', answers);
}

export function WizardScreen({ step, search }: { step: WizardStep; search: URLSearchParams }) {
  const criteria = answersBefore(step, criteriaFrom(search));
  const { data, isLoading, error, refetch } = useWizardOptions(step, criteria);
  // Fetched alongside the genres, and waited for, so the "Something like…" card appears with its posters
  // rather than growing under the thumb when they arrive. A failure only leaves the posters out.
  const seeds = useLikeSeeds('', step === 'genre');
  const seedsPending = step === 'genre' && seeds.isPending;
  const { data: status } = useStatus();
  const index = STEP_ORDER.indexOf(step);

  useEffect(() => {
    if (data?.skip) navigate(nextUrl(step, criteria, 'any'), { replace: true });
  }, [data?.skip, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (value: string) => navigate(nextUrl(step, criteria, value));
  // "Surprise me" skips the rest of the questions, and the pick lands after a quick shuffle.
  const chooseAny = () => {
    if (step !== 'genre') return choose('any');
    requestSurprise();
    navigate(withQuery('/pick', { genre: 'any', theme: 'any', mood: 'any', time: 'any' }));
  };
  const genreLabel = criteria.genre && criteria.genre !== 'any' ? genreById.get(criteria.genre)?.label : null;

  if (error) {
    return (
      <Shell>
        <CenteredState title="Couldn't load the questions">
          <Notice>{errorMessage(error)}</Notice>
          <Button onClick={() => refetch()}>Try again</Button>
        </CenteredState>
      </Shell>
    );
  }

  if (step === 'genre' && data && data.total === 0) {
    return (
      <Shell>
        {status?.library.syncing ? (
          <CenteredState title="Getting your library ready">
            <Spinner className="size-8" />
            <p className="text-muted">Curatorr is reading your movies from Radarr. This only takes a moment.</p>
          </CenteredState>
        ) : (
          <CenteredState title="Nothing to pick from">
            <p className="text-muted">
              {status?.library.movies
                ? 'Every movie in the library is either watched or hidden for this profile.'
                : 'No downloaded movies were found in Radarr yet.'}
            </p>
            {status?.library.lastError && <Notice>{status.library.lastError}</Notice>}
            <Link to="/settings" className="inline-flex min-h-11 items-center font-semibold text-indigo-300 hover:underline">
              Open settings
            </Link>
          </CenteredState>
        )}
      </Shell>
    );
  }

  const ready = Boolean(data && !data.skip && !seedsPending);
  const anyLabel = COPY[step].any;
  const anyButton = (className?: string) => (
    <Button variant={step === 'genre' ? 'primary' : 'secondary'} size="lg" className={className} onClick={chooseAny}>
      {step === 'genre' && <Shuffle className="size-5" />}
      {anyLabel}
    </Button>
  );

  return (
    <>
      <Shell>
        <div className="flex h-11 items-center justify-between">
          {index > 0 ? <BackButton /> : <span />}
          <ol className="flex gap-1.5" aria-label={`Question ${index + 1} of ${STEP_ORDER.length}`}>
            {STEP_ORDER.map((s, i) => (
              <li
                key={s}
                className={clsx('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-accent-gradient' : 'w-1.5', i < index ? 'bg-fg/60' : i > index && 'bg-faint/70')}
              />
            ))}
          </ol>
        </div>

        <motion.section
          key={step + JSON.stringify(criteria)}
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          className="pt-6"
        >
          {/* The question appears with its answers, so a skipped step never flashes. */}
          {data && ready && (
            <>
              <h1 className="font-display text-[44px] sm:text-6xl">{COPY[step].title}</h1>
              <p className="mt-3 text-muted">
                {plural(data.total, genreLabel ? `${genreLabel} movie` : 'movie')} to choose from
              </p>
              {/* Desktop: "no preference" before the list, not after it. */}
              {anyLabel && <div className="mt-6 hidden md:block">{anyButton()}</div>}
            </>
          )}

          {(isLoading || data?.skip || seedsPending) && (
            <div className="grid place-items-center py-24">
              <Spinner className="size-8" />
            </div>
          )}

          {data && ready && (
            <div className="mt-8">
              {step === 'genre' && <InstallHint />}
              {step === 'genre' && <LikeCard seeds={seeds.data} />}
              {step === 'genre' && (
                <GenreGrid
                  shelves={data.shelves ?? []}
                  options={data.options}
                  onShelf={(shelf) => navigate(withQuery('/pick', { shelf }))}
                  onChoose={choose}
                />
              )}
              {step === 'theme' && <ThemeList options={data.options} onChoose={choose} />}
              {step === 'mood' && <MoodGrid options={data.options} onChoose={choose} />}
              {step === 'time' && <TimeList options={data.options} onChoose={choose} />}
              {anyLabel && <div className="h-28 md:hidden" aria-hidden />}
            </div>
          )}
        </motion.section>
      </Shell>

      {/* Phones: "no preference" stays under the thumb, however long the list. */}
      {ready && anyLabel && <BottomBar>{anyButton('w-full')}</BottomBar>}
    </>
  );
}

type OptionsProps = { options: WizardOption[]; onChoose: (id: string) => void };

/** The genres, led by the shortcuts (Just arrived, the season's movies), which go straight to a pick. */
function GenreGrid({
  shelves,
  options,
  onShelf,
  onChoose,
}: OptionsProps & { shelves: WizardOption[]; onShelf: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {shelves.map((o) => (
        <GenreTile key={`shelf-${o.id}`} option={o} onClick={() => onShelf(o.id)} icon />
      ))}
      {options.map((o) => (
        <GenreTile key={o.id} option={o} onClick={() => onChoose(o.id)} />
      ))}
    </div>
  );
}

function GenreTile({ option: o, onClick, icon = false }: { option: WizardOption; onClick: () => void; icon?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="group relative aspect-[16/10] overflow-hidden rounded-2xl text-left ring-1 ring-line transition active:scale-[0.98]"
    >
      <Img src={o.images[0]} className="absolute inset-0 size-full object-cover grayscale transition duration-500 group-hover:scale-105" />
      <span className="absolute inset-0 mix-blend-multiply" style={{ backgroundColor: o.color }} />
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      {/* Shortcuts wear their icon, which sets them apart from the genres. */}
      {icon && (
        <span className="absolute top-2.5 left-3 grid size-8 place-items-center rounded-full bg-black/35 text-white ring-1 ring-white/20 backdrop-blur-sm">
          <TagIcon name={o.icon} className="size-4" />
        </span>
      )}
      <span className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
        <span className="font-display text-[26px] text-white drop-shadow sm:text-3xl">{o.label}</span>
        <span className="pb-1 text-xs font-medium text-white/70 tabular-nums">{o.count}</span>
      </span>
    </button>
  );
}

/** "Something like…": start from a movie you loved instead of answering the questions. */
function LikeCard({ seeds }: { seeds: LikeSeed[] | undefined }) {
  const posters = seeds?.flatMap((m) => (m.posterUrl ? [m.posterUrl] : [])).slice(0, 3) ?? [];
  return (
    <FanCard
      to="/like"
      className="mb-3"
      icon={<TagIcon name="Heart" className="size-5" />}
      title="Something like…"
      subtitle="Start from a movie you loved"
      posters={posters}
    />
  );
}

function ThemeList({ options, onChoose }: OptionsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChoose(o.id)}
          className="flex items-center gap-4 rounded-2xl bg-surface py-3 pr-5 pl-4 text-left ring-1 ring-line transition hover:bg-raised active:scale-[0.99]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-raised text-indigo-300">
            <TagIcon name={o.icon} className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block leading-snug font-semibold text-balance">{o.label}</span>
            <span className="block text-sm text-muted">{plural(o.count, 'movie')}</span>
          </span>
          <PosterFan images={o.images} />
        </button>
      ))}
    </div>
  );
}

function MoodGrid({ options, onChoose }: OptionsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChoose(o.id)}
          className="group relative flex min-h-32 items-end overflow-hidden rounded-2xl p-4 text-left ring-1 ring-line transition active:scale-[0.99]"
        >
          <Img src={o.images[0]} className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105" />
          <span className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/20" />
          <span className="relative flex items-center gap-3">
            <TagIcon name={o.icon} className="size-7 text-indigo-300" />
            <span>
              <span className="block font-display text-3xl">{o.label}</span>
              <span className="block text-sm text-muted">
                {o.description} ({o.count})
              </span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function TimeList({ options, onChoose }: OptionsProps) {
  return (
    <div className="grid gap-3">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChoose(o.id)}
          className="flex items-center gap-4 rounded-2xl bg-surface p-4 text-left ring-1 ring-line transition hover:bg-raised active:scale-[0.99]"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-raised text-indigo-300">
            <TagIcon name={o.icon} className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-display text-[28px]">{o.label}</span>
            <span className="block text-sm text-muted">{o.description}</span>
          </span>
          <span className="text-sm text-muted tabular-nums">{plural(o.count, o.id === 'saga' ? 'saga' : 'movie')}</span>
        </button>
      ))}
    </div>
  );
}
