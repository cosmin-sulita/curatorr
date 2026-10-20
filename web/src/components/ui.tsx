import type { BlobatarOptions } from 'blobatar';
import { blobatarUri } from 'blobatar/uri';
import clsx from 'clsx';
import { LoaderCircle } from 'lucide-react';
import { useState, type ButtonHTMLAttributes, type ImgHTMLAttributes, type ReactNode } from 'react';

/** `selected`: a toggle that's on, like the Watchlist button on a pick that's already on the watchlist. */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'selected';
type Size = 'sm' | 'md' | 'lg';

/** Button styling, shared with links that look like buttons. */
export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition select-none',
    'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
    size === 'sm' && 'h-9 px-3 text-sm',
    size === 'md' && 'h-11 px-4 text-[15px]',
    size === 'lg' && 'h-14 px-6 text-base',
    variant === 'primary' && 'bg-accent-gradient text-white shadow-lg shadow-accent/25 hover:brightness-110',
    variant === 'secondary' && 'bg-raised text-fg ring-1 ring-line hover:bg-[#2a3150]',
    variant === 'ghost' && 'text-muted hover:bg-white/5 hover:text-fg',
    variant === 'danger' && 'bg-red-500/10 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/20',
    variant === 'selected' && 'bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/40 hover:bg-indigo-500/25',
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <LoaderCircle role="status" aria-label="Loading" className={clsx('animate-spin text-muted', className ?? 'size-6')} />
  );
}

/** Over something tapped whose screen takes a moment to open, like the avatar's on "Who's watching?". */
export function Pending({ className = 'rounded-2xl' }: { className?: string }) {
  return (
    <span className={clsx('absolute inset-0 grid place-items-center bg-ink/60', className)}>
      <Spinner className="size-7 text-white" />
    </span>
  );
}

/** How soon a picture is wanted: for a screen that's opening, or ahead of a tap that may never come. */
export type Priority = 'high' | 'low';

/** Every picture loads through here, the way the screens load it, so what's loaded ahead is what they show. */
function loadImage(src: string, priority?: Priority) {
  const img = new Image();
  if (priority) img.fetchPriority = priority;
  img.src = src;
  return img;
}

/** True when the browser already holds this image (it completes at once), so it needn't fade in. */
export function isCached(src: string | null | undefined) {
  if (!src) return false;
  const probe = loadImage(src);
  return probe.complete && probe.naturalWidth > 0;
}

/** Loads and decodes images ahead of showing them. Done when they all are, or after `capMs` at the latest. */
export function preloadImages(urls: (string | null | undefined)[], capMs: number) {
  const all = Promise.all(urls.flatMap((src) => (src ? [loadImage(src, 'high').decode().catch(() => {})] : [])));
  return Promise.race([all, new Promise((resolve) => setTimeout(resolve, capMs))]);
}

/**
 * Starts loading pictures without waiting for them, so a screen that shows them later has them at once. Those wanted
 * for a screen that's opening are decoded too, so they paint on its first frame.
 */
export function warmImages(urls: (string | null | undefined)[], priority: Priority) {
  for (const src of urls) {
    if (!src) continue;
    const img = loadImage(src, priority);
    if (priority === 'high') img.decode().catch(() => {});
  }
}

/** An image that fades in when loaded and degrades to a tinted block when missing. */
export function Img({
  src,
  className,
  alt = '',
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src?: string | null }) {
  // Starting out loaded means a preloaded or just-shown image appears at once instead of fading in.
  const [loaded, setLoaded] = useState(() => isCached(src));
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={clsx('bg-raised', className)} aria-hidden />;
  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={clsx('bg-raised transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0', className)}
    />
  );
}

/**
 * A square plate, since Avatar already clips it round and a circle inside the clip leaves a halo. One tone and
 * four friendly shapes for everyone; the name still picks the hue, the shape among those four and the rest.
 */
const BLOBATAR_OPTIONS: BlobatarOptions = {
  background: 'square',
  traits: { shape: [0.11, 0.35, 0.54, 0.933], tone: 0.71 },
};

export function Avatar({ name, src, className }: { name: string; src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={clsx('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full', className)}>
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        // No photo: a blobatar seeded by the name, the same creature on every device.
        <img src={blobatarUri(name, BLOBATAR_OPTIONS)} alt="" aria-hidden className="size-full" />
      )}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/** 16px text: iOS zooms the page in on a field with smaller text. */
export const inputClass =
  'h-11 w-full rounded-xl bg-ink px-3.5 text-base text-fg ring-1 ring-line placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent';

export function Notice({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'rounded-xl px-3.5 py-2.5 text-sm',
        tone === 'error' ? 'bg-red-500/10 text-red-300 ring-1 ring-red-500/25' : 'bg-accent/10 text-indigo-200 ring-1 ring-accent/25',
      )}
    >
      {children}
    </p>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        // The ::before box makes the tap area 64×44 without changing how the switch looks.
        "relative h-7 w-12 shrink-0 rounded-full transition before:absolute before:-inset-2 before:content-['']",
        // Off, the track keeps a visible edge (3:1), or the knob alone doesn't show which side it's on.
        checked ? 'bg-accent-gradient' : 'bg-raised ring-1 ring-white/35',
      )}
    >
      <span
        className={clsx('absolute top-1 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')}
      />
    </button>
  );
}
