import { useLayoutEffect, useState, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a dialog while it's mounted, and gives it back to whatever had it
 * before (the button that opened the dialog) once it's gone.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>) {
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
