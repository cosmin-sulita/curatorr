# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Curatorr is a self-hosted PWA that answers "what should we watch tonight?" from a Radarr library, with Plex Home or Jellyfin profiles. A household opens it from a phone home screen, picks a profile, answers up to four questions (genre → theme → mood → time) and gets a matching movie ranked by rating, new arrivals and the profile's taste, with alternatives queued. README.md covers the features, install, env vars and how scoring works; CONTRIBUTING.md is the same workflow as below, written for people.

## Commands

Requires Node 22.13+, for the built-in `node:sqlite`. Docker and CI use Node 26. Keep `engines`, esbuild's `node22` target and the docs at 22.13 unless the floor is raised on purpose.

```sh
npm install
npm run dev:demo     # API on :7979 with a seeded demo library + Vite UI on :5173 (proxies /api)
npm run dev          # same against real Radarr and Plex or Jellyfin; first start runs setup
npm test             # vitest: shared/src/**/*.test.ts and server/src/**/*.test.ts only
npx vitest run shared/src/scoring.test.ts -t "penalises movies skipped"   # one file / one test
npm run typecheck    # tsc on shared, server and web in turn
npm run build        # web/dist (Vite + PWA) then server/dist (esbuild bundle)
npm run tags         # tagging report on config/curatorr.db; -- --movie <title> explains one, -- --tag <id> lists a tag
npm run eval         # ranking report on config/curatorr.db; -- --save <file> then -- --compare <file> measures a change
npm run icons        # regenerates the committed PWA icons from web/public/logo.svg and app-icon.svg
```

