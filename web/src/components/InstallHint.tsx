import { Share, SquarePlus, X, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dismissInstallHint, install, useInstallHint } from '../lib/install';
import { Button } from './ui';

/** Phones, in the browser: suggests putting Curatorr on the home screen until it's dismissed. */
export function InstallHint() {
  const hint = useInstallHint();
  return (
    // The tip arrives with the question; only an install offer that comes later (Android) expands in.
    <AnimatePresence initial={false}>
      {hint && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          {/* ring-inset: the wrapper clips while it animates, which would cut off an outer ring. */}
          <div className="mb-3 flex gap-4 rounded-2xl bg-accent/10 py-3 pr-1 pl-4 ring-1 ring-accent/25 ring-inset">
            <img src="/apple-touch-icon-180x180.png" alt="" className="size-11 shrink-0 rounded-[10px]" />
            <div className="min-w-0 flex-1 py-0.5">
              <p className="leading-snug font-semibold">Use Curatorr like an app</p>
              {hint === 'share' ? (
                <p className="mt-1 text-sm text-muted">
                  Tap <Step label="Share" icon={Share} /> (under ··· in newer Safari), then{' '}
                  <Step label="Add to Home Screen" icon={SquarePlus} />.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted">Install it on your home screen, where it opens full screen.</p>
                  <Button className="mt-3" onClick={() => void install()}>
                    Install
                  </Button>
                </>
              )}
            </div>
            <button
              onClick={dismissInstallHint}
              aria-label="Hide this tip"
              className="press-dim -mt-1.5 grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white/5 hover:text-fg"
            >
              <X className="size-5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A button to look for in the browser, named as it is there and kept on one line with its icon. */
function Step({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <span className="font-semibold whitespace-nowrap text-fg">
      {label}
      <Icon className="ml-1 inline size-4 align-[-3px]" aria-hidden />
    </span>
  );
}
