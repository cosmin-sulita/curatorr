/** After this many wrong guesses in a row, a key gets one try per pause. */
const MAX_WRONG = 5;
const PAUSE_MS = 10 * 60 * 1000;

/**
 * Wrong guesses (PINs, passwords) per key since its last right one, so nobody can try them all
 * through Curatorr. Kept in memory: a restart forgives them.
 */
export class Guesses {
  private readonly wrong = new Map<string | number, { count: number; until: number }>();

  /** How long the key must wait before its next try, in words; null when it may try now. */
  wait(key: string | number): string | null {
    const tries = this.wrong.get(key);
    if (!tries || tries.until <= Date.now()) return null;
    const minutes = Math.ceil((tries.until - Date.now()) / 60_000);
    return minutes === 1 ? 'a minute' : `${minutes} minutes`;
  }

  miss(key: string | number) {
    const count = (this.wrong.get(key)?.count ?? 0) + 1;
    this.wrong.set(key, { count, until: count >= MAX_WRONG ? Date.now() + PAUSE_MS : 0 });
  }

  hit(key: string | number) {
    this.wrong.delete(key);
  }
}
