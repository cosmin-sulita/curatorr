<p align="center"><img src="web/public/logo.svg" width="72" alt=""></p>

# Curatorr

**What should we watch tonight?** Curatorr asks a few quick questions (genre, theme, mood, how much time you have) and then suggests the best movie *you already own*, using your Radarr library. Picks rank by Rotten Tomatoes score. Turn one down and the next is already waiting.

It's a self-hosted, installable PWA built for the *arr stack, with a look borrowed from Seerr.

- **Radarr is the source of truth.** Only downloaded movies are suggested. Genres, TMDB keywords, ratings, posters and trailers all come from Radarr, so no extra API keys are needed.
- **Plex Home profiles.** Each person picks their profile and never gets suggestions for movies they already watched in Plex. Plex parental restrictions carry over.
- **Smart questions.** The wizard only offers answers that match at least three movies in your library, and skips questions that wouldn't narrow anything down. Or tap **Surprise me** to skip the questions and get a pick right away.
- **Something like…** Start from a movie you loved (what you watched lately is listed first, or search the library) and get the unwatched movies that share the most keywords and themes with it.
- **Ranked by the Tomatometer.** IMDb and TMDB scores are used as fallbacks when there's no RT score.
- **Not tonight / Watchlist / Seen it / Never.** Swipe or tap, and undo any of them. "Not tonight" lowers a movie for two weeks. "Watchlist" saves it and ranks it higher next time. "Seen it" and "Never" hide it until you restore it in Settings.
- **Sagas in order.** A sequel only comes up once its earlier part is watched; until then Curatorr suggests part 1 instead. Once a saga is started, the next part ranks higher. On a long night, "Start a saga" suggests part 1 of the best collections you haven't started. Only parts you own count, and big franchises (over 10 films, like James Bond) count as standalone movies.
- **Stays in sync with Plex.** "Seen it" marks the movie watched in Plex for that person, and "Watchlist" adds it to their Plex Watchlist. Undo puts things back. Movies on someone's Plex Watchlist, even ones added in another Plex app, rank higher for them. The server owner can turn this off in Settings.
- **Remembers what you asked for.** Connect Seerr in Settings and the movies each person requested, once downloaded and while still unwatched, rank higher for them and are labelled "You requested this". Requests are matched to profiles by Plex account. The server owner can turn this off in Settings.
- **Watch on Plex** opens the movie's page in the Plex app on phones, where your server is listed as a place to play it. On desktop it goes straight to the movie in Plex Web. The app link needs libraries that use the **Plex Movie** agent; older agents fall back to opening the Plex app.

## Install with Docker

Curatorr runs as a single container (`linux/amd64` and `linux/arm64`) on any Docker host.

1. Create a folder of its own for Curatorr, e.g. `/srv/curatorr`, and run the commands below from inside it. Curatorr keeps its data in that folder.
2. Save [`docker-compose.yml`](docker-compose.yml) there and start it with `docker compose up -d`:

   ```yaml
   services:
     curatorr:
       image: ghcr.io/YOUR_GITHUB_USER/curatorr:latest
       container_name: curatorr
       restart: unless-stopped
       ports:
         - "7979:7979"
       environment:
         - TZ=Etc/UTC   # your time zone, e.g. Europe/Berlin
         - PUID=1000
         - PGID=1000
       volumes:
         - ./:/config
   ```

   Or with plain Docker:

   ```sh
   docker run -d --name curatorr --restart unless-stopped -p 7979:7979 \
     -e TZ=Etc/UTC -e PUID=1000 -e PGID=1000 \
     -v ./:/config \
     ghcr.io/YOUR_GITHUB_USER/curatorr:latest
   ```

   Set `PUID`/`PGID` to the user that owns the data folder (run `id` on the host).
3. Open `http://<host-ip>:7979` and follow the setup:
   1. **Radarr**: its address (e.g. `http://192.168.1.10:7878`) and API key (Radarr → Settings → General → Security).
   2. **Plex**: sign in with the account that owns the server, pick the server and its movie libraries. Plex Home users are imported as profiles.
   3. **Finish**: the library syncs right away, then every 6 hours (configurable).

To update, run `docker compose pull && docker compose up -d`. Everything Curatorr stores is in `/config`. Phones and browsers that already have the app open switch to the new version the next time it comes back to the foreground, or straight away from the **Update** button in the header.

### HTTPS and installing the app

Browsers only install a PWA over HTTPS. Put Curatorr behind your reverse proxy (Nginx Proxy Manager, Caddy, Traefik, Cloudflare Tunnel…) and point it at `http://<host-ip>:7979`. For Caddy:

```
curatorr.example.com {
    reverse_proxy 192.168.1.10:7979
}
```

Then open the HTTPS address on your phone and choose **Add to Home Screen** (iOS Safari) or **Install app** (Android Chrome).

