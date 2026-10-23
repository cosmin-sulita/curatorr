/** After this many wrong guesses in a row, a key gets one try per pause. */
const MAX_WRONG = 5;
const PAUSE_MS = 10 * 60 * 1000;

/**
 * Wrong guesses (PINs, passwords) per key since its last right one, so nobody can try them all
 * through Curatorr. A try counts as wrong from the moment it's taken, before plex.tv or Jellyfin
 * checks it, so tries sent all at once can't all get through. Kept in memory: a restart forgives them.
 */
export class Guesses {
  private readonly wrong = new Map<string | number, { count: number; until: number }>();

  /**
   * Takes a try for the key, counted as wrong until `hit` says it was right. Null when it may go
   * ahead; otherwise how long the key must wait, in words.
   */
  take(key: string | number): string | null {
    const now = Date.now();
    const tries = this.wrong.get(key);
    if (tries && tries.until > now) {
      const minutes = Math.ceil((tries.until - now) / 60_000);
      return minutes === 1 ? 'a minute' : `${minutes} minutes`;
    }
    const count = (tries?.count ?? 0) + 1;
    this.wrong.set(key, { count, until: count >= MAX_WRONG ? now + PAUSE_MS : 0 });
    return null;
  }

  /** The try was right: the key starts afresh. */
  hit(key: string | number) {
    this.wrong.delete(key);
  }

  /**
   * The try couldn't be checked (the server didn't answer), so it doesn't count. A try only goes ahead
   * while the key isn't paused, so a pause the key is in now began with it, or after it: it ends too.
   */
  refund(key: string | number) {
    const tries = this.wrong.get(key);
    if (!tries) return;
    if (tries.count <= 1) this.wrong.delete(key);
    else this.wrong.set(key, { count: tries.count - 1, until: 0 });
  }
}
