import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);

  const show = useCallback((t: ToastInput) => {
    window.clearTimeout(timer.current);
    const id = ++counter.current;
    setToast({ ...t, id });
    timer.current = window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), t.duration ?? 5000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Top of the screen on phones (clear of the action bar), bottom on larger screens. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-safe md:top-auto md:bottom-0 md:pt-0 md:pb-safe"
        aria-live="polite"
      >
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="pointer-events-auto my-2 flex max-w-md items-center gap-4 rounded-2xl bg-raised py-3 pr-3 pl-4 text-sm shadow-2xl shadow-black/50 ring-1 ring-line"
            >
              <span className="text-fg">{toast.message}</span>
              {toast.action && (
                <button
                  className="grid min-h-11 shrink-0 place-items-center rounded-lg px-3 font-semibold text-indigo-300 hover:bg-white/5"
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
