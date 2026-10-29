import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import {
  JellyfinClient,
  jellyfinAuthorization,
  jellyfinLink,
  jellyfinRestriction,
  supportedJellyfin,
  toJellyfinItem,
  toJellyfinUser,
} from './jellyfin.js';
import {
  PLEX_HOSTS,
  PlexServerClient,
  connectionCandidates,
  getWatchlist,
  parseGuids,
  plexDefaultAvatar,
  plexLinks,
  toPlexItem,
} from './plex.js';
import { assignSagas, fromRadarr, sagaTitle, tmdbSized } from './radarr.js';
import { matchRequests, type SeerrRequest } from './seerr.js';
import { fakeServer } from '../testing.js';

describe('parseGuids', () => {
  it('reads the modern Plex agent', () => {
    expect(parseGuids(['imdb://tt0133093', 'tmdb://603', 'tvdb://1234'])).toEqual({ tmdbId: 603, imdbId: 'tt0133093' });
  });

  it('reads legacy agents', () => {
    expect(parseGuids(['com.plexapp.agents.themoviedb://603?lang=en'])).toEqual({ tmdbId: 603, imdbId: null });
    expect(parseGuids(['com.plexapp.agents.imdb://tt0133093?lang=en'])).toEqual({ tmdbId: null, imdbId: 'tt0133093' });
  });

  it('ignores plex:// guids', () => {
    expect(parseGuids(['plex://movie/5d7768', null, undefined])).toEqual({ tmdbId: null, imdbId: null });
  });
});

describe('plexDefaultAvatar', () => {
  const gravatar = 'https://secure.gravatar.com/avatar/bbb5ce66';

  it('keeps uploaded photos', () => {
    expect(plexDefaultAvatar('https://assets.plex.tv/avatars/3d9a6449.?1771108800')).toBe('own');
  });

  it("probes Gravatar when Plex's letter avatar is the fallback", () => {
    const location = `${gravatar}?d=https%3A%2F%2Fplex.tv%2Favatars%2FC6B299%2F41%2F3&s=80`;
    expect(plexDefaultAvatar(location)).toBe(`${gravatar}?d=404&s=80`);
  });

  it('keeps Gravatars with any other fallback', () => {
    expect(plexDefaultAvatar(`${gravatar}?d=identicon&s=80`)).toBe('own');
    expect(plexDefaultAvatar(`${gravatar}?s=80`)).toBe('own');
  });

  it("spots Plex's letter avatar served directly", () => {
    expect(plexDefaultAvatar('https://plex.tv/avatars/F18052/41/3')).toBe('default');
  });

  it('keeps the thumb when there is no usable redirect', () => {
    expect(plexDefaultAvatar('')).toBe('own');
    expect(plexDefaultAvatar('not a url')).toBe('own');
  });
});

describe('toPlexItem', () => {
  it('maps PMS metadata', () => {
    const item = toPlexItem({
      ratingKey: 42,
      title: 'The Matrix',
      year: 1999,
      viewCount: 2,
      lastViewedAt: 1700000000,
      slug: 'the-matrix',
      guid: 'plex://movie/abc',
      Guid: [{ id: 'imdb://tt0133093' }, { id: 'tmdb://603' }],
    });
    expect(item).toEqual({
      ratingKey: '42',
      title: 'The Matrix',
      year: 1999,
      viewCount: 2,
      lastViewedAt: 1700000000000,
      slug: 'the-matrix',
      plexGuid: 'abc',
      tmdbId: 603,
      imdbId: 'tt0133093',
    });
  });

  it('has no slug or Plex guid for legacy agents', () => {
    const item = toPlexItem({ ratingKey: 1, title: 'Alien', guid: 'com.plexapp.agents.imdb://tt0078748' });
    expect(item.slug).toBeNull();
    expect(item.plexGuid).toBeNull();
  });
});

describe('plexLinks', () => {
  it('sends phones to watch.plex.tv when the movie has a slug', () => {
    const links = plexLinks('abc123', '42', 'godzilla-2014');
    expect(links.web).toBe('https://app.plex.tv/desktop/#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F42');
    expect(links.app).toBe('https://watch.plex.tv/movie/godzilla-2014');
  });

  it('falls back to the plex:// deep link without a slug', () => {
    for (const slug of [null, '', undefined]) {
      expect(plexLinks('abc123', '42', slug).app).toBe(
        'plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F42&metadataType=1&server=abc123',
      );
    }
  });
});

