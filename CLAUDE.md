# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Curatorr is a self-hosted PWA that answers "what should we watch tonight?" from a Radarr library, with Plex Home or Jellyfin profiles. A household opens it from a phone home screen, picks a profile, answers up to four questions (genre → theme → mood → time) and gets a matching movie ranked by rating, new arrivals and the profile's taste, with alternatives queued. README.md covers the features, install, env vars and how scoring works; CONTRIBUTING.md is the same workflow as below, written for people.

## Commands

Requires Node 22.13+, for the built-in `node:sqlite`. Docker runs Node 26, and CI tests on both 26 and 22.13. Keep `engines`, esbuild's `node22` target and the docs at 22.13 unless the floor is raised on purpose.

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
                     # -- --like <title> explains one "Something like…" list
npm run icons        # regenerates the committed PWA icons from web/public/logo.svg and app-icon.svg
```

- **Built app:** run `CURATORR_DEMO=1 CONFIG_DIR=<tmp dir> PORT=7979 node --disable-warning=ExperimentalWarning server/dist/index.js`. The server serves `web/dist` and falls back to `index.html` for SPA routes.
- **Demo mode:** seeds `curatorr-demo.db` with about 95 movies and three profiles: Alex (owner, has started Back to the Future), Sam, and Kids (older_kid). A few files arrive days before each start (Alex's two requests reached Radarr a month earlier), and seeded watches are a week apart. In demo mode everyone counts as admin and no profile has a PIN.
- **Install scripts:** npm skips dependencies' install scripts unless `allowScripts` in the root `package.json` allows them. esbuild's is denied on purpose (it works without it). Approve a new one only after reviewing it, with `npm install-scripts approve <pkg>`.
- **Not configured:** there's no linter, no formatter and no web test suite. Match the surrounding style: 2-space indent, single quotes, lines up to about 120 characters, and sparse, explanatory comments.
- **CI** (`.github/workflows/ci.yml`) runs on pushes to `main` and `develop` and on pull requests:
  - the typecheck, the tests and the build, on Node 26 and 22.13;
  - the changelog check, and on `main` the release (see below);
  - everywhere but `main`, a build of the Docker image for both platforms, without pushing it. Then it starts the amd64 image in demo mode, which must become healthy, run as PUID:PGID, keep the database at mode 600 and exit with 0 on SIGTERM.
  - Actions are pinned to commit SHAs, with the release in a comment. Change both together.
- **Dependency updates:** Dependabot (`.github/dependabot.yml`) opens monthly, grouped pull requests against `develop` for npm, the Actions and the Dockerfile's base images, which are pinned by digest. New versions wait a week first. A new Node major is adopted by hand.

## Architecture

An npm workspace in three parts. `@curatorr/shared` is consumed as TypeScript source (no build step).

- **`shared/`**: pure, unit-tested logic used by both sides.
  - `taxonomy.ts`: the genre, theme, mood and time vocabulary, the first question's shortcuts (`SHELVES`: `JUST_ARRIVED` and the `SEASONS`), plus wizard constants (`STEP_ORDER`, `MIN_OPTION_COUNT = 3`).
  - `tagger.ts`: turns TMDB genres, keywords and overview into themes and moods. `explainTags` keeps the evidence behind each tag.
    - Each keyword counts once per tag, through its best term, and each term counts once.
    - Weak terms only back up a strong term, an implying genre or the plot (for moods: a genre lean, a strong term or the runtime bonus). TMDB's tone words (amused, hopeful…) are weak for Light & Fun and Feel-Good because they're noisy.
    - Per-tag `exclude` lists stop idioms ("cat and mouse" isn't Animals), and `overviewExclude` does the same for the plot ("haunted by his past" isn't Supernatural); some themes need two signals (`threshold: 3`).
    - `tagger.fixtures.ts` holds real movies with clear-cut expected tags. Keep it passing and add a case when you fix a mis-tag.
  - `scoring.ts`: `eligibleMovies`, `rankMovies` and `wizardOptions` (counts, images, and the `skip` rule for questions with no real choice or once the picks can show every movie left). `rankMovies` starts from the quality score and adds:
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
  - `taste.ts`: a profile's taste vector, summed from the `similar.ts` signatures of what it watched: media server watches and `accepted` count fully, `seen` 0.3, with a 60-day half-life. Confidence grows with history and is 0 without any. Only events before the day's 4 am turnover (`dayStart`) count, so an evening's picks don't move.
    - "Seen it" marks the movie watched on the media server too, and the next sync reads that back as a watch. `seenEchoes` spots it (the mark changed the server, `serverSynced`, and the watch is dated within 10 minutes of it), and it counts as the mark. `npm run eval` doesn't replay it either.
  - `similar.ts`: "Something like…". `rankSimilar` ranks eligible movies by cosine similarity to a liked movie (keywords weighted by rarity, plus themes, moods and genres). It reuses `personalAdjustment` from `scoring.ts`, but not taste.
    - TMDB's tone words (`TONE_KEYWORDS`: absurd, suspenseful…) don't count as keywords, here or in taste: contributors add them unevenly, and the moods cover them.
    - A signature shorter than a typical movie's (`typicalNorm`, the library's median) counts as that long in `similarity`, so movies with few keywords don't crowd every list.
    - Likeness is scored against the closest match (`SIMILARITY_POINTS * sim / best`), so the rating and `personalAdjustment` only reorder movies about as alike, except a pick passed over on several evenings, whose shown penalty keeps growing.
  - `sagas.ts`: collection ordering.
  - `changelog.ts`: parses CHANGELOG.md for the What's new popup.
- **`server/`**: Fastify 5.
  - `app.ts` builds the app; tests use `buildApp({ configDir, demo: true, logger: false })` and `app.inject`.
    - **Hardening:** request bodies are JSON only (the `text/plain` parser is removed, so a form on another page can't reach a route), and every response says `nosniff` and `Referrer-Policy: same-origin`. Framing stays allowed, for dashboards like Organizr. The image and avatar proxies only pass image content types.
    - **What anyone can see:** `/api/status` only gives the last sync error's text to admins, since it names Radarr's or the media server's address, and the image and avatar proxies answer a failure with a plain "Image unavailable".
  - Routes in `routes/` are `RouteModule`s that receive an `AppContext { store, library }`. Validate input with zod through `parse()` from `context.ts`, and throw `HttpError` for 4xx responses, which can carry flags like `needPin`, `needProfile` or `needSetup` that the client acts on.
  - `db.ts` holds the migrations: an append-only array applied via `PRAGMA user_version`. Never edit an old entry; add a new one.
  - `store.ts` wraps every query. App settings live as JSON in the `settings` table through `store.get(key)`, which fills missing keys from `defaults()`.
  - `services/library.ts` syncs Radarr → SQLite on a timer, re-tags movies and matches them to the media server's items by TMDB/IMDb id (`indexByIds`). `retag()` also runs at startup, so a vocabulary change applies without a sync.
    - **Profiles:** each sync also reads the media server's users again (`refreshProfiles` in `mediaServer.ts`, the same import as Settings → Refresh profiles), so a PIN, a parental limit or an administrator's rights changed there apply within a sync. A failed read changes nobody.
    - **Radarr's webhook:** `routes/radarr.ts` takes it at `POST /api/radarr/webhook?token=…`, and the token in `radarrWebhook` settings stands in for a sign-in. Imports and deletions call `syncSoon()`, which syncs two minutes later, once Plex or Jellyfin has scanned the file; bursts make one sync.
    - **Retries:** the scheduler's 10-minute check (`syncDue`) also syncs again while a movie that arrived in the last hour isn't on the media server yet, since picks only offer what the server has.
  - `scripts/tags.ts` (`npm run tags`) and `scripts/eval.ts` (`npm run eval`) are read-only reports on a copy of a real database in `config/`. It holds Plex or Jellyfin tokens: never commit or upload it.
    - Real TMDB keywords are much messier than the demo library's, so tune the vocabulary against `npm run tags` (coverage, unmatched keywords, idiom candidates), not the demo.
    - `npm run eval` replays each watch with that evening's library, history and wizard questions, and reports MRR and hit@k for new arrivals and the backlog, plus a staleness simulation. It never reads `settings`. Measure ranking changes with `--save` and `--compare` rather than by feel.
    - "Something like…" has no watches to replay, so `npm run eval` checks its lists from every movie a profile watched: picks sharing a genre or a theme, and movies crowding the top 3. `--like <title>` explains one list: what each pick shares with the movie, and how much of their likeness each shared keyword, theme, mood or genre makes up.
  - `services/recommend.ts`: `profileData` reads what ranking needs from the store, and `picking` turns it into the context and `RankOptions`. `npm run eval` calls `picking` for earlier moments, so every ranking input must go through it.
    - **Watching together:** `picking` takes one profile or several; a profile on its own is a group of one, and `npm run eval -- --compare` must stay at +0.000 when this changes. Together:
      - a movie is out if anyone watched it or marked it Seen it or Never;
      - limits and Jellyfin's `available` are intersections, and sagas use what everyone has seen;
      - watchlists and requests are unions, with `wantedBy` naming whose for the chips;
      - each member's taste blends in `tastePoints` (half the mean plus half the lowest, without members who have no history);
      - feedback is the union, deduplicated by movie, kind and time, so a group's skip saved for each member counts once.
  - **Media server:** Plex or Jellyfin, one at a time (`store.mediaServer()`). Setup asks which; connecting one lets the other go, and once setup is complete the other is refused (409), and so is skipping both, which would leave no owner. Settings can't switch.
    - `services/mediaServer.ts` dispatches the profile sync (`syncServerState`) and the marks (`applyMark`/`revertMark`, behind `app.syncToServer`) to the Plex or Jellyfin version. Picks' `watchUrl`/`watchAppUrl` come from `watchLinks()` in `recommend.ts`.
    - `services/plexSync.ts` mirrors "Seen it" to Plex watched and the Watchlist mark to the Plex Watchlist. `services/profiles.ts` is the Plex Home side: import, PIN linking, history.
    - `integrations/jellyfin.ts` + `services/jellyfin.ts` + `routes/jellyfin.ts`: Curatorr signs in once as a Jellyfin administrator (username and password) and keeps that token: it reads and marks every user's movies by passing their `userId`. Only the `Authorization: MediaBrowser …` header (Jellyfin 12 dropped `X-Emby-*` and `api_key`), and only 10.9+ routes (`/Items?userId=`, `/UserPlayedItems`, `/UserFavoriteItems`, `/UserImage`); the legacy `/Users/{id}/…` forms are obsolete.
    - Jellyfin keeps one token per DeviceId and user, so Settings sign-ins (`/api/jellyfin/login`) use a one-off device and log out at once; the connecting administrator signing in on Curatorr's device would replace its token.
    - Jellyfin can lock an account after a few wrong passwords, so `/api/jellyfin/login` only asks Jellyfin about names that belong to an administrator's profile: nobody else can manage Curatorr, and their wrong passwords would only count toward a lockout. Wrong passwords pause after five (`Guesses`).
    - With Jellyfin, the Watchlist is the person's favourites, every non-disabled user becomes a profile with no PIN, `MaxParentalRating` (an age) maps to the nearest restriction at or below it, and any administrator can manage Settings. One `/Items?userId=` read per profile gives watched, favourites and `available`: the movies that person can open (library access, parental controls), stored as `tmdb:`/`imdb:` keys and checked by `allowedFor` (with the parental limit) for picks, "Something like…" and its search, also while matching isn't working. A profile Curatorr hasn't read yet can open nothing. Pictures go through `/api/avatar/:userId`, since phones may not reach Jellyfin's address; Watch on Jellyfin opens `<publicUrl>/web/#/details?id=…&serverId=…`.
  - `integrations/seerr.ts` + `services/requests.ts` read Seerr movie requests after each library sync and store them per profile, matched by Plex account id (`plexId` = `plex_user_id`) or Jellyfin user id (`jellyfinUserId` = `jellyfin_user_id`, compared without dashes) and TMDB id. Seerr is optional: setup offers it after the media server (not without one) and Settings changes it. Setup only checks the key, since the library is still empty; the first sync reads the requests. A failed read keeps the last ones.
  - `services/updates.ts` reads GitHub's latest release at startup and every 6 hours (not in `dev` runs) into the `latestVersion` setting; a failed read keeps the last one. CI publishes a release only once its image is pushed, so a release always has an image to pull. `/api/status` gives `update` (the version and its release page) to admins only, when it's newer than `config.version`: the header's Settings gear then shows a dot, and Settings a card.
  - `session.ts`: signed cookies. The profile cookie lasts a year, but a profile that got a PIN since asks for it again (`currentProfile` checks `pinNeededHere`). Admin means the Plex server owner, or a Jellyfin administrator, signed in on this device, or demo mode, or nobody has connected Plex or Jellyfin yet.
    - **Plex sign-in:** plex.tv hands the token to whoever asks with a PIN's id, so `curatorr_plex_pins` lists the PINs this browser started, and only it may claim them.
    - **Groups:** `curatorr_together` holds the others watching with the device's profile, until the next 4 am (`togetherUntil`).
    - **`currentGroup`** returns `[device profile, ...members]`, dropping members who are gone, hidden, no longer linked or got a PIN this device hasn't entered.
    - **Who reads it:** the wizard, picks and "Something like…" use `requireGroup`; Settings stays the device profile's.
    - **Endpoints:** `POST /api/profiles/together` starts a group. A protected member answers 403 `needPin` with its `profileId`, one at a time. Selecting one profile ends the group.
