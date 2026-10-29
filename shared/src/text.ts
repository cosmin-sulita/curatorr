// How text is compared, wherever it's compared: TMDB keywords, and titles searched for.

/** A keyword as everything compares it: lowercase and trimmed. TMDB sometimes writes "human‑animal" with a
 * non-breaking hyphen. */
export function normalizeKeyword(keyword: string) {
  return keyword.toLowerCase().trim().replace(/[‐‑]/g, '-');
}

/** Lower case and without accents, so "amelie" finds Amélie: for searching titles. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
