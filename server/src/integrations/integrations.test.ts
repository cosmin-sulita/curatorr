import { describe, expect, it } from 'vitest';
import { connectionCandidates, parseGuids, plexLinks, toPlexItem } from './plex.js';
import { fromRadarr, tmdbSized } from './radarr.js';

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
