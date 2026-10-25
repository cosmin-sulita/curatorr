import type { Profile } from '@curatorr/shared';
import clsx from 'clsx';
import { Check, Lock, Users } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { PinPad } from '../components/PinPad';
import { BottomBar, CenteredState, Shell } from '../components/Shell';
import { Avatar, Button, Notice, Spinner } from '../components/ui';
import { ApiError, errorMessage, useProfiles, useSelectProfile, useSelectTogether, useStatus } from '../lib/api';
import { listNames, serverName } from '../lib/format';
import { navigate } from '../lib/router';

/** Who a parental limit is for, as Curatorr applies it (custom Plex limits and Jellyfin ages map to these). */
export const RESTRICTION_LABEL: Record<string, string> = {
  little_kid: 'Kids',
  older_kid: 'Older kids',
  teen: 'Teens',
};

export function ProfilesScreen() {
  const { data: profiles, isLoading, error } = useProfiles();
  const { data: status } = useStatus();
  const select = useSelectProfile();
  const selectTogether = useSelectTogether();
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  // Watching together: who's ticked, in the order they were. Null while picking one profile.
  const [picked, setPicked] = useState<number[] | null>(null);
  const pending = select.isPending || selectTogether.isPending;

  const askPin = (profile: Profile | undefined, err: ApiError, pin?: string) => {
    if (!profile) return;
    setPinError(pin ? err.message : null);
    setPinFor(profile);
  };

  const choose = (profile: Profile, pin?: string) => {
    if (pending) return;
    select.mutate(
      { id: profile.id, pin },
      {
        onSuccess: () => {
          setPinFor(null);
          navigate('/');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.data.needPin) askPin(profile, err, pin);
        },
      },
    );
  };

  // A protected profile asks for its PIN, then the group starts again with it.
  const start = (pin?: { id: number; pin: string }) => {
    if (pending || !picked || picked.length < 2) return;
    selectTogether.mutate(
      { ids: picked, pin },
      {
        onSuccess: () => {
          setPinFor(null);
          navigate('/');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.data.needPin) {
            askPin(profiles?.find((p) => p.id === err.data.profileId), err, pin?.pin);
          }
        },
      },
    );
  };

  const toggle = (id: number) => setPicked((ids) => (ids?.includes(id) ? ids.filter((x) => x !== id) : [...(ids ?? []), id]));
  const pickedNames = (picked ?? []).flatMap((id) => profiles?.find((p) => p.id === id)?.name ?? []);
  const startLabel = pickedNames.length >= 2 ? `Start with ${listNames(pickedNames)}` : 'Pick two or more people';
  const failure = [select.error, selectTogether.error].find((e) => e && !(e instanceof ApiError && e.data.needPin));
  const startButtons = (className: string) => (
    <div className={className}>
      <Button variant="primary" size="lg" className="w-full md:w-auto" disabled={pickedNames.length < 2} loading={selectTogether.isPending} onClick={() => start()}>
        {startLabel}
      </Button>
      <Button variant="ghost" size="lg" className="w-full md:w-auto" onClick={() => setPicked(null)}>
        Cancel
      </Button>
    </div>
  );

  return (
    <>
      <Shell>
        <div className="flex flex-col items-center pt-10 sm:pt-20">
          <h1 className="text-center font-display text-5xl sm:text-6xl">{picked ? "Who's watching together?" : "Who's watching?"}</h1>
          <p className="mt-3 max-w-sm text-center text-muted">
            {picked
              ? `Picks skip what any of you has watched in ${serverName(status?.server)}, within everyone's limits.`
              : `Picks skip the movies this person has already watched in ${serverName(status?.server)}.`}
          </p>

          {isLoading && <Spinner className="mt-16 size-8" />}
          {error && (
            <div className="mt-10">
              <Notice>{errorMessage(error)}</Notice>
            </div>
          )}
          {profiles && profiles.length === 0 && (
            <CenteredState title="No profiles yet">
              <p className="text-muted">
                {status?.server === 'jellyfin'
                  ? 'An administrator can import Jellyfin users in Settings.'
                  : 'The server owner can import Plex Home users in Settings.'}
              </p>
            </CenteredState>
          )}

          <ul className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
            {profiles?.map((p) => {
              const busy = select.isPending && select.variables?.id === p.id;
              const ticked = Boolean(picked?.includes(p.id));
              return (
                <li key={p.id}>
                  {/* Not `disabled` while a pick is pending: that would drop focus, which the PIN pad gives back. */}
                  <button
                    onClick={() => (picked ? toggle(p.id) : choose(p))}
                    aria-disabled={pending}
                    aria-pressed={picked ? ticked : undefined}
                    className="group flex w-32 flex-col items-center gap-3 rounded-2xl p-2 text-center aria-disabled:cursor-wait"
                  >
                    <span className="relative">
                      <Avatar
                        name={p.name}
                        src={p.avatarUrl}
                        className={clsx(
                          'size-24 ring-4 transition group-hover:ring-accent-2 group-focus-visible:ring-accent-2 sm:size-28',
                          ticked ? 'ring-accent' : 'ring-transparent',
                          ((select.isPending && !busy) || (picked && !ticked)) && 'opacity-60',
                        )}
                      />
                      {busy && (
                        <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/60">
                          <Spinner className="size-8 text-white" />
                        </span>
                      )}
                      {ticked && (
                        <span className="absolute -top-1 -right-1 grid size-8 place-items-center rounded-full bg-accent ring-4 ring-ink">
                          <Check className="size-4 text-white" aria-hidden />
                        </span>
                      )}
                      {p.locked && (
                        <span className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full bg-raised ring-4 ring-ink">
                          <Lock className="size-4 text-muted" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="font-semibold text-fg">{p.name}</span>
                    {p.restrictionProfile && (
                      <span className="-mt-2 text-xs text-faint">{RESTRICTION_LABEL[p.restrictionProfile]}</span>
                    )}
                    {/* The lock badge is decorative; this says the same after the name. */}
                    {p.locked && <span className="sr-only">PIN protected</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Watching together: the device's own profile starts ticked. */}
          {!picked && (profiles?.length ?? 0) >= 2 && (
            <Button
              className="mt-12"
              onClick={() => setPicked(status?.profile && profiles?.some((p) => p.id === status.profile!.id) ? [status.profile.id] : [])}
            >
              <Users className="size-4" /> Watching together
            </Button>
          )}
          {picked && startButtons('mt-12 hidden gap-3 md:flex')}

          {failure && (
            <div className="mt-8 max-w-md">
              <Notice>{errorMessage(failure)}</Notice>
            </div>
          )}
          {/* Phones: room for the bar. */}
          {picked && <div className="h-36 md:hidden" aria-hidden />}
        </div>
      </Shell>

      {/* Phones: Start stays under the thumb. Outside Shell, like every fixed bar. */}
      {picked && <BottomBar>{startButtons('flex flex-col gap-1')}</BottomBar>}

      {/* Outside Shell: its <main> is a stacking context below the header. */}
      <AnimatePresence>
        {pinFor && (
          <PinPad
            profile={pinFor}
            title={`Enter ${pinFor.name}'s ${status?.server === 'plex' ? 'Plex PIN' : 'PIN'}`}
            subtitle="Asked again once this device switches to someone else."
            error={pinError}
            busy={pending}
            onCancel={() => {
              setPinFor(null);
              setPinError(null);
            }}
            onSubmit={(pin) => (picked ? start({ id: pinFor.id, pin }) : choose(pinFor, pin))}
          />
        )}
      </AnimatePresence>
    </>
  );
}

