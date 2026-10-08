import {
  RESTRICTION_CERTS,
  eligibleMovies,
  rankMovies,
  wizardOptions,
  type Criteria,
  type MovieDTO,
  type ProfileContext,
  type RecommendationsResponse,
  type WizardOptionsResponse,
  type WizardStep,
} from '@curatorr/shared';
import { plexLinks } from '../integrations/plex.js';
import type { ProfileRow, StoredMovie, Store } from '../store.js';

export function profileContext(store: Store, row: ProfileRow): ProfileContext {
  const restriction = row.restriction_profile as keyof typeof RESTRICTION_CERTS | null;
  const movies = store.movies();
  // Only insist on a Plex match when matching is actually working.
  const requirePlex = store.plexConfigured() && movies.some((m) => m.plexRatingKey);
  return {
    watched: store.watchedIds(row.id),
    feedback: store.feedback(row.id),
    allowedCerts: restriction && RESTRICTION_CERTS[restriction] ? new Set(RESTRICTION_CERTS[restriction]) : null,
    requirePlex,
    includeWatched: store.get('app').includeWatched,
  };
}

export function toDTO(store: Store, m: StoredMovie): MovieDTO {
  const plex = store.get('plex');
  const links = m.plexRatingKey && plex.machineId ? plexLinks(plex.machineId, m.plexRatingKey) : null;
  return {
    id: m.id,
    title: m.title,
    year: m.year,
    overview: m.overview,
    runtime: m.runtime,
    certification: m.certification,
    genres: m.genres,
    ratings: m.ratings,
    posterUrl: m.posterUrl,
    fanartUrl: m.fanartUrl,
    trailerId: m.trailerId,
    plexUrl: links?.web ?? null,
    plexAppUrl: links?.app ?? null,
    imdbId: m.imdbId,
    tmdbId: m.tmdbId,
  };
}

export function optionsFor(store: Store, row: ProfileRow, step: WizardStep, criteria: Criteria): WizardOptionsResponse {
  const eligible = eligibleMovies(store.movies(), profileContext(store, row));
  return wizardOptions(eligible, step, criteria, {
    image: (m, kind) => (kind === 'fanart' ? (m.fanartUrl ?? m.posterUrl) : (m.posterUrl ?? m.fanartUrl)),
  });
}

export function recommendFor(store: Store, row: ProfileRow, criteria: Criteria): RecommendationsResponse {
  const ctx = profileContext(store, row);
  const eligible = eligibleMovies(store.movies(), ctx);
  const ranked = rankMovies(eligible, criteria, ctx.feedback, { now: Date.now(), seed: String(row.id) });
  return {
    total: ranked.filter((r) => r.tier === 0).length,
    picks: ranked.map((r) => ({
      movie: toDTO(store, r.movie as StoredMovie),
      score: r.score,
      closeMatch: r.tier > 0,
      reasons: r.reasons,
    })),
  };
}