> **Exposing it to the internet?** Anyone who can reach Curatorr can pick a profile and browse your library. Profiles with a Plex PIN ask for it once on each device. Settings are protected once you sign in with Plex during setup: from then on only the Plex server owner can change them. Without Plex there's no owner to sign in, so anyone who reaches Curatorr can change its settings. If the address is public, finish setup first, then add your proxy's authentication or keep it on your LAN / VPN.

## How picks work

1. **Eligible movies**: downloaded in Radarr, found in Plex, not watched by this profile, not marked "Seen it"/"Never", and allowed by the profile's Plex restrictions.
2. **Tags**: each movie gets *themes* (Superheroes, Heists & Cons, Time Travel, Prison & Escape, Family Ties… 43 in all) and *moods* (Light & Fun, Feel-Good, Edge of Your Seat, Dark & Heavy, Mind-Bending, Something Epic, Moving). They come from its genres and TMDB keywords, with the plot as a fallback when keywords are sparse or match nothing. Generic keywords (*army*, *computer*) and TMDB's tone words (*amused*, *hopeful*) only back up a stronger signal, and idioms don't count (*cat and mouse* isn't about cats). Tags are refreshed on every sync and whenever Curatorr starts. The vocabulary lives in [`shared/src/taxonomy.ts`](shared/src/taxonomy.ts); `npm run tags` shows how it fits your library (see Development).
3. **Score**: Rotten Tomatoes % (IMDb ×10 − 5 or TMDB ×10 − 8 when RT is missing) + up to 8 points for how strongly the theme/mood matches + 8 if they requested it in Seerr and haven't watched it yet, otherwise + 6 if it's on their watchlist − 15 if you passed on it in the last two weeks − 5 if it was shown between three hours and three days ago (so going back and answering the same way gives the same pick that evening). A small daily shuffle keeps near-ties from always landing on the same movie. It turns over at 4 am in the `TZ` you set, so it never changes mid-evening.
4. **Close matches**: if fewer than six movies match every answer, the list is topped up with other movies of that genre and length, clearly labelled: first those matching the theme *or* the mood, then the rest.
5. **Something like…**: eligible movies are compared with the one you loved by their TMDB keywords, themes, moods and genres. A rare keyword in common (*time loop*) counts for more than a common one. Likeness decides the order and the rating breaks near-ties. Skips, requests, the watchlist and the daily shuffle work as above. Other parts of the same saga are left out, and movies that only share a genre or a mood are labelled as loose matches.

## Configuration

Everything is set in the web UI. A few environment variables exist for special cases:

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `7979` | Port the server listens on |
| `CONFIG_DIR` | `/config` | Where the SQLite database lives |
| `PUID` / `PGID` | `1000` | User the app runs as |
| `TZ` | `UTC` | Time zone |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `CURATORR_DEMO` | unset | `1` runs a demo library with no Radarr or Plex |

## Development

Requires Node 22.13+ (uses the built-in `node:sqlite`).

```sh
npm install
npm run dev:demo   # API on :7979 with a demo library, UI on http://localhost:5173
npm run dev        # same, against your real Radarr/Plex (setup runs on first start)
npm test           # tagger, ranking, Plex matching and API tests
npm run typecheck
npm run build      # web/dist + server/dist
npm run tags       # how the theme/mood vocabulary fits a real library (see below)
npm run eval       # how well the ranking predicts what a real library's profiles watched
```

To tune the vocabulary against your own library, copy `curatorr.db` (with its `-wal` and `-shm` files) from Curatorr's config folder into `config/`, which git ignores. `npm run tags` then reports coverage, untagged movies, keywords nothing matches and terms found inside longer keywords, compared with the tags the server last stored. `-- --movie <title>` explains one movie's tags and `-- --tag <id>` lists what a theme or mood gains and loses. The database is only read.

`npm run eval` replays the same copy's Plex watch history through the working copy's ranking. Each watch is ranked with the library and history as they were that evening, for the questions the wizard offered then, separately for movies that had just arrived and for the backlog. It also simulates evenings of ignored picks, to show how quickly the first pick rotates. Save a run with `-- --save run.json` and compare a change with it, watch by watch, using `-- --compare run.json`. Again, the database is only read, and never its settings.

The repo is an npm workspace:

- `shared/`: types, the theme/mood taxonomy, tagging and ranking (pure functions, unit tested)
- `server/`: Fastify API, Radarr and Plex clients, SQLite storage, library sync
- `web/`: React + Vite + Tailwind PWA

## Publishing the image

The GitHub Actions workflow in [`.github/workflows/docker.yml`](.github/workflows/docker.yml) tests every push. On `main` and `v*` tags it also builds a `linux/amd64` + `linux/arm64` image and pushes it to `ghcr.io/<owner>/curatorr`. After the first run, either open the package on GitHub and set its visibility to **Public**, or keep it private and run `docker login ghcr.io` on the Docker host with a personal access token (classic) that has the `read:packages` scope.

To build locally instead: `docker build -t curatorr .`

---

Curatorr isn't affiliated with Radarr, Plex, Seerr or Rotten Tomatoes. Ratings are the ones Radarr provides.
