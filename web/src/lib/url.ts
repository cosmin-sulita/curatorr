/** Builds `path?query`, dropping empty values. */
export function withQuery(path: string, params: Record<string, string | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
