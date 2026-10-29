import type { STEP_ORDER } from './taxonomy.js';

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

/** What the profile did with a pick. `later` is the Watchlist button's internal name. */
export const FEEDBACK_KINDS = ['shown', 'skipped', 'seen', 'never', 'accepted', 'later'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The marks: kept until undone, listed in Settings, and saved for whoever the "For whom?" sheet names. */
export const MARK_KINDS = ['seen', 'never', 'later'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const isMark = (kind: FeedbackKind): kind is MarkKind => (MARK_KINDS as readonly string[]).includes(kind);

export interface FeedbackEvent {
  movieId: number;
  kind: FeedbackKind;
  createdAt: number; // epoch ms
  /** Curatorr made the mark on the media server too, e.g. "Seen it" marked the movie watched there at this moment. */
  serverSynced?: boolean;
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

export type WizardStep = (typeof STEP_ORDER)[number];

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
  /** Who among those picking has the movie on their watchlist (profile ids, in the group's order). */
  onWatchlistOf: number[];
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

/** A movie on one of the profile's lists in Settings, with all they show of it. */
export interface ListedMovie {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
}

export interface AppStatus {
  version: string;
  /** A newer release on GitHub. Only admins are told, since they're the ones who can update. */
  update: { version: string; url: string } | null;
  setupComplete: boolean;
  demo: boolean;
  /** The media server Curatorr uses, or is being set up with. */
  server: MediaServer | null;
  isAdmin: boolean;
  profile: Profile | null;
  /** Who is watching with `profile` tonight; empty when it's on its own. */
  together: Profile[];
  library: { movies: number; lastSync: number | null; syncing: boolean; lastError: string | null };
  /**
   * When tonight's picks end: the next 4 am turnover, by the server's clock and time zone, when picks reshuffle and
   * groups end. The app goes by this rather than the phone's own 4 am, which may be in another time zone.
   */
  turnover: number;
}

// ---- What the API answers, besides the above. The server's handlers declare these, so a change on either side
// fails the typecheck instead of the app.

/**
 * What a mark did on the media server: changed it, it already matched, nothing to do (no media server, syncing off),
 * or the server couldn't be reached.
 */
export type ServerSyncResult = 'synced' | 'already' | 'skipped' | 'failed';

/** POST /api/feedback: the rows saved, one per person (`id` is the first), and what the media server did. */
export interface FeedbackResponse {
  id: number;
  ids: number[];
  server?: ServerSyncResult;
}

/** DELETE /api/feedback/:id. `server` only for a mark, when the media server had to be changed back. */
export interface UndoResponse {
  ok: true;
  server?: ServerSyncResult;
}

/** DELETE /api/watchlist/:movieId: what the media server did, and who among those watching still has it there. */
export interface WatchlistRemoval {
  server: ServerSyncResult;
  onWatchlistOf: number[];
}

/**
 * GET /api/hidden: a movie on one of the profile's lists. `id` is its mark's, for Restore. A movie that's only on the
 * media server's watchlist has no mark, so no `id`; its `createdAt` is when Curatorr first saw it there, if it knows.
 */
export type HiddenMovie =
  | { id: number; kind: MarkKind; createdAt: number; movie: ListedMovie }
  | { id: null; kind: 'later'; createdAt: number | null; movie: ListedMovie };

/** GET /api/profiles. `locked`: the profile has a PIN this device hasn't entered yet. */
export interface ProfileChoice extends Profile {
  locked: boolean;
}

/** Profiles as Settings and the user import list them. `serverUser`: it stands for a user on the media server. */
export interface ImportedProfile extends Profile {
  hidden: boolean;
}
export interface SettingsProfile extends ImportedProfile {
  serverUser: boolean;
}

/** GET /api/settings: everything Settings shows an administrator, and never a token or API key. */
export interface SettingsResponse {
  /** The media server Curatorr uses, or is being set up with. */
  server: MediaServer | null;
  radarr: { url: string; hasApiKey: boolean } | null;
  /** The last read of Seerr: requested movies in the library, for how many profiles. */
  seerr: {
    url: string;
    hasApiKey: boolean;
    at: number | null;
    requests: number;
    profiles: number;
    error: string | null;
  } | null;
  plex: {
    signedIn: boolean;
    ownerName: string | null;
    serverName: string | null;
    serverUrl: string | null;
    machineId: string | null;
    sectionIds: string[];
  };
  jellyfin: {
    url: string;
    /** Where Watch on Jellyfin goes, when that's another address. */
    publicUrl: string | null;
    serverName: string;
    ownerName: string;
    libraryIds: string[];
  } | null;
  app: { includeWatched: boolean; syncIntervalHours: number; syncToServer: boolean; boostRequests: boolean };
  sync: { at: number | null; movies: number; matched: number; error: string | null; syncing: boolean };
  /** Radarr's webhook: the secret in its address, and when Radarr last called, with what. */
  webhook: { token: string; at: number | null; event: string | null; title: string | null };
  profiles: SettingsProfile[];
}

/** A Plex or Jellyfin library that can hold movies. */
export interface ServerLibrary {
  key: string;
  title: string;
}

/** Setting up Plex or Jellyfin: the libraries found on the server just chosen. */
export interface ServerLibraries {
  ok: true;
  libraries: ServerLibrary[];
}

/** GET /api/setup/plex/servers: a Plex server the owner can use, and how each of its addresses answered. */
export interface PlexServerOption {
  name: string;
  machineId: string;
  connections: { url: string; local: boolean; relay: boolean; ok: boolean; ms: number | null }[];
}

/** POST /api/plex/pin: a Plex sign-in started on this device. */
export interface PlexPinStarted {
  id: number;
  code: string;
  authUrl: string;
}

/** POST /api/plex/pin/:id/claim: still waiting for plex.tv, or signed in, and as whom. */
export interface PlexPinClaim {
  status: 'pending' | 'ok';
  account?: { name: string; thumb: string | null };
}

/** What an error answer can carry besides its message, which the app acts on. */
export interface ErrorFlags {
  /** The profile (`profileId`, when watching together) asks for its PIN. */
  needPin?: boolean;
  profileId?: number;
  /** Pick a profile first: the device has none, or it's gone. */
  needProfile?: boolean;
  needSetup?: boolean;
  /** Only an administrator signed in on this device may do this. */
  needAdmin?: boolean;
}

/** How often Settings offers to sync with Radarr, in hours. The server takes no other value. */
export const SYNC_INTERVAL_HOURS = [1, 3, 6, 12, 24] as const;
