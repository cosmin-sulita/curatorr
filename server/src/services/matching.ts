// Finding a Radarr movie among a media server's items, by TMDB id and then IMDb id.

interface Ids {
  tmdbId: number | null;
  imdbId: string | null;
}

/** A media server's items by TMDB and IMDb id, to find the one for each Radarr movie. */
export interface IdIndex<T> {
  byTmdb: Map<number, T>;
  byImdb: Map<string, T>;
}

export function indexByIds<T extends Ids>(items: T[]): IdIndex<T> {
  const byTmdb = new Map<number, T>();
  const byImdb = new Map<string, T>();
  for (const item of items) {
    if (item.tmdbId != null) byTmdb.set(item.tmdbId, item);
    if (item.imdbId) byImdb.set(item.imdbId, item);
  }
  return { byTmdb, byImdb };
}

export function findByIds<T>(index: IdIndex<T>, m: Ids): T | undefined {
  return (m.tmdbId != null ? index.byTmdb.get(m.tmdbId) : undefined) ?? (m.imdbId ? index.byImdb.get(m.imdbId) : undefined);
}
