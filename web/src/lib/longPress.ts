import { useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a finger rests on something before its menu opens, as on an iPhone. */
const HOLD_MS = 450;
/** A finger that moves this far is scrolling, not holding. */
const SLOP_PX = 10;

/**
 * Holding a finger on an element opens its menu (`open`, with the element), and the tap that ends the hold does
 * nothing else. A right click or the keyboard's menu key opens it too, through the browser's own `contextmenu`, which
 * Android also sends on a long press. Spread the returned handlers on the element:
 *
 *   const hold = useLongPress();
 *   <button {...hold((el) => openMenu(el))} onClick={…} />
 */
export function useLongPress() {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // The press opened the menu, so its click is swallowed.
  const opened = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return (open: (el: HTMLElement) => void) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      opened.current = false;
      // Mice have a right button for this.
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget;
      start.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        start.current = null;
        opened.current = true;
        open(el);
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    // The browser took the touch over to scroll.
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      if (opened.current) return;
      // Android's long press: its tap ends the hold. A right click or the menu key sends no click to swallow.
      opened.current = start.current !== null;
      cancel();
      open(e.currentTarget);
    },
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (!opened.current) return;
      opened.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });
}
