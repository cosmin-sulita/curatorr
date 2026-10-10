# Contributing to Curatorr

Bug reports, ideas and pull requests are welcome. For anything bigger than a small fix, please open an issue first, so we can agree on the approach before you spend time on it.

## Development setup

You need Node 22.13 or newer, since Curatorr uses the built-in `node:sqlite`. Docker isn't needed for development.

```sh
npm install
npm run dev:demo   # API on :7979 with a demo library, UI on http://localhost:5173
npm run dev        # the same against your real Radarr and Plex or Jellyfin; setup runs on first start
```

The demo library has about 95 movies and three profiles (Alex, Sam and Kids). In demo mode everyone counts as the admin and no profile has a PIN. `npm run dev` keeps its database in `config/`, which git ignores.

```sh
npm test           # vitest, for shared/ and server/ (there's no web test suite)
npm run typecheck  # tsc on shared, server and web
npm run build      # web/dist, then server/dist
npm run icons      # regenerates the committed icons from web/public/logo.svg and app-icon.svg
```

The repo is an npm workspace:

- `shared/`: types, the theme and mood vocabulary, tagging and ranking. Pure functions, unit tested, used by both sides.
- `server/`: the Fastify API, the Radarr, Plex, Jellyfin and Seerr clients, SQLite storage and the library sync.
- `web/`: the React + Vite + Tailwind PWA.

[CLAUDE.md](CLAUDE.md) maps the code in more detail and records the reasons behind its less obvious decisions. It's written for AI coding agents, but it works for people too.

## Before you open a pull request

- `npm run typecheck` and `npm test` pass. CI runs both on every pull request.
- New behaviour in `shared/` or `server/` comes with tests. When you fix a mis-tagged movie, add it to `shared/src/tagger.fixtures.ts`.
- Database changes go in a new migration at the end of the list in `server/src/db.ts`. Never edit an old one.
- UI changes work on a phone (390×844) and on a desktop (1440×900), and touch targets stay at least 44pt. The demo library is the quickest way to check.
- There's no linter or formatter, so match the surrounding code: 2-space indent, single quotes, lines up to about 120 characters, and sparse comments that explain why.
- If you change how picks are scored, update "How picks work" in the README as well, since it quotes the numbers.

## Branches and commits

- Branch from `develop` and open pull requests against it. `main` only moves when a release is made.
- Commit subjects are [Conventional Commits](https://www.conventionalcommits.org/) with a scope naming the area: `type(scope): summary`, e.g. `fix(picks): keep the desktop buttons together`. Add a short body saying why.
- `feat`, `fix` and `perf` subjects are shown to people in the app's What's new, so write them as plain sentences about what changed for them. `chore`, `ci`, `docs`, `refactor` and `test` only appear in the changelog.

## Tuning tags and ranking against a real library

The demo library's keywords are tidy, and real TMDB keywords aren't. To tune the vocabulary or the ranking against your own library, copy `curatorr.db` (with its `-wal` and `-shm` files) from Curatorr's config folder into `config/`. The database holds your Plex or Jellyfin tokens, so never commit or share it. Both reports only read it.

- `npm run tags` shows how the theme and mood vocabulary fits: coverage, untagged movies, keywords nothing matches, and terms found inside longer keywords (idiom candidates), compared with the tags the server last stored. `-- --movie <title>` explains one movie's tags, and `-- --tag <id>` lists what a theme or mood gains and loses.
- `npm run eval` replays the library's watch history through the working copy's ranking. Each watch is ranked with the library and history as they were that evening, for the questions the wizard offered then, separately for movies that had just arrived and for the backlog. It also simulates evenings of ignored picks, to show how quickly the first pick rotates. It never reads the settings table.

Measure a ranking change rather than tuning it by feel: save a run with `npm run eval -- --save run.json` before the change, then compare with `npm run eval -- --compare run.json` after it.

## Releases

For maintainers:

1. On `develop`, add a section at the top of [CHANGELOG.md](CHANGELOG.md): a `## x.y.z (YYYY-MM-DD)` heading, then one bullet per commit since the last release, newest first, in the form `- fix(picks): keep the desktop buttons together ([8f2ad71](https://github.com/cosmin-sulita/curatorr/commit/8f2ad71))`. `git log vPREV..HEAD --format='%h %s'` lists them. A paragraph under the heading is shown as the release's intro in What's new. Commit it as `Release x.y.z`.
2. Fast-forward `main` to `develop` and push both.

The heading is the app's version, and CI does the rest. It tags `vx.y.z`, publishes the section as a GitHub Release, and pushes the image to `ghcr.io/cosmin-sulita/curatorr` as `x.y.z`, `x.y` and `latest`. Bump the minor version when there's a new feature, and the patch version for fixes only.
