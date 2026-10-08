/** Tag strengths keyed by theme/mood id. Higher means a stronger signal. */
export type TagScores = Record<string, number>;

export interface Ratings {
  /** Rotten Tomatoes tomatometer, 0-100. */
  rt: number | null;
  rtVotes: number | null;
  /** IMDb user rating, 0-10. */
  imdb: number | null;
  /** TMDB user rating, 0-10. */
  tmdb: number | null;
  /** Metacritic metascore, 0-100. */
  metacritic: number | null;
}

/** A movie as stored by Curatorr (synced from Radarr). */
export interface Movie {
  id: number; // Radarr movie id
  tmdbId: number | null;
  imdbId: string | null;
  title: string;
  year: number | null;
  overview: string;
  runtime: number | null; // minutes
  certification: string | null;
  genres: string[];
  keywords: string[];
  themes: TagScores;
  moods: TagScores;
  ratings: Ratings;
  posterUrl: string | null;
  fanartUrl: string | null;
  trailerId: string | null;
  plexRatingKey: string | null;
  /** watch.plex.tv slug: null = not looked up yet, '' = Plex has none (legacy agent). */
  plexSlug: string | null;
  addedAt: string | null;
}

export type FeedbackKind = 'shown' | 'skipped' | 'seen' | 'never' | 'accepted';

export interface FeedbackEvent {
  movieId: number;
  kind: FeedbackKind;
  createdAt: number; // epoch ms
}

export type RestrictionProfile = 'little_kid' | 'older_kid' | 'teen' | null;

export interface Profile {
  id: number;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  restrictionProfile: RestrictionProfile;
  pinProtected: boolean;
  /** True once Curatorr holds a Plex token for this profile. */
  linked: boolean;
}

/** Answers collected by the wizard. `null`/undefined means "any". */
export interface Criteria {
  genre?: string | null;
  theme?: string | null;
  mood?: string | null;
  time?: string | null;
}

export type WizardStep = 'genre' | 'theme' | 'mood' | 'time';

export interface WizardOption {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  count: number;
  /** Backdrop/poster URLs used to decorate the option card. */
  images: string[];
  color?: string;
}

export interface WizardOptionsResponse {
  step: WizardStep;
  /** Number of eligible movies matching the criteria so far. */
  total: number;
  options: WizardOption[];
  /** True when the step would not narrow anything down and should be skipped. */
  skip: boolean;
}

export interface Reason {
  kind: 'genre' | 'theme' | 'mood' | 'time' | 'rating';
  label: string;
}

export interface Pick {
  movie: MovieDTO;
  score: number;
  closeMatch: boolean;
  reasons: Reason[];
}

export interface RecommendationsResponse {
  total: number;
  picks: Pick[];
}

/** Movie shape sent to the browser. */
export interface MovieDTO {
  id: number;
  title: string;
  year: number | null;
  overview: string;
  runtime: number | null;
  certification: string | null;
  genres: string[];
  ratings: Ratings;
  posterUrl: string | null;
  fanartUrl: string | null;
  trailerId: string | null;
  plexUrl: string | null;
  plexAppUrl: string | null;
  imdbId: string | null;
  tmdbId: number | null;
}

export interface AppStatus {
  version: string;
  setupComplete: boolean;
  demo: boolean;
  plexConfigured: boolean;
  isAdmin: boolean;
  profile: Profile | null;
  library: { movies: number; lastSync: number | null; syncing: boolean; lastError: string | null };
}
