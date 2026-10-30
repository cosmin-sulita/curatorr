import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastInput {
  message: string;
  action?: { label: string; run: () => void };
  duration?: number;
}

interface ToastState extends ToastInput {
  id: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export const useToast = () => useContext(ToastContext);

/** Back from hovering or focusing a toast, it stays at least this long, so it doesn't vanish as the pointer leaves. */
const AFTER_PAUSE_MS = 2000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);
  // How long the current toast has left, counted while the timer runs, and what is holding it (hover, focus).
  const left = useRef({ ms: 0, since: 0 });
  const holds = useRef(new Set<string>());

  const run = useCallback((id: number, ms: number) => {
    window.clearTimeout(timer.current);
    left.current = { ms, since: Date.now() };
    timer.current = window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), ms);
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = ++counter.current;
      holds.current.clear();
      setToast({ ...t, id });
      run(id, t.duration ?? 5000);
    },
    [run],
  );

  // A toast someone is pointing at or has tabbed to (its Undo, often) waits for them.
  const hold = (why: string) => {
    if (!holds.current.size) {
      window.clearTimeout(timer.current);
      left.current.ms -= Date.now() - left.current.since;
    }
    holds.current.add(why);
  };
  const release = (id: number, why: string) => {
    if (!holds.current.delete(why) || holds.current.size) return;
    run(id, Math.max(left.current.ms, AFTER_PAUSE_MS));
  };

  // Undo is last in the tab order and gone in a few seconds, so Ctrl+Z / ⌘Z runs it from the keyboard
  // (except while typing, where it's the field's own undo).
  const undo = toast?.action?.label === 'Undo' ? toast.action : null;
  useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      undo.run();
      setToast(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Top of the screen on phones (clear of the action bar), bottom on larger screens. A grid with
          one cell, so a toast fading out sits under the next one instead of pushing it aside. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 grid justify-items-center px-4 pt-safe md:top-auto md:bottom-0 md:pt-0 md:pb-safe"
        aria-live="polite"
      >
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onPointerEnter={(e) => e.pointerType === 'mouse' && hold('hover')}
              onPointerLeave={(e) => e.pointerType === 'mouse' && release(toast.id, 'hover')}
              onFocus={() => hold('focus')}
              onBlur={() => release(toast.id, 'focus')}
              className="pointer-events-auto col-start-1 row-start-1 my-2 flex max-w-md items-center gap-4 rounded-2xl bg-raised py-3 pr-3 pl-4 text-sm shadow-2xl shadow-black/50 ring-1 ring-line"
            >
              <span className="text-fg">{toast.message}</span>
              {toast.action && (
                <button
                  className="press-dim grid min-h-11 shrink-0 place-items-center rounded-lg px-3 font-semibold text-indigo-300 transition hover:bg-white/5"
                  aria-keyshortcuts={toast.action === undo ? 'Control+Z Meta+Z' : undefined}
                  onClick={() => {
                    toast.action!.run();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
