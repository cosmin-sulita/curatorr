import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What every dialog and menu over the screen does while it's mounted: the page behind doesn't scroll, keyboard focus
 * stays inside `root` and goes back to whatever had it (the button that opened it) once it's gone, and Escape closes
 * it wherever focus is (a right click leaves focus on the poster).
 */
export function useModal(root: RefObject<HTMLElement | null>, onClose: () => void) {
  useScrollLock();
  useFocusTrap(root);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

function useScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);
}

function useFocusTrap(dialog: RefObject<HTMLElement | null>) {
  // Read while rendering, before the dialog's autoFocus moves focus into it.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  // A layout effect, so focus is back on the opener in the same update that removes the dialog.
  useLayoutEffect(() => {
    const trap = (e: KeyboardEvent) => {
      const root = dialog.current;
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      if (opener?.isConnected) opener.focus();
    };
  }, [dialog, opener]);
}
