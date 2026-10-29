// Eligibility: what a given profile may be offered at all.
import type { SagaState } from './sagas.js';
import type { FeedbackEvent, MediaServer, Movie } from './types.js';

export interface ProfileContext {
  watched: Set<number>;
  feedback: FeedbackEvent[];
  /** Allowed certifications, or null for no restriction. */
  allowedCerts: Set<string> | null;
  /** Only offer movies found on this media server (so its Watch button works); null while matching isn't working. */
  requireServer: MediaServer | null;
  /** Movies the profile can open on the media server (Jellyfin: its library access and parental controls). */
  available?: Set<number> | null;
  includeWatched: boolean;
  /** Where the profile stands in each saga; blocked sequels aren't offered. */
  sagas?: SagaState;
}

/** Movies the profile is never offered: marked Seen it or Never, and what it watched unless watched movies may come up. */
export function excludedIds(ctx: Pick<ProfileContext, 'watched' | 'feedback' | 'includeWatched'>): Set<number> {
  const out = new Set<number>();
  for (const e of ctx.feedback) if (e.kind === 'seen' || e.kind === 'never') out.add(e.movieId);
  if (!ctx.includeWatched) for (const id of ctx.watched) out.add(id);
  return out;
}

/** Whether the profile's parental restrictions allow the movie. */
export function certAllowed(m: Movie, allowedCerts: Set<string> | null) {
  return !allowedCerts || (Boolean(m.certification) && allowedCerts.has(m.certification!.toUpperCase()));
}

/** Whether the library sync found the movie on the media server. */
export function onServer(m: Movie, server: MediaServer): boolean {
  return Boolean(server === 'plex' ? m.plexRatingKey : m.jellyfinId);
}

/** Whether the profile's limits allow the movie: its parental restrictions, and what it can open on the media server. */
export function allowedFor(m: Movie, ctx: Pick<ProfileContext, 'allowedCerts' | 'available'>) {
  return (!ctx.available || ctx.available.has(m.id)) && certAllowed(m, ctx.allowedCerts);
}

export function eligibleMovies(movies: Movie[], ctx: ProfileContext): Movie[] {
  const excluded = excludedIds(ctx);
  return movies.filter((m) => {
    if (excluded.has(m.id)) return false;
    if (ctx.sagas?.blockedBy.has(m.id)) return false;
    if (ctx.requireServer && !onServer(m, ctx.requireServer)) return false;
    return allowedFor(m, ctx);
  });
}
