import clsx from 'clsx';
import { ChevronLeft, RefreshCw, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useStatus } from '../lib/api';
import { applyUpdate, useUpdateReady } from '../lib/appUpdate';
import { listNames } from '../lib/format';
import { justArrived, Link } from '../lib/router';
import { Avatar } from './ui';

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <img src="/logo.svg" alt="" className="size-7" />
      <span className="font-display text-[26px] tracking-tight">Curatorr</span>
    </span>
  );
}

/**
 * The page: a top bar with the logo, the active profile and (for the owner) settings, over the screen. App renders
 * it once for every screen, so the bar stays put between them: the logo never moves and the profile's photo doesn't
 * load again. `bare` leaves out Settings and the profile, for setup and "Who's watching?".
 */
export function Frame({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { data: status } = useStatus();
  const profile = status?.profile;
  // Watching together: the device's profile, then the others.
  const people = profile ? [profile, ...(status?.together ?? [])] : [];
  const names = people.map((p) => p.name);
  const updateReady = useUpdateReady();
  // A newer release on GitHub, for admins only. Not the same as updateReady, which reloads the app.
  const release = status?.update;

  return (
    // Nothing may widen the page sideways: phones zoom the whole screen out to fit it.
    <div className="min-h-dvh overflow-x-clip">
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-4 pt-safe pb-3 sm:px-6">
        {/* Home is a step back to the start: the first question comes in from the left. */}
        <Link to="/" back aria-label="Curatorr home" className="press-dim flex h-11 items-center rounded-lg transition">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1">
          {updateReady && <UpdateChip />}
          {!bare && (
            <>
              <Link
                to="/settings"
                aria-label={release ? `Settings. Curatorr ${release.version} is out` : 'Settings'}
                className="press-dim relative grid size-11 place-items-center rounded-full text-muted transition hover:bg-white/5 hover:text-fg"
              >
                <Settings className="size-5" />
                {/* Settings says which version, and how to get it. */}
                {release && (
                  <span className="absolute top-2 right-2 size-2.5 rounded-full bg-indigo-400 ring-2 ring-ink" aria-hidden />
                )}
              </Link>
              {profile && (
                <Link
                  to="/profiles"
                  className="press-dim flex items-center gap-2 rounded-full py-1.5 pr-1 pl-3 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
                  aria-label={
                    people.length > 1
                      ? `Watching together: ${listNames(names)}. Change who's watching`
                      : `Watching as ${profile.name}. Switch profile`
                  }
                >
                  <span className="hidden sm:inline">{listNames(names, ' & ')}</span>
                  <span className="flex">
                    {people.map((p, i) => (
                      <Avatar
                        key={p.id}
                        name={p.name}
                        src={p.avatarUrl}
                        className={clsx('size-8', people.length > 1 ? 'ring-2 ring-ink' : 'ring-2 ring-white/10', i > 0 && '-ml-3')}
                      />
                    ))}
                  </span>
                </Link>
              )}
            </>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}

/**
 * A screen's content, under the top bar. The bar has the same width on every screen; `wide` only widens this.
 * `<main>` is a stacking context below the bar, so fixed overlays render outside it.
 */
export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={clsx('relative z-10 mx-auto px-4 pb-safe sm:px-6', wide ? 'max-w-6xl' : 'max-w-3xl')}>{children}</main>
  );
}

/** A new version is waiting. If it's left alone, it loads the next time the app comes back to the foreground. */
function UpdateChip() {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={applyUpdate}
      aria-label="A new version of Curatorr is ready. Reload to update"
      className="group press-dim grid min-h-11 place-items-center rounded-full px-1 transition"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1.5 text-[13px] font-semibold text-indigo-200 ring-1 ring-indigo-400/40 transition group-hover:bg-indigo-500/25">
        <RefreshCw className="size-3.5" aria-hidden />
        Update
      </span>
    </motion.button>
  );
}

/**
 * Steps back through history, or runs `onClick` where the steps aren't in the URL (setup). It sits in the same spot
 * on every question, so the second tap of a double tap is ignored rather than going back twice.
 */
export function BackButton({ onClick, label = 'Back' }: { onClick?: () => void; label?: string }) {
  const back = () => {
    if (!justArrived()) window.history.back();
  };
  return (
    <button
      type="button"
      onClick={onClick ?? back}
      aria-label={label}
      className="press grid size-11 place-items-center rounded-full bg-surface text-fg ring-1 ring-line transition hover:bg-raised"
    >
      <ChevronLeft className="size-5" aria-hidden />
    </button>
  );
}

/** Phones only: actions pinned under the thumb, above the home indicator. Render it outside Shell. */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/85 px-4 pt-3 pb-safe backdrop-blur-xl md:hidden">
      {children}
    </div>
  );
}

export function CenteredState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 py-24 text-center">
      <h1 className="font-display text-4xl">{title}</h1>
      {children}
    </div>
  );
}
