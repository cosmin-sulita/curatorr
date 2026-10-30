/**
 * What this device remembers between visits (localStorage). Blocked storage throws instead: a read then finds nothing
 * and a write is lost, which every use here can live with (each says what that costs).
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Lost: see above.
  }
}
