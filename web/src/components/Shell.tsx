import clsx from 'clsx';
import { ChevronLeft, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStatus } from '../lib/api';
import { Link } from '../lib/router';
import { Avatar } from './ui';

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <img src="/logo.svg" alt="" className="size-7" />
      <span className="font-display text-[26px] tracking-tight">Curatorr</span>
    </span>
  );
}

/** Top bar with the logo, the active profile and (for the owner) settings. */
export function Shell({ children, wide = false, bare = false }: { children: ReactNode; wide?: boolean; bare?: boolean }) {
  const { data: status } = useStatus();
  const profile = status?.profile;

  return (
    <div className="min-h-dvh">
      <header
        className={clsx(
          'relative z-20 mx-auto flex items-center justify-between px-4 pt-safe pb-3 sm:px-6',
          wide ? 'max-w-6xl' : 'max-w-3xl',
        )}
      >
        <Link to="/" aria-label="Curatorr home" className="rounded-lg">
          <Wordmark />
        </Link>
        {!bare && (
          <nav className="flex items-center gap-1">
            <Link
              to="/settings"
              aria-label="Settings"
              className="grid size-11 place-items-center rounded-full text-muted transition hover:bg-white/5 hover:text-fg"
            >
              <Settings className="size-5" />
            </Link>
            {profile && (
              <Link
                to="/profiles"
                className="flex items-center gap-2 rounded-full py-1.5 pr-1 pl-3 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
                aria-label={`Watching as ${profile.name}. Switch profile`}
              >
                <span className="hidden sm:inline">{profile.name}</span>
                <Avatar name={profile.name} src={profile.avatarUrl} className="size-8 ring-2 ring-white/10" />
              </Link>
            )}
          </nav>
        )}
      </header>
      <main className={clsx('relative z-10 mx-auto px-4 pb-safe sm:px-6', wide ? 'max-w-6xl' : 'max-w-3xl')}>{children}</main>
    </div>
  );
}

export function BackButton() {
  return (
    <button
      onClick={() => window.history.back()}
      className="-ml-2 inline-flex h-11 items-center gap-1 rounded-lg pr-3 pl-1 text-sm font-medium text-muted hover:text-fg"
    >
      <ChevronLeft className="size-5" /> Back
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
