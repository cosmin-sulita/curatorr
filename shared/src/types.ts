/** Tag strengths keyed by theme/mood id. Higher means a stronger signal. */
export type TagScores = Record<string, number>;

export interface Ratings {
  /** Rotten Tomatoes tomatometer, 0-100. */
  rt: number | null;
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
  /** Plex metadata id from the item's `plex://movie/<id>` guid (same null/'' convention). */
  plexGuid: string | null;
  /** The movie's item id in Jellyfin. */
  jellyfinId: string | null;
  /** The Radarr/TMDB collection the movie belongs to, if any. */
  saga: Saga | null;
  /** When Radarr added the movie: for a request, often long before its release. */
  addedAt: string | null;
  /** When the movie's file arrived (Radarr imported it). The first one seen: an upgrade brings a new file. */
  arrivedAt: string | null;
}

/** A movie's place in its collection. Parts count every movie in it, owned or not, by release. */
export interface Saga {
  id: number; // TMDB collection id
  title: string;
  part: number;
  parts: number;
}

export type FeedbackKind = 'shown' | 'skipped' | 'seen' | 'never' | 'accepted' | 'later';

export interface FeedbackEvent {
  movieId: number;
  kind: FeedbackKind;
  createdAt: number; // epoch ms
}

export type RestrictionProfile = 'little_kid' | 'older_kid' | 'teen' | null;

/** The media server Curatorr reads profiles and watch history from, and opens picks in. */
export type MediaServer = 'plex' | 'jellyfin';

export interface Profile {
  id: number;
  name: string;
  /** Null when the person has no photo of their own; the UI draws a blobatar instead. */
  avatarUrl: string | null;
  isAdmin: boolean;
  restrictionProfile: RestrictionProfile;
  pinProtected: boolean;
  /** True once Curatorr can read this profile's watch history: with Plex, once it holds a token for it. */
  linked: boolean;
}

/** Answers collected by the wizard. `null`/undefined means "any". */
export interface Criteria {
  genre?: string | null;
  theme?: string | null;
  mood?: string | null;
  time?: string | null;
  /** A shortcut on the first question instead of the answers: what just arrived, or the season's movies. */
  shelf?: string | null;
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
  /** The first question's shortcuts, which go straight to a pick. */
  shelves?: WizardOption[];
}

export interface Reason {
  kind:
    | 'genre'
    | 'theme'
    | 'mood'
    | 'keyword'
    | 'time'
    | 'rating'
    | 'watchlist'
    | 'requested'
    | 'saga'
    | 'added'
    | 'taste'
    | 'season';
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
  /** "Something like…": the movie the picks resemble. */
  like?: { id: number; title: string };
}

/** A movie to start "Something like…" from. */
export interface LikeSeed {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  watched: boolean;
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
  /** Opens the movie on the media server, in a browser. */
  watchUrl: string | null;
  /** Opens the movie in the media server's phone apps, where they take links (Plex). */
  watchAppUrl: string | null;
  saga: Omit<Saga, 'id'> | null;
  imdbId: string | null;
  tmdbId: number | null;
}

export interface AppStatus {
  version: string;
  setupComplete: boolean;
  demo: boolean;
  /** The media server Curatorr uses, or is being set up with. */
  server: MediaServer | null;
  isAdmin: boolean;
  profile: Profile | null;
  library: { movies: number; lastSync: number | null; syncing: boolean; lastError: string | null };
}
