# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Curatorr is a self-hosted PWA that answers "what should we watch tonight?" from a Radarr library, with Plex Home or Jellyfin profiles. A household opens it from a phone home screen, picks a profile, answers up to four questions (genre → theme → mood → time) and gets a matching movie ranked by rating, new arrivals and the profile's taste, with alternatives queued. README.md covers the features, install, env vars and how scoring works; CONTRIBUTING.md is the same workflow as below, written for people.

## Commands

Requires Node 22.13+, for the built-in `node:sqlite`. Docker runs Node 26, and CI tests on both 26 and 22.13. Keep `engines`, esbuild's `node22` target and the docs at 22.13 unless the floor is raised on purpose.

```sh
npm install
npm run dev:demo     # API on :7979 with a seeded demo library + Vite UI on :5173 (proxies /api)
npm run dev          # same against real Radarr and Plex or Jellyfin; first start runs setup
npm test             # vitest: shared/, server/, and the pure modules in web/src/lib/
npx vitest run shared/src/scoring.test.ts -t "penalises movies skipped"   # one file / one test
npm run typecheck    # tsc on shared, server and web in turn, then on the tests (tsconfig.test.json)
npm run build        # web/dist (Vite + PWA) then server/dist (esbuild bundle)
npm run tags         # tagging report on config/curatorr.db; -- --movie <title> explains one, -- --tag <id> lists a tag
npm run eval         # ranking report on config/curatorr.db; -- --save <file> then -- --compare <file> measures a change
                     # -- --like <title> explains one "Something like…" list
                     # -- --parts shows what each part of the score does; -- --weights taste=0 reweighs parts (0 drops one)
                     # -- --watch <title> replays the evenings a movie was watched, with each part of the top 12
npm run icons        # regenerates the committed PWA icons from web/public/logo.svg and app-icon.svg, and the iPhone startup images
```

