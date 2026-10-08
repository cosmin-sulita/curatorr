<p align="center"><img src="web/public/logo.svg" width="72" alt=""></p>

# Curatorr

**What should we watch tonight?** Curatorr asks a few quick questions (genre, theme, mood, how much time you have) and then suggests the best movie *you already own*, using your Radarr library. Picks rank by Rotten Tomatoes score. Turn one down and the next is already waiting.

It's a self-hosted, installable PWA built for the *arr stack, with a look borrowed from Seerr.

- **Radarr is the source of truth.** Only downloaded movies are suggested. Genres, TMDB keywords, ratings, posters and trailers all come from Radarr, so no extra API keys are needed.
- **Plex Home profiles.** Each person picks their profile and never gets suggestions for movies they already watched in Plex. Plex parental restrictions carry over.
- **Smart questions.** The wizard only offers answers that match at least three movies in your library, and skips questions that wouldn't narrow anything down.
- **Ranked by the Tomatometer.** IMDb and TMDB scores are used as fallbacks when there's no RT score.
- **Not tonight / Seen it / Never.** Swipe or tap. "Not tonight" lowers a movie for two weeks; "Seen it" and "Never" hide it until you restore it in Settings.
- **Watch on Plex** opens the movie straight in the Plex app on phones, or Plex Web on desktop.

## Install on a UGREEN NAS (UGOS)

1. Create a folder for Curatorr's data, e.g. `/volume1/docker/curatorr`.
2. In UGOS open **Docker → Project → Create**, name it `curatorr`, and paste [`docker-compose.yml`](docker-compose.yml):

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
         - /volume1/docker/curatorr:/config
   ```

   Set `PUID`/`PGID` to the user that owns the data folder (SSH into the NAS and run `id`).
3. Deploy, then open `http://<nas-ip>:7979` and follow the setup:
   1. **Radarr**: its address (e.g. `http://192.168.1.10:7878`) and API key (Radarr → Settings → General → Security).
   2. **Plex**: sign in with the account that owns the server, pick the server and its movie libraries. Plex Home users are imported as profiles.
   3. **Finish**: the library syncs right away, then every 6 hours (configurable).

To update, pull the new image in UGOS (or `docker compose pull && docker compose up -d`). Everything Curatorr stores is in `/config`.

### HTTPS and installing the app

Browsers only install a PWA over HTTPS. Put Curatorr behind your reverse proxy (Nginx Proxy Manager, Caddy, Traefik, Cloudflare Tunnel…) and point it at `http://<nas-ip>:7979`. For Caddy:

```
curatorr.example.com {
    reverse_proxy 192.168.1.10:7979
}
```

Then open the HTTPS address on your phone and choose **Add to Home Screen** (iOS Safari) or **Install app** (Android Chrome).

> **Exposing it to the internet?** Anyone who can reach Curatorr can pick a profile and browse your library. Settings are protected (only the Plex server owner can change them), but if the address is public, add your proxy's authentication or keep it on your LAN / VPN.

## How picks work

1. **Eligible movies**: downloaded in Radarr, found in Plex, not watched by this profile, not marked "Seen it"/"Never", and allowed by the profile's Plex restrictions.
2. **Tags**: on every sync each movie gets *themes* (Superheroes, Supernatural, Heists & Cons, Time Travel… around 40) and *moods* (Light & Fun, Feel-Good, Edge of Your Seat, Dark & Heavy, Mind-Bending, Something Epic). They come from its genres and TMDB keywords, with the plot as a fallback when keywords are sparse. The vocabulary lives in [`shared/src/taxonomy.ts`](shared/src/taxonomy.ts) and is easy to extend.
3. **Score**: Rotten Tomatoes % (IMDb ×10 − 5 or TMDB ×10 − 8 when RT is missing) + up to 8 points for how strongly the theme/mood matches − 15 if you passed on it in the last two weeks − 5 if it was shown in the last three days. A small daily shuffle keeps near-ties from always landing on the same movie.
4. **Close matches**: if fewer than six movies match every answer, the list is topped up with movies that match the genre plus the theme *or* the mood, clearly labelled.

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
```

The repo is an npm workspace:

- `shared/`: types, the theme/mood taxonomy, tagging and ranking (pure functions, unit tested)
- `server/`: Fastify API, Radarr and Plex clients, SQLite storage, library sync
- `web/`: React + Vite + Tailwind PWA

## Publishing the image

The GitHub Actions workflow in [`.github/workflows/docker.yml`](.github/workflows/docker.yml) tests every push. On `main` and `v*` tags it also builds a `linux/amd64` + `linux/arm64` image and pushes it to `ghcr.io/<owner>/curatorr`. After the first run, open the package on GitHub and set its visibility to **Public**, or run `docker login ghcr.io` on the NAS.

To build locally instead: `docker build -t curatorr .`

---

Curatorr isn't affiliated with Radarr, Plex, Seerr or Rotten Tomatoes. Ratings are the ones Radarr provides.
