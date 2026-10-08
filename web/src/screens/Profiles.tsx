import type { Profile } from '@curatorr/shared';
import clsx from 'clsx';
import { Delete, Lock } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { CenteredState, Shell } from '../components/Shell';
import { Avatar, Button, Notice, Spinner } from '../components/ui';
import { ApiError, errorMessage, useProfiles, useSelectProfile } from '../lib/api';
import { navigate } from '../lib/router';

const RESTRICTION_LABEL: Record<string, string> = {
  little_kid: 'Kids',
  older_kid: 'Older kids',
  teen: 'Teens',
};

export function ProfilesScreen() {
  const { data: profiles, isLoading, error } = useProfiles();
  const select = useSelectProfile();
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const choose = (profile: Profile, pin?: string) => {
    select.mutate(
      { id: profile.id, pin },
      {
        onSuccess: () => {
          setPinFor(null);
          navigate('/');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.data.needPin) {
            setPinError(pin ? err.message : null);
            setPinFor(profile);
          }
        },
      },
    );
  };

  return (
    <Shell bare>
      <div className="flex flex-col items-center pt-10 sm:pt-20">
        <h1 className="font-display text-5xl sm:text-6xl">Who's watching?</h1>
        <p className="mt-3 max-w-sm text-center text-muted">Picks skip the movies this person has already watched in Plex.</p>

        {isLoading && <Spinner className="mt-16 size-8" />}
        {error && (
          <div className="mt-10">
            <Notice>{errorMessage(error)}</Notice>
          </div>
        )}
        {profiles && profiles.length === 0 && (
          <CenteredState title="No profiles yet">
            <p className="text-muted">The server owner can import Plex Home users in Settings.</p>
          </CenteredState>
        )}

        <ul className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
          {profiles?.map((p) => {
            const busy = select.isPending && select.variables?.id === p.id;
            return (
              <li key={p.id}>
                <button
                  onClick={() => choose(p)}
                  disabled={select.isPending}
                  className="group flex w-32 flex-col items-center gap-3 rounded-2xl p-2 text-center disabled:cursor-wait"
                >
                  <span className="relative">
                    <Avatar
                      name={p.name}
                      src={p.avatarUrl}
                      className={clsx(
                        'size-24 ring-4 ring-transparent transition group-hover:ring-accent-2 group-focus-visible:ring-accent-2 sm:size-28',
                        select.isPending && !busy && 'opacity-40',
                      )}
                    />
                    {busy && (
                      <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/60">
                        <Spinner className="size-8 text-white" />
                      </span>
                    )}
                    {p.pinProtected && !p.linked && (
                      <span className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full bg-raised ring-4 ring-ink">
                        <Lock className="size-4 text-muted" aria-label="PIN protected" />
                      </span>
                    )}
                  </span>
                  <span className="font-semibold text-fg">{p.name}</span>
                  {p.restrictionProfile && (
                    <span className="-mt-2 text-xs text-faint">{RESTRICTION_LABEL[p.restrictionProfile]}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {select.error && !(select.error instanceof ApiError && select.error.data.needPin) && (
          <div className="mt-8 max-w-md">
            <Notice>{errorMessage(select.error)}</Notice>
          </div>
        )}
      </div>

      <AnimatePresence>
        {pinFor && (
          <PinPad
            profile={pinFor}
            error={pinError}
            busy={select.isPending}
            onCancel={() => {
              setPinFor(null);
              setPinError(null);
            }}
            onSubmit={(pin) => choose(pinFor, pin)}
          />
        )}
      </AnimatePresence>
    </Shell>
  );
}

function PinPad({
  profile,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  profile: Profile;
  error: string | null;
  busy: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');

  const press = (digit: string) => {
    if (busy) return;
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      onSubmit(next);
      setPin('');
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-40 grid place-items-center bg-ink/85 px-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Enter the Plex PIN for ${profile.name}`}
      onKeyDown={(e) => {
        if (/^\d$/.test(e.key)) press(e.key);
        if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="flex w-full max-w-xs flex-col items-center">
        <Avatar name={profile.name} src={profile.avatarUrl} className="size-20" />
        <h2 className="mt-4 text-lg font-semibold">Enter {profile.name}'s Plex PIN</h2>
        <p className="mt-1 text-center text-sm text-muted">Only needed once on this server.</p>
        <div className="mt-6 flex gap-3" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={clsx('size-3.5 rounded-full transition', i < pin.length ? 'bg-fg' : 'bg-raised ring-1 ring-line')} />
          ))}
        </div>
        <p className="mt-3 h-5 text-sm text-red-300" role="alert">
          {error}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <PadKey key={d} onClick={() => press(d)} autoFocus={d === '1'}>
              {d}
            </PadKey>
          ))}
          <Button variant="ghost" className="h-16" onClick={onCancel}>
            Cancel
          </Button>
          <PadKey onClick={() => press('0')}>0</PadKey>
          <button
            className="grid h-16 place-items-center rounded-2xl text-muted hover:bg-white/5"
            onClick={() => setPin((p) => p.slice(0, -1))}
            aria-label="Delete digit"
          >
            <Delete className="size-6" />
          </button>
        </div>
        {busy && <Spinner className="mt-4 size-5" />}
      </div>
    </motion.div>
  );
}

function PadKey({ children, onClick, autoFocus }: { children: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button
      autoFocus={autoFocus}
      onClick={onClick}
      className="grid h-16 w-20 place-items-center rounded-2xl bg-surface text-2xl font-semibold tabular-nums ring-1 ring-line transition hover:bg-raised active:scale-95"
    >
      {children}
    </button>
  );
}
