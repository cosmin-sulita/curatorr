import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { CROSS_ORIGIN, isCached, retryWithoutCors } from '../../components/ui';

/** Full-bleed backdrop, crossfading between picks (Seerr's detail-page treatment). */
export function Backdrop({ src }: { src: string | null }) {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <AnimatePresence initial={false}>{src && <BackdropImage key={src} src={src} />}</AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/85 to-ink md:from-ink/30 md:via-ink/75" />
      <div className="absolute inset-0 hidden bg-gradient-to-r from-ink via-ink/75 to-transparent md:block" />
      {/* Keeps the header readable when the fanart is bright. */}
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-ink/80 to-transparent md:h-40 md:from-ink/90" />
    </div>
  );
}

/** Fades in once it has loaded (at once when it already has), so a slow backdrop eases in instead of popping in. */
function BackdropImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(() => isCached(src));
  return (
    <motion.img
      src={src}
      alt=""
      crossOrigin={CROSS_ORIGIN}
      onError={(e) => retryWithoutCors(e.currentTarget)}
      initial={{ opacity: 0 }}
      animate={{ opacity: loaded ? 1 : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      onLoad={() => setLoaded(true)}
      className="absolute inset-0 h-[75vh] w-full object-cover [mask-image:linear-gradient(to_bottom,black_55%,transparent)] md:h-full md:[mask-image:none]"
    />
  );
}
