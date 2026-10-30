import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotionConfig } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../lib/modal';
import { Img } from './ui';

export interface MenuAction {
  key: string;
  label: string;
  Icon: LucideIcon;
  run: () => void;
  /** Red, as iPhone menus show what hides or removes. */
  danger?: boolean;
}

/** The screen's safe areas (the status bar, the home indicator), which JavaScript can only read through CSS. */
function safeInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
  probe.remove();
  return insets;
}

const WIDTH = 248;
const TITLE = 40;
const ROW = 48;
const GAP = 12;
const EDGE = 16;

/**
 * The menu of a poster held down, as on an iPhone: the poster lifts where it is, the screen behind dims, and the menu
 * opens beside it, under it when there's room and on its side of the screen. A tap outside or Escape closes it.
 * Rendered into the body, so it sits above the screen whatever renders it.
 *
 * Choosing an item closes the menu, and `onChoose` hands its action back: the caller runs it once the menu is gone
 * (AnimatePresence's onExitComplete), as an iPhone menu does, and the page can scroll again by then.
 */
export function PosterMenu({
  anchor,
  src,
  title,
  actions,
  onChoose,
  onClose,
}: {
  /** Where the poster is on screen. */
  anchor: DOMRect;
  src: string | null;
  title: string;
  actions: MenuAction[];
  onChoose: (action: MenuAction) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useModal(menu, onClose);
  const reduce = useReducedMotionConfig();
  // The finger that held the poster is still down as the menu opens: lifting it mustn't close the menu.
  const [armed, setArmed] = useState(false);
  // The menu itself takes focus, so no item wears a keyboard ring; Tab or an arrow key goes on to the items.
  useEffect(() => menu.current?.focus({ preventScroll: true }), []);

  /** The arrow keys, Home and End move between the items, as in any menu. */
  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    // -1 while the menu itself has focus: down goes to the first item, up to the last.
    const at = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: Math.max(at, 0) - 1, Home: 0, End: -1 };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    items.at(to % items.length)?.focus();
  };

  // Where everything goes: the poster moves fully into view (it may sit behind the bottom bar, or past an edge), and
  // the menu opens under it, or over it, or the poster moves up until both fit, as an iPhone does.
  const [layout] = useState(() => {
    const insets = safeInsets();
    const min = insets.top + EDGE;
    const max = window.innerHeight - insets.bottom - EDGE;
    const height = TITLE + actions.length * ROW;
    let poster = Math.min(Math.max(anchor.top, min), max - anchor.height);
    let top: number;
    let below = true;
    if (poster + anchor.height + GAP + height <= max) top = poster + anchor.height + GAP;
    else if (poster - GAP - height >= min) {
      top = poster - GAP - height;
      below = false;
    } else {
      poster = Math.max(min, max - height - GAP - anchor.height);
      top = poster + anchor.height + GAP;
    }
    return { poster, top, below };
  });
  const { top, below } = layout;
  const onLeft = anchor.left + anchor.width / 2 < window.innerWidth / 2;
  const left = onLeft ? Math.max(EDGE, anchor.left) : Math.min(window.innerWidth - EDGE - WIDTH, anchor.right - WIDTH);
  const spring = { type: 'spring', stiffness: 420, damping: 32 } as const;
  // Closing is quick, since the chosen action waits for it.
  const leave = { duration: 0.15 };

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: leave }}
      transition={{ duration: 0.2 }}
      onPointerDown={() => setArmed(true)}
      onClick={() => armed && onClose()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <motion.div
        className="absolute overflow-hidden rounded-xl shadow-2xl shadow-black/70 ring-1 ring-white/10"
        style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
        initial={{ scale: 1, y: 0 }}
        animate={{ scale: reduce ? 1 : 1.06, y: layout.poster - anchor.top }}
        exit={{ scale: 1, y: 0, transition: leave }}
        transition={spring}
        aria-hidden
      >
        <Img src={src} className="size-full object-cover" />
      </motion.div>
      <motion.div
        ref={menu}
        role="menu"
        aria-label={title}
        tabIndex={-1}
        className="absolute overflow-hidden rounded-2xl focus:outline-none bg-raised shadow-2xl shadow-black/60 ring-1 ring-line"
        style={{ left, top, width: WIDTH, transformOrigin: `${onLeft ? 'left' : 'right'} ${below ? 'top' : 'bottom'}` }}
        initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: reduce ? 1 : 0.8, transition: leave }}
        transition={spring}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={moveFocus}
      >
        <p className="flex h-10 items-center truncate px-4 text-[13px] text-muted">{title}</p>
        <div className="divide-y divide-line border-t border-line">
          {actions.map((action) => (
            <button
              key={action.key}
              role="menuitem"
              onClick={() => onChoose(action)}
              className={clsx(
                'flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] transition',
                // A row lights up the moment a finger lands, as in an iPhone menu.
                'hover:bg-white/5 focus-visible:outline-offset-[-2px] active:bg-white/10 active:duration-0',
                action.danger ? 'text-red-300' : 'text-fg',
              )}
            >
              {action.label}
              <action.Icon className="size-5 shrink-0" aria-hidden />
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