describe('connectionCandidates', () => {
  it('prefers a plain local http URL, then plex.direct, then relay', () => {
    const urls = connectionCandidates({
      name: 'NAS',
      machineId: 'abc',
      accessToken: 't',
      owned: true,
      connections: [
        { uri: 'https://1-2-3-4.abc.plex.direct:32400', address: '1.2.3.4', port: 32400, protocol: 'https', local: false, relay: false },
        { uri: 'https://relay.plex.direct:8443', address: 'relay', port: 8443, protocol: 'https', local: false, relay: true },
        { uri: 'https://192-168-1-10.abc.plex.direct:32400', address: '192.168.1.10', port: 32400, protocol: 'https', local: true, relay: false },
      ],
    }).map((c) => c.url);
    expect(urls).toEqual([
      'http://192.168.1.10:32400',
      'https://192-168-1-10.abc.plex.direct:32400',
      'https://1-2-3-4.abc.plex.direct:32400',
      'https://relay.plex.direct:8443',
    ]);
  });
});

describe('assignSagas', () => {
  const matrix = (id: number, tmdbId: number, year: number) =>
    fromRadarr({ id, title: `Matrix ${id}`, year, tmdbId, hasFile: true, collection: { title: 'The Matrix Collection', tmdbId: 2344 } });
  const collection = {
    tmdbId: 2344,
    title: 'The Matrix Collection',
    movies: [
      { tmdbId: 624860, title: 'The Matrix Resurrections', year: 2021 },
      { tmdbId: 605, title: 'The Matrix Revolutions', year: 2003 },
      { tmdbId: 604, title: 'The Matrix Reloaded', year: 2003 },
      { tmdbId: 603, title: 'The Matrix', year: 1999 },
      { tmdbId: 999999, title: 'The Matrix 5', year: 0 }, // announced, no date yet
    ],
  };

  it('numbers parts in release order, counting parts you do not own', () => {
    const owned = [matrix(1, 604, 2003), matrix(2, 605, 2003)];
    assignSagas(owned, [collection]);
    expect(owned.map((m) => m.saga)).toEqual([
      { id: 2344, title: 'The Matrix', part: 2, parts: 5 },
      { id: 2344, title: 'The Matrix', part: 3, parts: 5 },
    ]);
  });

  it('numbers owned parts by year without collection data', () => {
    const owned = [matrix(1, 605, 2003), matrix(2, 603, 1999)];
    assignSagas(owned, null);
    expect(owned.map((m) => [m.saga!.part, m.saga!.parts])).toEqual([
      [2, 2],
      [1, 2],
    ]);
    expect(owned[0]!.saga!.title).toBe('The Matrix');
  });

  it('leaves movies outside collections alone', () => {
    const solo = fromRadarr({ id: 9, title: 'Heat', tmdbId: 949, hasFile: true });
    assignSagas([solo], [collection]);
    expect(solo.saga).toBeNull();
  });

  it('drops the word Collection from titles', () => {
    expect(sagaTitle('The Lord of the Rings Collection')).toBe('The Lord of the Rings');
    expect(sagaTitle('Collection')).toBe('Collection');
  });
});