- **`web/`**: React 19, TanStack Query, Tailwind v4, `motion`, `vite-plugin-pwa`.
  - `lib/router.tsx` is a tiny history router.
  - Every wizard answer lives in the URL (`/ask/<step>?genre=…`), so the phone's back gesture steps back through the questions. Auto-skipped steps use `navigate(…, { replace: true })`, so Back never lands on them.
  - `/pick` takes the full criteria, `shelf=<id>` for a shortcut, or `like=<movie id>` for "Something like…" (picked on `/like`, whose search also lives in the URL). `App.tsx` chooses the screen from `/api/status`: setup, profiles, wizard, like, pick, settings, or one of the profile's lists (`/settings/watchlist`, `/settings/seen` or `/settings/never`).
  - The service worker caches the app shell and images. `/api/*` is network-only.

### Feedback model

The feedback kinds are `shown`, `skipped`, `seen`, `never`, `accepted` and `later`.
- **Names:** `later` is the internal name for the UI's **Watchlist** button. Don't rename the kind, the DB or the API.
- **Undo:** `DELETE /api/feedback/:id` deletes the row for `shown`, `skipped` and `accepted`. For the marks (`seen`, `never`, `later`) it removes every mark of that kind for the movie and reverts the media server only if Curatorr changed it.
- **On watchlist:** each pick carries `onWatchlistOf`, who among those picking has it on their watchlist (the media server's, or `later` marks). Once that's everyone, the Watchlist button reads "On watchlist", and tapping it calls `DELETE /api/watchlist/:movieId`, which:
  - deletes the `later` marks;
  - takes the movie off the media server's watchlist when Curatorr put it there, or when `syncToServer` is on;
  - answers who still has it.

  The pick stays on screen, and Undo marks `later` again.
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
- **README:** "How picks work" quotes these numbers and the other constants in `scoring.ts`. Update it in the same commit when they change.

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
      - The Watchlist's Remove calls `DELETE /api/watchlist/:movieId`, as "On watchlist" does on a pick.
    - **Connections:** Radarr, Plex or Jellyfin, and Seerr are rows in one card, each with a quiet Change that opens its form in place, with Cancel.
    - **Webhook:** Radarr's webhook is a card of its own, after Library.
- **Touch targets:** keep them at 44pt or more. Toggles get their hit area from a `::before` box.

## Checking UI changes

Build, run the demo server, and drive it with Playwright at 390×844 (`isMobile`, `hasTouch`, with an iPhone user agent so the phone paths run) and at 1440×900.
- **What's new:** set `localStorage['curatorr:lastSeenVersion']` to the current version to keep the popup out of the way.
- **Safe areas:** headless browsers report zero safe-area insets. To see real iPhone spacing, override `.pt-safe` and `.pb-safe` with about 59px top and 34px bottom.
- **Scrollbars:** Playwright's headless Chromium hides scrollbars (`--hide-scrollbars`), so a layout shift caused by a desktop scrollbar doesn't show. Launch with `ignoreDefaultArgs: ['--hide-scrollbars']` to see it.
- **Stubbing requests:** once the service worker controls the page, `page.route` no longer sees `/api` requests. Use `context.route`, or create the context with `serviceWorkers: 'block'`.
- **Update available:** the built server's version is fixed at build time, but a run from source reads `CURATORR_VERSION`. `CURATORR_VERSION=0.1.0 CURATORR_DEMO=1 CONFIG_DIR=<tmp dir> PORT=7979 npx tsx server/src/index.ts` serves `web/dist` and finds the latest GitHub release newer.
- **Installed app:** headless browsers run as a browser tab. An init script that defines `navigator.standalone` as true makes the page act as the installed app (no install tip). Dispatch a synthetic `beforeinstallprompt` to see the Android tip.
- **README screenshots:** `docs/screenshots/*.webp` show the demo as the installed app (Alex) at 390×844, device scale 2, converted with `sharp`. Retake them when those screens change.
