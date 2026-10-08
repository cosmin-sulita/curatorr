import { useEffect } from 'react';

/** Keeps the page behind a dialog from scrolling while the dialog is mounted. */
export function useScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);
}