describe('fromRadarr', () => {
  it('maps ratings, art and tags', () => {
    const movie = fromRadarr({
      id: 7,
      title: 'Zombieland',
      year: 2009,
      overview: 'Survivors road-trip across a zombie-infested America.',
      runtime: 88,
      certification: 'R',
      genres: ['Comedy', 'Horror'],
      keywords: ['Zombie', 'Road Trip', 'Survival'],
      tmdbId: 19908,
      imdbId: 'tt1156398',
      hasFile: true,
      youTubeTrailerId: 'abc',
      images: [
        { coverType: 'poster', url: '/MediaCover/7/poster.jpg', remoteUrl: 'https://image.tmdb.org/t/p/original/p.jpg' },
        { coverType: 'fanart', url: '/MediaCover/7/fanart.jpg' },
      ],
      ratings: { rottenTomatoes: { value: 90, votes: 0 }, imdb: { value: 7.6, votes: 600000 }, tmdb: { value: 0 } },
    });
    expect(movie.ratings).toEqual({ rt: 90, imdb: 7.6, tmdb: null, metacritic: null });
    expect(movie.posterUrl).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
    expect(movie.fanartUrl).toBe('/api/image/7/fanart');
    expect(movie.keywords).toEqual(['zombie', 'road trip', 'survival']);
    expect(movie.themes).toHaveProperty('zombies');
    expect(movie.themes).toHaveProperty('road-trip');
    expect(movie.moods).not.toHaveProperty('light'); // horror is never "light"
  });

  it('dates the arrival from the file Radarr imported, not from when it added the movie', () => {
    const requested = { id: 8, title: 'Heat', hasFile: true, added: '2025-11-01T00:00:00Z' };
    const movie = fromRadarr({ ...requested, movieFile: { dateAdded: '2026-03-02T08:00:00Z' } });
    expect(movie.addedAt).toBe('2025-11-01T00:00:00Z');
    expect(movie.arrivedAt).toBe('2026-03-02T08:00:00.000Z');
    expect(fromRadarr(requested).arrivedAt).toBeNull();
    expect(fromRadarr({ ...requested, movieFile: { dateAdded: '0001-01-01T00:00:00Z' } }).arrivedAt).toBeNull();
  });

  it('resizes TMDB urls only', () => {
    expect(tmdbSized('https://image.tmdb.org/t/p/original/x.jpg', 'w342')).toBe('https://image.tmdb.org/t/p/w342/x.jpg');
    expect(tmdbSized(undefined, 'w342')).toBeNull();
  });
});

describe('jellyfinAuthorization', () => {
  it('names Curatorr and carries the token in the one header Jellyfin 12 still reads', () => {
    expect(jellyfinAuthorization('device-1', 'secret')).toBe(
      `MediaBrowser Client="Curatorr", Device="Curatorr", DeviceId="device-1", Version="${config.version}", Token="secret"`,
    );
  });

  it('leaves the token out before signing in, and keeps quotes out of the values', () => {
    const header = jellyfinAuthorization('a "b"');
    expect(header).not.toContain('Token');
    expect(header).toContain('DeviceId="a%20%22b%22"');
  });
});

describe('toJellyfinItem', () => {
  it("maps a movie's provider ids and the person's marks", () => {
    const item = toJellyfinItem({
      Id: 'f1a2',
      Name: 'The Matrix',
      ProviderIds: { Tmdb: '603', Imdb: 'tt0133093' },
      UserData: { Played: true, LastPlayedDate: '2026-03-02T20:15:30.1234567Z', IsFavorite: true },
    });
    expect(item).toEqual({
      id: 'f1a2',
      title: 'The Matrix',
      tmdbId: 603,
      imdbId: 'tt0133093',
      played: true,
      lastPlayedAt: Date.UTC(2026, 2, 2, 20, 15, 30, 123),
      favorite: true,
    });
  });

  it('reads provider ids in any case, and a movie nobody marked', () => {
    const item = toJellyfinItem({ Id: 'x', Name: 'Alien', ProviderIds: { tmdb: '348', IMDB: 'tt0078748' } });
    expect(item).toMatchObject({ tmdbId: 348, imdbId: 'tt0078748', played: false, lastPlayedAt: null, favorite: false });
  });
});

describe('toJellyfinUser', () => {
  it('maps the policy Curatorr uses', () => {
    const user = toJellyfinUser({
      Id: 'abcd',
      Name: 'Kid',
      PrimaryImageTag: 'tag1',
      LastLoginDate: '2026-10-23T04:45:30.7774529Z',
      Policy: {
        IsAdministrator: false,
        IsDisabled: false,
        MaxParentalRating: 10,
        LoginAttemptsBeforeLockout: 5,
        InvalidLoginAttemptCount: 2,
      },
    });
    expect(user).toEqual({
      id: 'abcd',
      name: 'Kid',
      admin: false,
      disabled: false,
      maxParentalRating: 10,
      imageTag: 'tag1',
      lastLoginAt: Date.UTC(2026, 9, 23, 4, 45, 30, 777),
      lockoutAfter: 5,
      wrongPasswords: 2,
    });
  });

  it('reads a user without a policy or a picture as an unrestricted member', () => {
    expect(toJellyfinUser({ Id: 'x', Name: 'New' })).toEqual({
      id: 'x',
      name: 'New',
      admin: false,
      disabled: false,
      maxParentalRating: null,
      imageTag: null,
      lastLoginAt: null,
      lockoutAfter: null,
      wrongPasswords: 0,
    });
  });

  it('reads the lockout as Jellyfin 12.2 applies it: -1 never, 0 after three wrong passwords, N after N', () => {
    const after = (setting: unknown) => toJellyfinUser({ Id: 'x', Policy: { LoginAttemptsBeforeLockout: setting } }).lockoutAfter;
    expect([-1, 0, 1, 3, 5, null, '5'].map(after)).toEqual([null, 3, 1, 3, 5, null, null]);
  });
});

