import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useModal } from '../lib/modal';

/**
 * A dialog over the whole screen, fading in and out (render it in an AnimatePresence, outside `<Shell>`, like every
 * fixed overlay). `className` lays out and dims the backdrop; the dialog's own box is in `children`.
 */
export function Dialog({
  label,
  labelledBy,
  onClose,
  closeOnBackdrop = false,
  focusSelf = false,
  onKeyDown,
  className,
  children,
}: {
  /** Its name for screen readers, or the id of the heading that names it. */
  label?: string;
  labelledBy?: string;
  /** Escape, and a tap on the backdrop with `closeOnBackdrop`. */
  onClose: () => void;
  closeOnBackdrop?: boolean;
  /**
   * Focus goes to the dialog rather than a button in it: for one that opens on its own, where a focused button would
   * wear its keyboard ring before anyone has touched the app. Tab still leads to the buttons.
   */
  focusSelf?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useModal(root, onClose);
  useEffect(() => {
    if (focusSelf) root.current?.focus({ preventScroll: true });
  }, [focusSelf]);

  return (
    <motion.div
      ref={root}
      tabIndex={focusSelf ? -1 : undefined}
      className={clsx('fixed inset-0 z-40 focus:outline-none', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      onClick={closeOnBackdrop ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      {children}
    </motion.div>
  );
}