- **Built app:** run `CURATORR_DEMO=1 CONFIG_DIR=<tmp dir> PORT=7979 node --disable-warning=ExperimentalWarning server/dist/index.js`. The server serves `web/dist` and falls back to `index.html` for SPA routes.
- **Demo mode:** seeds `curatorr-demo.db` with about 95 movies and three profiles: Alex (owner, has started Back to the Future), Sam, and Kids (older_kid). A few files arrive days before each start (Alex's two requests reached Radarr a month earlier), and seeded watches are a week apart. In demo mode everyone counts as admin and no profile has a PIN.
- **Install scripts:** npm skips dependencies' install scripts unless `allowScripts` in the root `package.json` allows them. esbuild's is denied on purpose (it works without it). Approve a new one only after reviewing it, with `npm install-scripts approve <pkg>`.
- **Not configured:** there's no linter, no formatter, and no tests of web's screens (only of the pure modules in `web/src/lib`: `criteria`, `format`, `marks`, `pictures`, `settings`, `url`, which must stay free of side effects at import). Match the surrounding style: 2-space indent, single quotes, lines up to about 120 characters, and sparse, explanatory comments.
- **CI** (`.github/workflows/ci.yml`) runs on pushes to `main` and `develop` and on pull requests:
  - the typecheck, the tests and the build, on Node 26 and 22.13;
  - the changelog check, and on `main` the release (see below);
  - everywhere but `main`, a build of the Docker image for both platforms, without pushing it. Then it starts the amd64 image in demo mode, which must become healthy, run as PUID:PGID, keep the database at mode 600 and exit with 0 on SIGTERM.
  - Actions are pinned to commit SHAs, with the release in a comment. Change both together.
- **Dependency updates:** Dependabot (`.github/dependabot.yml`) opens monthly, grouped pull requests against `develop` for npm, the Actions and the Dockerfile's base images, which are pinned by digest. New versions wait a week first. A new Node major is adopted by hand.

## Architecture

An npm workspace in three parts. `@curatorr/shared` is consumed as TypeScript source (no build step).

- **`shared/`**: pure, unit-tested logic used by both sides.
  - `taxonomy.ts`: the genre, theme, mood and time vocabulary, the first question's shortcuts (`SHELVES`: `JUST_ARRIVED` and the `SEASONS`), plus wizard constants (`STEP_ORDER`, `MIN_OPTION_COUNT = 3`, and the answers `NO_PREFERENCE` and `SAGA_TIME`). The picks routes refuse an answer that isn't in the vocabulary (400), as they do an unknown shortcut.
  - `tagger.ts`: turns TMDB genres, keywords and overview into themes and moods. `explainTags` keeps the evidence behind each tag.
    - Each keyword counts once per tag, through its best term, and each term counts once.
    - Weak terms only back up a strong term, an implying genre or the plot (for moods: a genre lean, a strong term or the runtime bonus). TMDB's tone words (amused, hopeful…) are weak for Light & Fun and Feel-Good because they're noisy.
    - Per-tag `exclude` lists stop idioms ("cat and mouse" isn't Animals), and `overviewExclude` does the same for the plot ("haunted by his past" isn't Supernatural); some themes need two signals (`threshold: 3`).
    - `tagger.fixtures.ts` holds real movies with clear-cut expected tags. Keep it passing and add a case when you fix a mis-tag.
  - `scoring.ts` gathers the picking modules: `clock.ts` (`pickingDay`, `dayStart`), `quality.ts`, `eligibility.ts` (`eligibleMovies`), `criteria.ts`, `shelves.ts` (shortcuts and seasons), `personal.ts` (skips, shown, wanted, arrivals, jitter), `tastePoints.ts`, `ranking.ts` (`rankMovies`) and `facets.ts` (`wizardOptions`: counts, images, and the `skip` rule for questions with no real choice or once the picks can show every movie left). `rankMovies` starts from the quality score and adds:
    - the theme/mood bonus, taste points (`tastePoints`) and the new-arrival bonus (`arrivalTime`: the file's `arrivedAt`, else `addedAt`);
    - skip and showing penalties, the watchlist and request bonuses and the next-saga bonus;
    - a jitter seeded per profile per day.
    - What the profile wants (the request or watchlist bonus, the new-arrival bonus, the next-saga bonus) counts `WANTED_WEIGHT` (1.5) times its bonus in these picks: replayed watches favoured those far more than the same points of rating (decided with the maintainer). `rankSimilar` adds them as they are.
    - For "Surprise me" (no answers, `isSurprise`), `surpriseOrder` then deals the ten best in an order drawn per profile per evening. `rankMovies` itself leaves `{}` in rank order; `recommendFor` and `npm run eval` apply the draw.
    - **Shortcuts** (`Criteria.shelf`): `matchesShelf` keeps a shortcut's movies, ranked as usual and not shuffled.
      - Given `now`, `wizardOptions` returns them as `shelves` on the genre step. `npm run eval` reports each as a row of its own.
      - **Just arrived** (`'new'`) is the movies that arrived in the last `JUST_ARRIVED_DAYS` (30), by `arrivalTime`. Its tile needs at least 3 of them and at most half of the pool, so a library imported last week isn't all "new". Every pick on it says when it arrived.
      - **Seasons** (`SEASONS`):
        - **Halloween** is October and **Christmas** is December, by `pickingDay`, so the last night lasts until 4 am (`seasonFor`).
        - A season has keywords that set a movie on the holiday itself (found inside longer keywords through `keywordPhrases`), plus genres and themes that fit it. Halloween is Horror, Supernatural, Vampires and Zombies; Monsters is left out because of its sharks and kaiju.
        - Keyword matches get `SEASON_BONUS` (5) and the season's chip.
        - The tile needs at least 3 movies, with no half rule.
      - **Sagas:** a new sequel still brings in its unwatched first part, as answers do. On a season, the first part must fit the season too.
  - `taste.ts`: a profile's taste vector, summed from the `similar.ts` signatures of what it watched (compared with the same `cosine`, but without its floor for short signatures, which measured no better): media server watches and `accepted` count fully, `seen` 0.3, with a 60-day half-life. Confidence grows with history and is 0 without any. Only events before the day's 4 am turnover (`dayStart`) count, so an evening's picks don't move. Its "Because … watched" (`because`) only names movies everyone picking may see (`explainable`, from `picking`'s limits).
    - "Seen it" marks the movie watched on the media server too, and the next sync reads that back as a watch. `seenEchoes` spots it (the mark changed the server, `serverSynced`, and the watch is dated within 10 minutes of it), and it counts as the mark. `npm run eval` doesn't replay it either.
  - `similar.ts`: "Something like…". `rankSimilar` ranks eligible movies by cosine similarity to a liked movie (keywords weighted by rarity, plus themes, moods and genres). It reuses `personalAdjustment` from `personal.ts`, but not taste.
    - TMDB's tone words (`TONE_KEYWORDS`: absurd, suspenseful…) don't count as keywords, here or in taste: contributors add them unevenly, and the moods cover them.
    - A signature shorter than a typical movie's (`typicalNorm`, the library's median) counts as that long in `similarity`, so movies with few keywords don't crowd every list.
    - Likeness is scored against the closest match (`SIMILARITY_POINTS * sim / best`), so the rating and `personalAdjustment` only reorder movies about as alike, except a pick passed over on several evenings, whose shown penalty keeps growing.
  - `sagas.ts`: collection ordering. `picking` only counts the parts everyone picking can be offered, so a part held back by limits, missing from the media server or marked Never doesn't hold back the parts after it.
  - `changelog.ts`: parses CHANGELOG.md for the What's new popup.
- **`server/`**: Fastify 5.
  - `app.ts` builds the app; tests use `tempApp(name)` (the demo on a temporary folder, `{ demo: false }` for a fresh install) and `app.inject`. `server/src/testing.ts` also has `tempStore`, `fakeServer`, `cookiesOf`, `adminCookie`, `silentLog` and `storedMovieMaker`; shared's tests make movies with `movieMaker` (`shared/src/testing.ts`, not exported from the index).
    - **Hardening:** request bodies are JSON only (the `text/plain` parser is removed, so a form on another page can't reach a route), and every response says `nosniff` and `Referrer-Policy: same-origin`. Requests other than GET/HEAD/OPTIONS that the browser marks `Sec-Fetch-Site: cross-site` or `same-site` get 403 (`onRequest` in `app.ts`): a sibling subdomain's page would carry the Lax cookies. Without the header (Radarr's webhook, curl) they pass. Framing stays allowed, for dashboards like Organizr. The app's pages (`index.html` and the SPA fallback) carry a Content-Security-Policy (`CONTENT_SECURITY_POLICY` in `app.ts`): only the app's own scripts, inline styles, pictures from anywhere over https, fetches to Curatorr only, and no `frame-ancestors`. The image and avatar proxies only pass image content types. `/api/image` (Radarr's pictures) answers only the device's profile, for movies its limits allow (`limitsFor`), and as `private`, so no shared cache keeps one. The picking answers (`/api/wizard/*`, `/api/recommendations`, `/api/like`, `/api/hidden`) go compressed when the browser accepts it (`compress.ts`: brotli, else gzip, from 1 KB). Nothing else does, so no answer holding a secret is compressed (BREACH).
    - **What anyone can see:** `/api/status` only gives the last sync error's text to admins, since it names Radarr's or the media server's address, and the image and avatar proxies answer a failure with a plain "Image unavailable". So does Settings sign-in with Jellyfin ("Couldn't reach Jellyfin…"); the log has the detail.
  - Routes in `routes/` are `RouteModule`s that receive an `AppContext { store, library }`. Validate input with zod through `parse()` from `context.ts`, and throw `HttpError` for 4xx responses, which can carry flags like `needPin`, `needProfile` or `needSetup` that the client acts on. `access.test.ts` lists every `/api` route by who may call it (owner, profile, anyone, or guarded otherwise) and fails on a new route that isn't listed.
  - `db.ts` holds the migrations: an append-only array applied via `PRAGMA user_version`. Never edit an old entry; add a new one. `openDb` makes the database (and its -wal/-shm files) mode 600 as it opens it, also outside Docker; `db.test.ts` checks it on Linux only.
  - `store.ts` wraps every query. App settings live as JSON in the `settings` table through `store.get(key)`, which fills missing keys from `DEFAULTS` (one factory per setting), and `store.reset(key)` puts one back as it starts out.
  - `services/library.ts` syncs Radarr → SQLite on a timer, re-tags movies and matches them to the media server's items by TMDB/IMDb id (`indexByIds` in `matching.ts`). `retag()` also runs at startup, so a vocabulary change applies without a sync.
    - **Profiles:** each sync also reads the media server's users again (`refreshProfiles` in `mediaServer.ts`, the same import as Settings → Refresh profiles), so a PIN, a parental limit or an administrator's rights changed there apply within a sync. A failed read changes nobody.
    - **Radarr's webhook:** `routes/radarr.ts` takes it at `POST /api/radarr/webhook?token=…`, and the token in `radarrWebhook` settings stands in for a sign-in. Imports and deletions call `syncSoon()`, which syncs two minutes later, once Plex or Jellyfin has scanned the file; bursts make one sync.
    - **Retries:** the scheduler's 10-minute check (`syncDue`) also syncs again while a movie that arrived in the last hour isn't on the media server yet, since picks only offer what the server has.
  - `scripts/tags.ts` (`npm run tags`) and `scripts/eval.ts` (`npm run eval`) are read-only reports on a copy of a real database in `config/`. It holds Plex or Jellyfin tokens: never commit or upload it.
    - Real TMDB keywords are much messier than the demo library's, so tune the vocabulary against `npm run tags` (coverage, unmatched keywords, idiom candidates), not the demo.
    - `npm run eval` replays each watch with that evening's library, history and wizard questions, and reports MRR and hit@k for new arrivals and the backlog, plus a staleness simulation. It never reads `settings`. Measure ranking changes with `--save` and `--compare` rather than by feel.
    - `--parts` reports what each part of the score (`RankedMovie.parts`) does: its spread among the matches, how well it alone picks out the watched movie, and how often it decides the first pick. `--weights part=x` ranks with parts reweighed, so with `--compare` it measures an ablation without touching the code. `--watch <title>` prints the evenings a movie was watched, with every part of its questions' top 12.
    - The reports print the household's profile names and what they watched. Keep both out of commits, code and issues; label profiles A, B, C… with their watch counts instead.
    - "Something like…" has no watches to replay, so `npm run eval` checks its lists from every movie a profile watched: picks sharing a genre or a theme, and movies crowding the top 3. `--like <title>` explains one list: what each pick shares with the movie, and how much of their likeness each shared keyword, theme, mood or genre makes up.
  - `services/recommend.ts`: `profileData` reads what ranking needs from the store, and `picking` turns it into the context and `RankOptions`. `npm run eval` calls `picking` for earlier moments, so every ranking input must go through it.
    - **Kept for a screen's look-ahead:** requests go through `pickingFor`, which keeps `groupData` + `picking` for the last four groups (each in its order, and with taste per evening, `dayStart`) until the next write to the database: `Store.version()` is SQLite's `total_changes()`, which every insert, update and delete moves. Only `opts.now` is the request's own, so ranking must read nothing but the store and `now`, or the memo would serve it stale.
    - **Watching together:** `picking` takes one profile or several; a profile on its own is a group of one, and `npm run eval -- --compare` must stay at +0.000 when this changes. Together:
      - a movie is out if anyone watched it or marked it Seen it or Never;
      - limits and Jellyfin's `available` are intersections, and sagas use what everyone has seen, but a part only some of them have seen doesn't hold back the next (decided with the maintainer);
      - watchlists and requests are unions, with `wantedBy` naming whose for the chips;
      - each member's taste blends in `tastePoints` (half the mean plus half the lowest, without members who have no history);
      - feedback is the union, deduplicated by movie, kind and time, so a group's skip saved for each member counts once.
  - **Media server:** Plex or Jellyfin, one at a time (`store.mediaServer()`). Setup asks which; connecting one lets the other go, and once setup is complete the other is refused (409), and so is skipping both, which would leave no owner. Settings can't switch.
    - `services/mediaServer.ts` dispatches the profile sync (`syncServerState`) and the marks (`applyMark`/`revertMark`, behind `app.syncToServer`) to the Plex or Jellyfin version. Picks' `watchUrl`/`watchAppUrl` come from `watchLinks()` in `recommend.ts`.
    - `syncServerState` reads nobody before the first library sync has stored movies: right after setup, profiles get picked while that sync runs, and a read then would match nothing yet pass for fresh for ten minutes.
    - `services/plexSync.ts` mirrors "Seen it" to Plex watched and the Watchlist mark to the Plex Watchlist. `services/profiles.ts` is the Plex Home side: import, PIN linking, history.
    - `integrations/jellyfin.ts` + `services/jellyfin.ts` + `routes/jellyfin.ts`: Curatorr signs in once as a Jellyfin administrator (username and password) and keeps that token: it reads and marks every user's movies by passing their `userId`. Only the `Authorization: MediaBrowser …` header (Jellyfin 12 dropped `X-Emby-*` and `api_key`), and only 10.9+ routes (`/Items?userId=`, `/UserPlayedItems`, `/UserFavoriteItems`, `/UserImage`); the legacy `/Users/{id}/…` forms are obsolete.
    - Jellyfin keeps one token per DeviceId and user, so Settings sign-ins (`/api/jellyfin/login`) use a one-off device and log out at once; the connecting administrator signing in on Curatorr's device would replace its token.
    - Jellyfin can lock an account after a few wrong passwords, so `/api/jellyfin/login` only asks Jellyfin about names that belong to an administrator's profile: nobody else can manage Curatorr, and their wrong passwords would only count toward a lockout. The counting below is in `services/jellyfinSignIn.ts`.
      - **Lockout:** it reads the account first (`users()`). Jellyfin 12.2 gives everyone `LoginAttemptsBeforeLockout` -1 (never), saves 0 as 3, and disables an account at the N-th wrong password in a row; a disabled account gets no password at all.
      - **Two tries:** it passes on two wrong passwords in a row at most (`passwordTries`: fewer when Jellyfin disables the account after three or less, and none after two or less, which answers 403 and says why), then waits until that account has signed in to Jellyfin itself (`LastLoginDate` moves past the one read when the count began). Where Jellyfin has a lockout, its own `InvalidLoginAttemptCount` counts too.
      - **Counting:** each try is counted in the `jellyfinMisses` setting before the password goes out, with no await in between, so tries sent together are counted one by one and a restart forgets nothing. A right password clears it; a sign-in Jellyfin didn't answer doesn't count.
      - **Elsewhere:** setup's sign-in and Plex PINs use `Guesses` (`guesses.ts`, in memory): five wrong in a row, then one try per 10 minutes, each counted when it's taken.
    - With Jellyfin, the Watchlist is the person's favourites, every non-disabled user becomes a profile (with no PIN unless an administrator gives it one in Settings: `PUT /api/profiles/:id/pin`, kept scrambled in `pin_hash` by `pins.ts`, checked by `checkKeptPin` against the same `Guesses` as Plex PINs), `MaxParentalRating` (an age) maps to the nearest restriction at or below it, and any administrator can manage Settings. One `/Items?userId=` read per profile gives watched, favourites and `available`: the movies that person can open (library access, parental controls), stored as `tmdb:`/`imdb:` keys and checked by `allowedFor` (with the parental limit) for picks, "Something like…" and its search, also while matching isn't working. A profile Curatorr hasn't read yet can open nothing. Pictures go through `/api/avatar/:userId`, since phones may not reach Jellyfin's address; Watch on Jellyfin opens `<publicUrl>/web/#/details?id=…&serverId=…`.
  - `integrations/seerr.ts` + `services/requests.ts` read Seerr movie requests after each library sync and store them per profile, matched by Plex account id (`plexId` = `plex_user_id`) or Jellyfin user id (`jellyfinUserId` = `jellyfin_user_id`, compared without dashes) and TMDB id. Seerr is optional: setup offers it after the media server (not without one) and Settings changes it. Setup only checks the key, since the library is still empty; the first sync reads the requests. A failed read keeps the last ones.
  - `services/updates.ts` reads GitHub's latest release at startup and every 6 hours (not in `dev` runs) into the `latestVersion` setting; a failed read keeps the last one. CI publishes a release only once its image is pushed, so a release always has an image to pull. `/api/status` gives `update` (the version and its release page) to admins only, when it's newer than `config.version`: the header's Settings gear then shows a dot, and Settings a card.
  - `session.ts`: signed cookies. The profile cookie lasts a year, but a profile that got a PIN since asks for it again (`currentProfile` checks `pinNeededHere`). Admin means the Plex server owner, or a Jellyfin administrator, signed in on this device (`curatorr_admin` = `id.issued[.epoch]`, 30 days, read by `adminId`), or demo mode, or nobody has connected Plex or Jellyfin yet.
    - **PINs:** `hasPin` is a Plex Home PIN or one Curatorr keeps for a Jellyfin profile. Where an administrator has signed in to settings, their own profile opens without its PIN (`adminId` matches its server user); nobody else's does.
    - **PINs entered:** `curatorr_unlocked` = `epoch|id:until,…` (`unlocksHere`/`setUnlocks`). Picking a profile keeps only its own PIN, as long as before (a year when just entered), so a tablet handed to a kid locks a grown-up's profile again. A group keeps its members' PINs until it ends, the lead's as for picking. A cookie from before (`1,2`) holds until the next pick.
    - **Epochs:** both cookies carry the `sessionEpoch` setting, '' until the first one is set, so cookies from before epochs keep working.
    - **Signing everyone out:** Settings → Sign out all other devices (`POST /api/settings/sign-out-everywhere`) sets a new epoch, so every other device's sign-in and PINs stop counting, and re-issues the caller's own cookies.
    - **Plex sign-in:** plex.tv hands the token to whoever asks with a PIN's id, so `curatorr_plex_pins` lists the PINs this browser started, and only it may claim them.
    - **Groups:** `curatorr_together` holds the others watching with the device's profile, until the next 4 am (`togetherUntil`).
    - **`currentGroup`** returns `[device profile, ...members]`, dropping members who are gone, hidden, no longer linked or got a PIN this device hasn't entered.
    - **Who reads it:** the wizard, picks and "Something like…" use `requireGroup`; Settings stays the device profile's.
    - **Endpoints:** `POST /api/profiles/together` starts a group. A protected member answers 403 `needPin` with its `profileId`, one at a time. Selecting one profile ends the group.
- **`web/`**: React 19, TanStack Query, Tailwind v4, `motion`, `vite-plugin-pwa`.
  - `lib/router.tsx` is a tiny history router.
  - Every wizard answer lives in the URL (`/ask/<step>?genre=…`), so the phone's back gesture steps back through the questions. A question with no real choice is passed over before it shows (see below); opened directly, it moves on with `navigate(…, { replace: true })`, so Back never lands on it.
  - **Moving on:** answers, shortcuts, Surprise me and "Something like…" picks go through `useAdvance` (`lib/wizard.ts`). Its `prepare` loads the next screen's answers (past questions with no real choice) or pick, and starts its first pictures without waiting for them: one still loading fades in (decided with the maintainer). While a question is on screen, `useLookAhead` loads what each answer leads to, three at a time so a tap never queues behind them, and a tap moves on at once. On "Something like…" (up to 60 posters), only the posters a scroll stops at load ahead (`usePostersOnScreen` in `Like.tsx`). `warm`, on `pointerdown`, starts an answer's pictures before the tap completes. Only when the answers aren't in yet does the tapped answer stay pressed, with a spinner after 300 ms, giving up after 1.5 s. New ways into a question or a pick should use them too.
  - **Taps and entrances:** for 300 ms after the screen changes (`justArrived` in `lib/router.tsx`), answers, Back and a pick's buttons ignore taps, so a double tap can't act on the next screen. Screens slide in from the right going forward and from the left going back (`useEntrance`), not at all when the browser animated Back itself, and only fade with reduced motion. The slide animates `transform`, not motion's `x`, so the browser runs it on the compositor while the new screen's work holds the main thread. Going home (the logo, Start over) counts as going back (`navigate(…, { back: true })`, `<Link back>`).
  - **Press feedback:** everything tappable uses `press` (buttons, tiles, posters, avatars), `press-row` (rows and cards as wide as the screen) or `press-dim` (bare icons and text links) from `styles.css`: down the moment a finger lands, eased back by the element's own `transition`. On touch screens nothing outside fields can be selected or opens the image or link menu; text meant to be copied takes `selectable`.
  - **Poster menu:** a held poster in "Other good picks" opens `PosterMenu` (`useLongPress` in `lib/longPress.ts`; a right click or the menu key too): Watchlist, Seen it, Something like this, Never, through the pick's own `decline`/`unwatchlist` with a `target`. The chosen action runs once the menu has gone.
  - `/pick` takes the full criteria, `shelf=<id>` for a shortcut, or `like=<movie id>` for "Something like…" (picked on `/like`, whose search also lives in the URL). `App.tsx` chooses the screen from `/api/status`: setup, profiles, wizard, like, pick, settings, or one of the profile's lists (`/settings/watchlist`, `/settings/seen` or `/settings/never`).
  - **Launch:** the app stays on its launch screen until the first screen has what it shows: the first question with the "Something like…" posters, or "Who's watching?" with the profiles (`useOpening` in `App.tsx`). That screen's data loads alongside `/api/status` (`loadFirstScreen` in `lib/api.ts`, going by whether this device had a profile last time), and the launch screen's spinner only comes after half a second.
    - **The logo** stays put from tapping the icon to the first screen: the iPhone startup images (`web/scripts/splash.mjs`, run by `npm run icons`), `index.html`'s own markup and `Launch` all draw it 96 points wide in the middle. The images' media queries leave out `device-height`, which iOS 27 measures wrongly (WebKit bug 326500).
    - **Unreachable:** reads give up after 15 s and the status at launch after 6 s (`api()` in `lib/api.ts`), so away from home the app says "Can't reach Curatorr" instead of loading forever, and keeps trying every 10 s and on coming back (`useOffline` in `App.tsx`).
  - **Coming back:** `lib/resume.ts` starts over at the first question when the app returns after the 4 am turnover (the server's, which `/api/status` gives as `turnover`, not the phone's own), and fetches the questions and picks on screen again after 30 minutes away.
  - The service worker caches the app shell and images. `/api/*` is network-only.
  - TMDB pictures load with CORS everywhere (`CROSS_ORIGIN` in `components/ui.tsx`), so the service worker keeps them at their real size in `tmdb-pictures`, enough for a whole library. A new way of loading one must do the same, or the picture downloads twice.
  - Each place shows a picture at the width it needs (`PICTURE` and `sized` in `components/ui.tsx`): poster fans w185, the first question's tiles w780, poster grids w342. The mood cards and the pick's poster, rail and backdrop keep the stored w1280/w500. Decoding costs memory by a picture's size, and a long theme list holds about a hundred fan posters (decided with the maintainer, replacing one size per movie). What loads a screen ahead must ask for the size it shows (`questionPicture` in `lib/api.ts`).

### Feedback model

The feedback kinds are `shown`, `skipped`, `seen`, `never`, `accepted` and `later`.
- **Names:** `later` is the internal name for the UI's **Watchlist** button. Don't rename the kind, the DB or the API.
- **Limits:** nobody marks or lists a movie their limits keep from them (`limitsFor` in `recommend.ts`, checked per person in `routes/picks.ts`): `POST /api/feedback` and `DELETE /api/watchlist/:movieId` answer 404 for it, and `GET /api/hidden` leaves it out.
- **Undo:** `DELETE /api/feedback/:id` deletes the row for `shown`, `skipped` and `accepted`. For the marks (`seen`, `never`, `later`) it removes every mark of that kind for the movie and reverts the media server only if Curatorr changed it.
- **On watchlist:** each pick carries `onWatchlistOf`, who among those picking has it on their watchlist (the media server's, or `later` marks). Once that's everyone, the Watchlist button reads "On watchlist", and tapping it calls `DELETE /api/watchlist/:movieId`, which:
  - deletes the `later` marks;
  - takes the movie off the media server's watchlist when Curatorr put it there, or when `syncToServer` is on;
  - answers who still has it.

  The pick stays on screen, and Undo marks `later` again.
- **Taken off on the server:** while `syncToServer` is on, the media server's watchlist and Curatorr's are one. A profile read drops the `later` marks of movies that were on the server's watchlist when it began and aren't at its end (`Store.followWatchlistRemovals`).
  - The snapshot is taken before asking the server, so a movie saved during the read isn't mistaken for a removal.
  - Only movies still in the library count: one whose file is away keeps its mark.
  - `getWatchlist` pages until a short page, since a read cut short would pass for removals.
- **Watching together:**
  - `shown`, `skipped` and `accepted` are saved for every member, with one timestamp, so a group's pass also counts in each person's own picks (decided with the maintainer).
  - The marks are saved for the `profileIds` the "For whom?" sheet (`ForWhom`) returns: Seen it starts with nobody ticked, Watchlist and Never with everyone. Each mark is mirrored to that person's media server account.
  - Watchlist's sheet only offers those who don't have it yet. Taking it off asks whose ("Take it off whose watchlist?"), starting with nobody ticked.
  - `POST /api/feedback` returns `ids`, one per row, and Undo deletes each of them. `DELETE` accepts a row of the device's profile, or of anyone in the current group when it was made tonight.
  - **Afterwards:** `accepted` in a group also records a `together` row (migration v9; a second Watch within 6 hours reuses it).
    - Every 10 minutes, outside demo mode, `services/together.ts` (`settleTogether`, started in `index.ts`) refreshes the members' histories.
    - Once one shows the movie watched since the pick, the others who haven't watched it get `seen` and `applyMark`.
    - Rows close then, or after 12 hours.
- **Ranking:**
  - **Requests and the Watchlist:** an unwatched Seerr request gets +12 in the wizard's picks (+8 in "Something like…") and a "You requested this" chip; otherwise the Watchlist gets +9 (+6). They don't stack, since Seerr can auto-request Watchlist items. `app.boostRequests` turns requests off.
  - **Skips:** `skipped` costs −15 for 14 days, and each other skip in the last 90 days adds 14 more.
  - **Shown picks:** `shown` costs −4 for one evening shown in the last 30 days, and each further evening costs 4 more than the one before: −12 after two, −24 after three, −40 after four, with no ceiling, so a well-rated pick passed over night after night makes way (decided with the maintainer). It only counts after a 3-hour grace (`SHOWN_GRACE`), so the same answers give the same pick for those three hours (later the same evening, that evening counts too).
  - **New arrivals:** a movie whose file arrived lately gets up to +18 in the wizard's picks (+12 in "Something like…"), fading over about three weeks, with an "Added … ago" chip for about two weeks (while the +12 version is worth 6 or more). It doesn't matter who requested the movie: replayed watches showed a household watching each other's requests (decided with the maintainer).
    - The date is Radarr's import date of the first file Curatorr saw (`arrived_at`), so an upgrade doesn't make a movie new again. Radarr's added date is when a request was made, often before release, and is only the fallback.
  - **Retention:** `shown` and `skipped` older than 90 days are pruned when the server starts; `accepted` is kept for taste.
- **README:** "How picks work" quotes these numbers and the other constants in `personal.ts`, `ranking.ts` and `tastePoints.ts`. Update it in the same commit when they change.

### Branches, commits and releases

- **Branches:** work on `develop`. `main` only moves at a release, by fast-forwarding to `develop`, and pull requests target `develop`. Never force-push or rewrite pushed history.
- **Commit subjects:** Conventional Commits, and `feat`/`fix`/`perf` subjects are shown to users as What's new notes. So write them as plain user-facing sentences: `type(component): summary`, e.g. `fix(picks): keep the desktop buttons together`. Add a short body. Don't add `Co-Authored-By` trailers or any other AI attribution to commits or pull requests.
- **Version:** the top `## x.y.z (date)` heading of CHANGELOG.md is the app version (`server/build.mjs` injects it; the web bundles the file). Its bullets are commit subjects, each linking to its commit. The maintainer writes releases as a `Release x.y.z` commit; don't edit CHANGELOG.md or bump versions unless asked.
- **Publishing:** when a new top version reaches `main`, CI pushes the image as `X.Y.Z`, `X.Y` and `latest`, then tags `vX.Y.Z` and publishes the section as a GitHub Release. If the image fails, nothing is tagged or released, and re-running the workflow starts over. A push to `main` without a new version publishes nothing. Don't create tags or releases by hand.
- **Changelog check:** every run, on `develop` and pull requests too, checks that the first `## ` heading is the version, that its section isn't empty, and that it's the latest release or newer. An older one would move `latest` back, onto a database a newer build migrated.
- **Popup:** it opens after an update only when an unseen release has a `feat` or a hand-written intro (`hasHeadlineNews`). Fix-only releases are listed under Settings → What's new.

## UI conventions and deliberate decisions

- **Design language:** a dark, Seerr-inspired theme. Tokens are in `web/src/styles.css`. The indigo→violet `bg-accent-gradient` is reserved for primary actions. The only font is Archivo, with the `font-display` utility (condensed 68%, weight 800) for titles and questions. The "Tonight's pick" reveal is the one bold moment.
- **Contrast:** `--color-faint` and `--color-accent-2` are tuned to keep text at WCAG AA. Re-check contrast if you change them.
- **Header:** `App.tsx` renders the header once, in `Frame`, above whichever screen shows, and decides `bare` (setup, "Who's watching?") in `screenFor`. Screens render only `<Shell>`, their `<main>`. A header inside a screen would be rebuilt with it, and the profile's photo blinks while it loads again (Plex's avatar URLs are `no-cache`).
- **Stacking:** Shell's `<main>` is a stacking context below the header. Fixed overlays (dialogs, the PIN pad, `BottomBar`) must render outside `<Shell>`, as `Settings.tsx`, `Profiles.tsx`, `Pick.tsx` and `Wizard.tsx` do.
- **Decided with the maintainer; keep these unless asked:**
  - The header uses `pt-safe` (safe area + 1rem) to clear the iOS status-bar blur.
  - On desktop the header keeps one width (`max-w-6xl`) on every screen, so the logo never moves. Shell's `wide` only widens `<main>`, for the pick. `html` reserves the scrollbar's gutter (`scrollbar-gutter: stable`), so screens with and without a scrollbar line up.
  - On phones, actions sit in a sticky `BottomBar`: Watch on Plex (or Jellyfin) plus Not tonight / Watchlist / Seen it / Never on the pick screen, and the "no preference" answer in the wizard. Swiping the poster left means Not tonight.
  - Toasts appear at the top on phones and at the bottom on desktop, and every mark or skip offers Undo.
  - On phones, "Watch on Plex" opens `https://watch.plex.tv/movie/<slug>`, because the redesigned Plex apps ignore `plex://` links (`watchLink` in `web/src/lib/format.ts`). Desktop opens Plex Web. "Watch on Jellyfin" opens Jellyfin's web app everywhere: its apps take no links.
  - Copy names the server through `serverName()`, which says "Plex" when there is none, so the demo and the README screenshots are unchanged.
  - The wizard only offers answers matching at least 3 movies, never one matching every movie left (that's "no preference"), and auto-skips questions with no real choice. Once 12 or fewer movies are left (`MAX_RESULTS`, one list of picks) it asks nothing more, so "Start a saga" isn't offered then (decided with the maintainer). "Start a saga" is an answer to the time question. "Surprise me" goes straight to a pick, drawn from the ten best and the same all evening.
  - **Watching together:**
    - It starts from a **Watching together** button on "Who's watching?", where the device's profile starts ticked, and lasts until 4 am.
    - In the header, the group shows as stacked avatars.
  - "Something like…" is a card above the genres, not a bottom-bar button. It leaves out the liked movie's own saga.
  - Shortcuts (Just arrived, the season's movies) are the first tiles of the genre grid, marked with their icon, and go straight to a pick, with no more questions.
  - In a phone's browser, a "Use Curatorr like an app" tip sits above "Something like…": the Share → Add to Home Screen steps on iOS, or an Install button when Android Chrome offers one (`beforeinstallprompt`). ✕ hides it for good, and the installed app never shows it (`web/src/lib/install.ts`).
  - **Settings:**
    - **The profile's lists:** Watchlist, Seen it and Never are cards in the style of "Something like…" (`FanCard`), showing how many movies and the latest three posters, in the order of the pick's buttons.
      - Each card opens a page of its own (`Marks.tsx`): a poster grid with Remove or Restore and Undo, a search field past 12 movies, and 30 at a time.
      - An empty list's card only says how to add to it.
      - The Watchlist is the one picks use: the `later` marks plus the media server's watchlist (its movies in the library), from `GET /api/hidden`, newest first. Server entries are dated by when Curatorr first saw them there (`watchlist.added_at`, migration v10), and one with no mark has `id: null`.
      - The Watchlist's Remove calls `DELETE /api/watchlist/:movieId`, as "On watchlist" does on a pick. A movie the server keeps (marks don't update it, or it couldn't be reached) stays on the page.
    - **Connections:** Radarr, Plex or Jellyfin, and Seerr are rows in one card, each with a quiet Change that opens its form in place, with Cancel.
    - **Webhook:** Radarr's webhook is a card of its own, after Library. Once Radarr has called, its set-up steps fold away behind "How to set it up"; a new address brings them back.
- **Touch targets:** keep them at 44pt or more. The drawn toggle gets its hit area from a `::before` box; where the browser has `<input type="checkbox" switch>` (Safari, iPhones), `Toggle` is that native switch in a 64×44 label.

## Checking UI changes

Build, run the demo server, and drive it with Playwright at 390×844 (`isMobile`, `hasTouch`, with an iPhone user agent so the phone paths run) and at 1440×900.
- **What's new:** set `localStorage['curatorr:lastSeenVersion']` to the current version to keep the popup out of the way.
- **Safe areas:** headless browsers report zero safe-area insets. To see real iPhone spacing, override `.pt-safe` and `.pb-safe` with about 59px top and 34px bottom.
- **Scrollbars:** Playwright's headless Chromium hides scrollbars (`--hide-scrollbars`), so a layout shift caused by a desktop scrollbar doesn't show. Launch with `ignoreDefaultArgs: ['--hide-scrollbars']` to see it.
- **Stubbing requests:** once the service worker controls the page, `page.route` no longer sees `/api` requests. Use `context.route`, or create the context with `serviceWorkers: 'block'`.
- **Update available:** the built server's version is fixed at build time, but a run from source reads `CURATORR_VERSION`. `CURATORR_VERSION=0.1.0 CURATORR_DEMO=1 CONFIG_DIR=<tmp dir> PORT=7979 npx tsx server/src/index.ts` serves `web/dist` and finds the latest GitHub release newer.
- **Installed app:** headless browsers run as a browser tab. An init script that defines `navigator.standalone` as true makes the page act as the installed app (no install tip). Dispatch a synthetic `beforeinstallprompt` to see the Android tip.
- **README screenshots:** `docs/screenshots/*.webp` show the demo as the installed app (Alex) at 390×844, device scale 2, converted with `sharp`. Retake them when those screens change.