describe('jellyfinRestriction', () => {
  it("maps Jellyfin's age limit to the nearest Curatorr limit at or below it", () => {
    expect([0, 7, 10, 12, 13, 16, 17, 18, null].map((age) => jellyfinRestriction(age, false))).toEqual([
      'little_kid',
      'little_kid',
      'older_kid',
      'older_kid',
      'teen',
      'teen',
      null,
      null,
      null,
    ]);
  });

  it('never restricts an administrator', () => {
    expect(jellyfinRestriction(10, true)).toBeNull();
  });
});

describe('jellyfinLink', () => {
  it("opens the movie's page in Jellyfin's web app, under a base path too", () => {
    expect(jellyfinLink('https://media.example.com/jellyfin', 'srv1', 'item1')).toBe(
      'https://media.example.com/jellyfin/web/#/details?id=item1&serverId=srv1',
    );
  });
});

describe('supportedJellyfin', () => {
  it('takes 10.9 and later, including 12', () => {
    expect(['10.8.13', '10.9.0', '10.10.7', '10.11.5', '12.0.1', 'unknown'].map(supportedJellyfin)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('matchRequests', () => {
  const movies = [
    { id: 1, tmdbId: 603 },
    { id: 2, tmdbId: 949 },
  ];
  const request = (id: number, tmdbId: number, by: number): SeerrRequest => ({
    id,
    status: 2,
    type: 'movie',
    media: { tmdbId },
    requestedBy: { id: by },
  });

  it('pairs requests with Jellyfin profiles, however Seerr writes the user id', () => {
    const profiles = [{ id: 10, plex_user_id: null, jellyfin_user_id: '4f1e0a2b3c4d5e6f7a8b9c0d1e2f3a4b' }];
    const users = [{ id: 7, jellyfinUserId: '4F1E0A2B-3C4D-5E6F-7A8B-9C0D1E2F3A4B' }];
    expect(matchRequests(profiles, movies, users, [request(1, 603, 7)])).toEqual([
      { profileId: 10, movieId: 1, requestedAt: null },
    ]);
  });

  it('still pairs Plex accounts by their Plex id', () => {
    const profiles = [{ id: 11, plex_user_id: 5001, jellyfin_user_id: null }];
    expect(matchRequests(profiles, movies, [{ id: 8, plexId: 5001 }], [request(2, 949, 8)])).toEqual([
      { profileId: 11, movieId: 2, requestedAt: null },
    ]);
  });
});

describe('an address that answers, but not as the server asked for', () => {
  it('says so, instead of failing on what it sent', async () => {
    const other = await fakeServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    try {
      await expect(new PlexServerClient(other.base, 'client', 'token').identity()).rejects.toThrow(/not as a Plex server/);
      await expect(new JellyfinClient(other.base, 'device').authenticate('Dad', 'pass')).rejects.toThrow(/without a session/);
    } finally {
      await other.close();
    }
  });
});

describe('reading a Plex Watchlist', () => {
  it("fails rather than stopping short of the end, which would look like movies taken off it", async () => {
    let reads = 0;
    const discover = await fakeServer((_req, res) => {
      reads++;
      const Metadata = Array.from({ length: 100 }, (_, i) => ({ guid: `plex://movie/${reads}-${i}` }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ MediaContainer: { totalSize: 20_000, Metadata } }));
    });
    const before = PLEX_HOSTS.discover;
    PLEX_HOSTS.discover = discover.base;
    try {
      await expect(getWatchlist('client', 'token')).rejects.toThrow(/more than 10000 movies/);
      expect(reads).toBe(100);
    } finally {
      PLEX_HOSTS.discover = before;
      await discover.close();
    }
  });
});
