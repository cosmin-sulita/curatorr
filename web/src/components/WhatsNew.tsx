import { hasHeadlineNews, type Release, type ReleaseNote } from '@curatorr/shared';
import { useIsFetching } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { appVersion, markSeen, unseenReleases } from '../lib/whatsNew';
import { Dialog } from './Dialog';
import { Button } from './ui';

const GROUPS: { kind: ReleaseNote['kind']; title: string }[] = [
  { kind: 'new', title: 'New' },
  { kind: 'fix', title: 'Fixes' },
  { kind: 'improved', title: 'Improvements' },
];

/** "2026-10-08" as "Oct 8", read as a local date (a bare ISO date would parse as UTC midnight). */
function releaseDate(date: string) {
  const d = new Date(`${date}T00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Shows what changed the first time the app opens on a newer version. */
export function WhatsNew({ setupComplete }: { setupComplete: boolean }) {
  const [shown, setShown] = useState<Release[]>([]);
  const loading = useIsFetching() > 0;

  useEffect(() => {
    // A fresh install has nothing to call "new", including right after setup finishes.
    if (!setupComplete) return markSeen();
    // Fix-only updates don't interrupt; their notes stay under Settings → What's new.
    const unseen = unseenReleases();
    if (!hasHeadlineNews(unseen)) return markSeen();
    // Wait for the screen behind to load and slide in, or it arrives through the fading backdrop before the blur.
    if (loading) return;
    const timer = setTimeout(() => setShown(unseen), 600);
    return () => clearTimeout(timer);
  }, [setupComplete, loading]);

  return (
    <AnimatePresence>
      {shown.length > 0 && (
        <WhatsNewDialog
          releases={shown}
          onClose={() => {
            markSeen();
            setShown([]);
          }}
        />
      )}
    </AnimatePresence>
  );
}

export function WhatsNewDialog({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const several = releases.length > 1;

  return (
    // It often opens on its own as the app starts, so it takes focus itself (see focusSelf).
    <Dialog
      labelledBy="whats-new-title"
      onClose={onClose}
      closeOnBackdrop
      focusSelf
      className="grid touch-none place-items-center bg-ink/85 px-4 pt-safe pb-safe backdrop-blur-md"
    >
      <motion.div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-3xl bg-surface p-6 shadow-2xl shadow-black/50 ring-1 ring-line"
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
      >
        {/* shrink-0 here and on the button: long notes scroll, they don't squash the rest. */}
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-gradient text-white">
          <Sparkles className="size-5" />
        </span>
        <h2 id="whats-new-title" className="mt-4 font-display text-4xl">
          What's new
        </h2>
        <p className="mt-1 text-sm text-muted">Curatorr {appVersion}</p>

        {/* Focusable, so the notes scroll from the keyboard too. */}
        <div
          tabIndex={0}
          role="region"
          aria-label="Release notes"
          className="-mx-6 mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 focus-visible:outline-offset-[-2px]"
        >
          {releases.map((r) => (
            <section key={r.version}>
              {several && (
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">
                  {r.version}
                  {r.date && ` · ${releaseDate(r.date)}`}
                </h3>
              )}
              {r.intro && <p className="mb-3 text-[15px] text-fg">{r.intro}</p>}
              {GROUPS.map(({ kind, title }) => {
                const notes = r.notes.filter((n) => n.kind === kind);
                if (!notes.length) return null;
                return (
                  <div key={kind} className="mt-3 first:mt-0">
                    <h4 className="text-sm font-semibold text-indigo-300">{title}</h4>
                    <ul className="mt-1.5 space-y-1.5">
                      {notes.map((n) => (
                        <li key={n.text} className="flex gap-2.5 text-[15px] text-fg">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-2" aria-hidden />
                          {n.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <Button variant="primary" className="mt-6 w-full shrink-0" onClick={onClose}>
          Got it
        </Button>
      </motion.div>
    </Dialog>
  );
}