- **Built app:** run `CURATORR_DEMO=1 CONFIG_DIR=<tmp dir> PORT=7979 node --disable-warning=ExperimentalWarning server/dist/index.js`. The server serves `web/dist` and falls back to `index.html` for SPA routes.
- **Demo mode:** seeds `curatorr-demo.db` with about 95 movies and three profiles: Alex (owner, has started Back to the Future), Sam, and Kids (older_kid). A few files arrive days before each start (Alex's two requests reached Radarr a month earlier), and seeded watches are a week apart. In demo mode everyone counts as admin and no profile has a PIN.
- **Install scripts:** npm skips dependencies' install scripts unless `allowScripts` in the root `package.json` allows them. esbuild's is denied on purpose (it works without it). Approve a new one only after reviewing it, with `npm install-scripts approve <pkg>`.
- **Not configured:** there's no linter, no formatter and no web test suite. Match the surrounding style: 2-space indent, single quotes, lines up to about 120 characters, and sparse, explanatory comments.
- **CI** (`.github/workflows/ci.yml`) runs the typecheck, the tests and the build on pushes to `main` and `develop` and on pull requests. Everywhere but `main` it also builds the Docker image for both platforms without pushing it. On `main` it publishes releases (see below).

## Architecture

An npm workspace in three parts. `@curatorr/shared` is consumed as TypeScript source (no build step).

- **`shared/`**: pure, unit-tested logic used by both sides.
  - `taxonomy.ts`: the genre, theme, mood and time vocabulary, plus wizard constants (`STEP_ORDER`, `MIN_OPTION_COUNT = 3`).
  - `tagger.ts`: turns TMDB genres, keywords and overview into themes and moods. `explainTags` keeps the evidence behind each tag.
    - Each keyword counts once per tag, through its best term, and each term counts once.
    - Weak terms only back up a strong term, an implying genre or the plot (for moods: a genre lean, a strong term or the runtime bonus). TMDB's tone words (amused, hopeful…) are weak for Light & Fun and Feel-Good because they're noisy.
    - Per-tag `exclude` lists stop idioms ("cat and mouse" isn't Animals), and `overviewExclude` does the same for the plot ("haunted by his past" isn't Supernatural); some themes need two signals (`threshold: 3`).
    - `tagger.fixtures.ts` holds real movies with clear-cut expected tags. Keep it passing and add a case when you fix a mis-tag.
  - `scoring.ts`: `eligibleMovies`, `rankMovies` and `wizardOptions` (counts, images, and the `skip` rule for questions with no real choice). `rankMovies` starts from the quality score and adds:
    - the theme/mood bonus, taste points (`tastePoints`) and the new-arrival bonus (`arrivalTime`: the file's `arrivedAt`, else `addedAt`);
    - skip and showing penalties, the watchlist and request bonuses and the next-saga bonus;
    - a jitter seeded per profile per day.
    - For "Surprise me" (no answers, `isSurprise`), `surpriseOrder` then deals the ten best in an order drawn per profile per evening. `rankMovies` itself leaves `{}` in rank order; `recommendFor` and `npm run eval` apply the draw.
  - `taste.ts`: a profile's taste vector, summed from the `similar.ts` signatures of what it watched: media server watches and `accepted` count fully, `seen` 0.3, with a 60-day half-life. Confidence grows with history and is 0 without any. Only events before the day's 4 am turnover (`dayStart`) count, so an evening's picks don't move.
  - `similar.ts`: "Something like…". `rankSimilar` ranks eligible movies by cosine similarity to a liked movie (keywords weighted by rarity, plus themes, moods and genres). It reuses `personalAdjustment` from `scoring.ts`, but not taste.
  - `sagas.ts`: collection ordering.
  - `changelog.ts`: parses CHANGELOG.md for the What's new popup.
- **`server/`**: Fastify 5.
  - `app.ts` builds the app; tests use `buildApp({ configDir, demo: true, logger: false })` and `app.inject`.
  - Routes in `routes/` are `RouteModule`s that receive an `AppContext { store, library }`. Validate input with zod through `parse()` from `context.ts`, and throw `HttpError` for 4xx responses, which can carry flags like `needPin`, `needProfile` or `needSetup` that the client acts on.
  - `db.ts` holds the migrations: an append-only array applied via `PRAGMA user_version`. Never edit an old entry; add a new one.
  - `store.ts` wraps every query. App settings live as JSON in the `settings` table through `store.get(key)`, which fills missing keys from `defaults()`.
  - `services/library.ts` syncs Radarr → SQLite on a timer, re-tags movies and matches them to the media server's items by TMDB/IMDb id (`indexByIds`). `retag()` also runs at startup, so a vocabulary change applies without a sync.
    - **Radarr's webhook:** `routes/radarr.ts` takes it at `POST /api/radarr/webhook?token=…`, and the token in `radarrWebhook` settings stands in for a sign-in. Imports and deletions call `syncSoon()`, which syncs two minutes later, once Plex or Jellyfin has scanned the file; bursts make one sync.
    - **Retries:** the scheduler's 10-minute check (`syncDue`) also syncs again while a movie that arrived in the last hour isn't on the media server yet, since picks only offer what the server has.
  - `scripts/tags.ts` (`npm run tags`) and `scripts/eval.ts` (`npm run eval`) are read-only reports on a copy of a real database in `config/`. It holds Plex or Jellyfin tokens: never commit or upload it.
    - Real TMDB keywords are much messier than the demo library's, so tune the vocabulary against `npm run tags` (coverage, unmatched keywords, idiom candidates), not the demo.
    - `npm run eval` replays each watch with that evening's library, history and wizard questions, and reports MRR and hit@k for new arrivals and the backlog, plus a staleness simulation. It never reads `settings`. Measure ranking changes with `--save` and `--compare` rather than by feel.
  - `services/recommend.ts`: `profileData` reads what ranking needs from the store, and `picking` turns it into the context and `RankOptions`. `npm run eval` calls `picking` for earlier moments, so every ranking input must go through it.
  - **Media server:** Plex or Jellyfin, one at a time (`store.mediaServer()`). Setup asks which; connecting one lets the other go, and once setup is complete the other is refused (409). Settings can't switch.
    - `services/mediaServer.ts` dispatches the profile sync (`syncServerState`) and the marks (`applyMark`/`revertMark`, behind `app.syncToServer`) to the Plex or Jellyfin version. Picks' `watchUrl`/`watchAppUrl` come from `watchLinks()` in `recommend.ts`.
    - `services/plexSync.ts` mirrors "Seen it" to Plex watched and the Watchlist mark to the Plex Watchlist. `services/profiles.ts` is the Plex Home side: import, PIN linking, history.
    - `integrations/jellyfin.ts` + `services/jellyfin.ts` + `routes/jellyfin.ts`: Curatorr signs in once as a Jellyfin administrator (username and password) and keeps that token: it reads and marks every user's movies by passing their `userId`. Only the `Authorization: MediaBrowser …` header (Jellyfin 12 dropped `X-Emby-*` and `api_key`), and only 10.9+ routes (`/Items?userId=`, `/UserPlayedItems`, `/UserFavoriteItems`, `/UserImage`); the legacy `/Users/{id}/…` forms are obsolete.
    - Jellyfin keeps one token per DeviceId and user, so Settings sign-ins (`/api/jellyfin/login`) use a one-off device and log out at once; the connecting administrator signing in on Curatorr's device would replace its token. Wrong passwords pause after five (`Guesses`), since Jellyfin can lock an account after three.
    - With Jellyfin, the Watchlist is the person's favourites, every non-disabled user becomes a profile with no PIN, `MaxParentalRating` (an age) maps to the nearest restriction at or below it, and any administrator can manage Settings. One `/Items?userId=` read per profile gives watched, favourites and `available`: the movies that person can open (library access, parental controls), stored as `tmdb:`/`imdb:` keys and checked by `eligibleMovies` once matching works. Pictures go through `/api/avatar/:userId`, since phones may not reach Jellyfin's address; Watch on Jellyfin opens `<publicUrl>/web/#/details?id=…&serverId=…`.
  - `integrations/seerr.ts` + `services/requests.ts` read Seerr movie requests after each library sync and store them per profile, matched by Plex account id (`plexId` = `plex_user_id`) or Jellyfin user id (`jellyfinUserId` = `jellyfin_user_id`, compared without dashes) and TMDB id. Seerr is optional: setup offers it after the media server (not without one) and Settings changes it. Setup only checks the key, since the library is still empty; the first sync reads the requests. A failed read keeps the last ones.
  - `session.ts`: signed cookies. The profile cookie lasts a year. Admin means the Plex server owner, or a Jellyfin administrator, signed in on this device, or demo mode, or nobody has connected Plex or Jellyfin yet.
- **`web/`**: React 19, TanStack Query, Tailwind v4, `motion`, `vite-plugin-pwa`.
  - `lib/router.tsx` is a tiny history router.
  - Every wizard answer lives in the URL (`/ask/<step>?genre=…`), so the phone's back gesture steps back through the questions. Auto-skipped steps use `navigate(…, { replace: true })`, so Back never lands on them.
  - `/pick` takes the full criteria, or `like=<movie id>` for "Something like…" (picked on `/like`, whose search also lives in the URL). `App.tsx` chooses the screen from `/api/status`: setup, profiles, wizard, like, pick or settings.
  - The service worker caches the app shell and images. `/api/*` is network-only.

### Feedback model

The feedback kinds are `shown`, `skipped`, `seen`, `never`, `accepted` and `later`.
- **Names:** `later` is the internal name for the UI's **Watchlist** button. Don't rename the kind, the DB or the API.
- **Undo:** `DELETE /api/feedback/:id` deletes the row for `shown`, `skipped` and `accepted`. For the marks (`seen`, `never`, `later`) it removes every mark of that kind for the movie and reverts the media server only if Curatorr changed it.
- **Ranking:**
  - **Requests and the Watchlist:** an unwatched Seerr request gets +8 and a "You requested this" chip; otherwise the Watchlist gets +6. They don't stack, since Seerr can auto-request Watchlist items. `app.boostRequests` turns requests off.
  - **Skips:** `skipped` costs −15 for 14 days, and each other skip in the last 90 days adds 14 more.
  - **Shown picks:** `shown` costs −4 per earlier evening shown in the last 30 days, up to −16. It only counts after a 3-hour grace (`SHOWN_GRACE`), so the same answers give the same pick within an evening.
  - **New arrivals:** a movie whose file arrived lately gets up to +12, fading over about three weeks, with an "Added … ago" chip while it's worth 6 or more. Movies only another profile requested don't get it.
    - The date is Radarr's import date of the first file Curatorr saw (`arrived_at`), so an upgrade doesn't make a movie new again. Radarr's added date is when a request was made, often before release, and is only the fallback.
  - **Retention:** `shown` and `skipped` are pruned after 90 days; `accepted` is kept for taste.
- **README:** "How picks work" quotes these numbers and the other constants in `scoring.ts`. Update it in the same commit when they change.

### Branches, commits and releases

- **Branches:** work on `develop`. `main` only moves at a release, by fast-forwarding to `develop`, and pull requests target `develop`. Never force-push or rewrite pushed history.
- **Commit subjects:** Conventional Commits, and `feat`/`fix`/`perf` subjects are shown to users as What's new notes. So write them as plain user-facing sentences: `type(component): summary`, e.g. `fix(picks): keep the desktop buttons together`. Add a short body. Don't add `Co-Authored-By` trailers or any other AI attribution to commits or pull requests.
- **Version:** the top `## x.y.z (date)` heading of CHANGELOG.md is the app version (`server/build.mjs` injects it; the web bundles the file). Its bullets are commit subjects, each linking to its commit. The maintainer writes releases as a `Release x.y.z` commit; don't edit CHANGELOG.md or bump versions unless asked.
- **Publishing:** when a new top version reaches `main`, CI pushes the image as `X.Y.Z`, `X.Y` and `latest`, then tags `vX.Y.Z` and publishes the section as a GitHub Release. If the image fails, nothing is tagged or released, and re-running the workflow starts over. A push to `main` without a new version publishes nothing. Don't create tags or releases by hand.
- **Popup:** it opens after an update only when an unseen release has a `feat` or a hand-written intro (`hasHeadlineNews`). Fix-only releases are listed under Settings → What's new.

## UI conventions and deliberate decisions

- **Design language:** a dark, Seerr-inspired theme. Tokens are in `web/src/styles.css`. The indigo→violet `bg-accent-gradient` is reserved for primary actions. The only font is Archivo, with the `font-display` utility (condensed 68%, weight 800) for titles and questions. The "Tonight's pick" reveal is the one bold moment.
- **Contrast:** `--color-faint` and `--color-accent-2` are tuned to keep text at WCAG AA. Re-check contrast if you change them.
- **Stacking:** Shell's `<main>` is a stacking context below the header. Fixed overlays (dialogs, the PIN pad, `BottomBar`) must render outside `<Shell>`, as `Settings.tsx`, `Profiles.tsx`, `Pick.tsx` and `Wizard.tsx` do.
- **Decided with the maintainer; keep these unless asked:**
  - The header uses `pt-safe` (safe area + 1rem) to clear the iOS status-bar blur.
  - On desktop the header keeps one width (`max-w-6xl`) on every screen, so the logo never moves. Shell's `wide` only widens `<main>`, for the pick. `html` reserves the scrollbar's gutter (`scrollbar-gutter: stable`), so screens with and without a scrollbar line up.
  - On phones, actions sit in a sticky `BottomBar`: Watch on Plex (or Jellyfin) plus Not tonight / Watchlist / Seen it / Never on the pick screen, and the "no preference" answer in the wizard. Swiping the poster left means Not tonight.
  - Toasts appear at the top on phones and at the bottom on desktop, and every mark or skip offers Undo.
  - On phones, "Watch on Plex" opens `https://watch.plex.tv/movie/<slug>`, because the redesigned Plex apps ignore `plex://` links (`watchLink` in `web/src/lib/format.ts`). Desktop opens Plex Web. "Watch on Jellyfin" opens Jellyfin's web app everywhere: its apps take no links.
  - Copy names the server through `serverName()`, which says "Plex" when there is none, so the demo and the README screenshots are unchanged.
  - The wizard only offers answers matching at least 3 movies and auto-skips questions with no real choice. "Start a saga" is an answer to the time question. "Surprise me" goes straight to a pick, drawn from the ten best and the same all evening.
  - "Something like…" is a card above the genres, not a bottom-bar button. It leaves out the liked movie's own saga.
  - In a phone's browser, a "Use Curatorr like an app" tip sits above "Something like…": the Share → Add to Home Screen steps on iOS, or an Install button when Android Chrome offers one (`beforeinstallprompt`). ✕ hides it for good, and the installed app never shows it (`web/src/lib/install.ts`).
- **Touch targets:** keep them at 44pt or more. Toggles get their hit area from a `::before` box.

## Checking UI changes

Build, run the demo server, and drive it with Playwright at 390×844 (`isMobile`, `hasTouch`, with an iPhone user agent so the phone paths run) and at 1440×900.
- **What's new:** set `localStorage['curatorr:lastSeenVersion']` to the current version to keep the popup out of the way.
- **Safe areas:** headless browsers report zero safe-area insets. To see real iPhone spacing, override `.pt-safe` and `.pb-safe` with about 59px top and 34px bottom.
- **Scrollbars:** Playwright's headless Chromium hides scrollbars (`--hide-scrollbars`), so a layout shift caused by a desktop scrollbar doesn't show. Launch with `ignoreDefaultArgs: ['--hide-scrollbars']` to see it.
- **Stubbing requests:** once the service worker controls the page, `page.route` no longer sees `/api` requests. Use `context.route`, or create the context with `serviceWorkers: 'block'`.
- **Installed app:** headless browsers run as a browser tab. An init script that defines `navigator.standalone` as true makes the page act as the installed app (no install tip). Dispatch a synthetic `beforeinstallprompt` to see the Android tip.
- **README screenshots:** `docs/screenshots/*.webp` show the demo as the installed app (Alex) at 390×844, device scale 2, converted with `sharp`. Retake them when those screens change.
