import type { Profile } from '@curatorr/shared';
import clsx from 'clsx';
import { Delete } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { useDialogFocus } from '../lib/dialogFocus';
import { useScrollLock } from '../lib/scrollLock';
import { Avatar, Button, Spinner } from './ui';

/**
 * Four digits for a profile: entering its PIN on "Who's watching?", or choosing one in Settings. It sends the PIN
 * once the fourth digit is in. Render it outside `<Shell>`, like every fixed overlay.
 */
export function PinPad({
  profile,
  title,
  subtitle,
  error,
  busy,
  footer,
  onSubmit,
  onCancel,
}: {
  profile: Pick<Profile, 'name' | 'avatarUrl'>;
  title: string;
  subtitle: string;
  error: string | null;
  busy: boolean;
  /** Under the keys, e.g. Settings' "Remove the PIN". */
  footer?: ReactNode;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useScrollLock();
  useDialogFocus(dialog);

  const press = (digit: string) => {
    if (busy) return;
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      onSubmit(next);
      setPin('');
    }
  };

  return (
    <motion.div
      ref={dialog}
      className="fixed inset-0 z-40 grid touch-none place-items-center bg-ink/85 px-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (/^\d$/.test(e.key)) press(e.key);
        if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="flex w-full max-w-xs flex-col items-center">
        <Avatar name={profile.name} src={profile.avatarUrl} className="size-20" />
        <h2 className="mt-4 text-center text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>
        <div className="mt-6 flex gap-3" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={clsx('size-3.5 rounded-full transition', i < pin.length ? 'bg-fg' : 'bg-raised ring-1 ring-line')} />
          ))}
        </div>
        {/* One fixed-height line for checking and errors, so neither moves the pad. */}
        <p className="mt-3 flex h-5 items-center text-sm text-red-300" role="alert">
          {busy ? <Spinner className="size-5" /> : error}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <PadKey key={d} onClick={() => press(d)} autoFocus={d === '1'}>
              {d}
            </PadKey>
          ))}
          <Button variant="ghost" className="h-16" onClick={onCancel}>
            Cancel
          </Button>
          <PadKey onClick={() => press('0')}>0</PadKey>
          <button
            className="grid h-16 place-items-center rounded-2xl text-muted hover:bg-white/5"
            onClick={() => setPin((p) => p.slice(0, -1))}
            aria-label="Delete digit"
          >
            <Delete className="size-6" />
          </button>
        </div>
        {footer && <div className="mt-4">{footer}</div>}
      </div>
    </motion.div>
  );
}

function PadKey({ children, onClick, autoFocus }: { children: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button
      autoFocus={autoFocus}
      onClick={onClick}
      className="grid h-16 w-20 place-items-center rounded-2xl bg-surface text-2xl font-semibold tabular-nums ring-1 ring-line transition hover:bg-raised active:scale-95"
    >
      {children}
    </button>
  );
}
