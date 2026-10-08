import { describe, expect, it } from 'vitest';
import { connectionCandidates, parseGuids, plexDefaultAvatar, plexLinks, toPlexItem } from './plex.js';
import { assignSagas, fromRadarr, sagaTitle, tmdbSized } from './radarr.js';

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
    expect(movie.ratings).toEqual({ rt: 90, rtVotes: null, imdb: 7.6, tmdb: null, metacritic: null });
    expect(movie.posterUrl).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
    expect(movie.fanartUrl).toBe('/api/image/7/fanart');
    expect(movie.keywords).toEqual(['zombie', 'road trip', 'survival']);
    expect(movie.themes).toHaveProperty('zombies');
    expect(movie.themes).toHaveProperty('road-trip');
    expect(movie.moods).not.toHaveProperty('light'); // horror is never "light"
  });

  it('resizes TMDB urls only', () => {
    expect(tmdbSized('https://image.tmdb.org/t/p/original/x.jpg', 'w342')).toBe('https://image.tmdb.org/t/p/w342/x.jpg');
    expect(tmdbSized(undefined, 'w342')).toBeNull();
  });
});
