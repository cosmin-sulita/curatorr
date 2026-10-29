import type { Pick } from '@curatorr/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * The picks on screen, in order: the first is the pick, the rest "Other good picks". It's the screen's own list once
 * loaded, so passing on picks doesn't refetch; new picks from the server replace it.
 */
export function usePickQueue(picks: Pick[] | undefined) {
  // Picks loaded before the screen opened show on its first frame.
  const [queue, setQueue] = useState<Pick[] | null>(() => picks ?? null);
  useEffect(() => setQueue(picks ?? null), [picks]);
  /** Set when a pick goes back in front, so the rail can scroll back to its start (see PickScreen). */
  const restored = useRef(false);

  return {
    queue,
    current: queue?.[0],
    rest: queue?.slice(1) ?? [],
    restored,
    /** Takes `pick` out, and answers how to put it back where it was (Undo, or a mark that failed). */
    take(pick: Pick) {
      const at = Math.max(0, queue?.findIndex((p) => p.movie.id === pick.movie.id) ?? 0);
      setQueue((q) => q?.filter((p) => p.movie.id !== pick.movie.id) ?? null);
      return () => {
        if (at === 0) restored.current = true;
        setQueue((q) => (q ? [...q.slice(0, at), pick, ...q.slice(at)] : [pick]));
      };
    },
    /** Shows `pick` in place of the one for the same movie. */
    replace(pick: Pick) {
      setQueue((q) => q && q.map((x) => (x.movie.id === pick.movie.id ? pick : x)));
    },
    /** A pick from "Other good picks" becomes the pick, and the pick takes its place at the end. */
    bringForward(pick: Pick) {
      setQueue((q) => (q && q[0] ? [pick, ...q.slice(1).filter((p) => p !== pick), q[0]] : q));
    },
    /** A fresh list, as after "Look again". */
    reset(picks: Pick[]) {
      setQueue(picks);
    },
  };
}

export type PickQueue = ReturnType<typeof usePickQueue>;
