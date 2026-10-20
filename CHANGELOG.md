# Changelog

The commits in each version of Curatorr, newest first.

## 1.3.8 (2026-10-20)

- style(app): wrap the new lines past 120 characters ([c1af416](https://github.com/cosmin-sulita/curatorr/commit/c1af416))
- perf(server): compress the questions and picks sent to the app ([de74c59](https://github.com/cosmin-sulita/curatorr/commit/de74c59))
- fix(app): bring the first question in from the left when going home ([aaddc0b](https://github.com/cosmin-sulita/curatorr/commit/aaddc0b))
- perf(pictures): load each picture at the size its card shows ([44b9a3b](https://github.com/cosmin-sulita/curatorr/commit/44b9a3b))

## 1.3.7 (2026-10-20)

- fix(wizard): drop the purple ring from tapped answers and posters ([e8c7bd7](https://github.com/cosmin-sulita/curatorr/commit/e8c7bd7))
- perf(profiles): load the first question's pictures while a profile is chosen ([4402317](https://github.com/cosmin-sulita/curatorr/commit/4402317))
- perf(pictures): keep the whole library's pictures on the phone ([df51b05](https://github.com/cosmin-sulita/curatorr/commit/df51b05))
- perf(pictures): show pictures already on the phone without fading them in ([140075a](https://github.com/cosmin-sulita/curatorr/commit/140075a))
- perf(wizard): move on at once, with each answer's next screen loaded ahead ([4f5157f](https://github.com/cosmin-sulita/curatorr/commit/4f5157f))
- fix(wizard): dim all three posters while a tapped theme loads ([372f86e](https://github.com/cosmin-sulita/curatorr/commit/372f86e))

## 1.3.6 (2026-10-20)

- fix(settings): fold the webhook's set-up steps away once Radarr has called ([54f95ad](https://github.com/cosmin-sulita/curatorr/commit/54f95ad))
- fix(settings): give Settings the same title and slide-in as the other screens ([0f2b8e6](https://github.com/cosmin-sulita/curatorr/commit/0f2b8e6))
- fix(settings): name each profile's limit and what Radarr's webhook last sent ([ef1328e](https://github.com/cosmin-sulita/curatorr/commit/ef1328e))
- fix(settings): keep keyboard focus in place when a connection's form opens or closes ([a098f58](https://github.com/cosmin-sulita/curatorr/commit/a098f58))
- fix(settings): ask before disconnecting Seerr ([9a86694](https://github.com/cosmin-sulita/curatorr/commit/9a86694))
- fix(settings): let a Plex sign-in be cancelled after closing its window ([a1908f7](https://github.com/cosmin-sulita/curatorr/commit/a1908f7))
- fix(watchlist): take a movie off your watchlist here when you take it off in Plex or Jellyfin ([3b96c2f](https://github.com/cosmin-sulita/curatorr/commit/3b96c2f))
- fix(settings): keep the chosen libraries when changing the Plex or Jellyfin connection ([27b393f](https://github.com/cosmin-sulita/curatorr/commit/27b393f))
- fix(profiles): read watch history and watchlists once the first library sync is in ([7c929cf](https://github.com/cosmin-sulita/curatorr/commit/7c929cf))
- fix(settings): list your Plex Watchlist and Jellyfin favourites under Your lists ([dc87b5f](https://github.com/cosmin-sulita/curatorr/commit/dc87b5f))
- fix(settings): keep the Plex server's addresses inside the card on phones ([c012e71](https://github.com/cosmin-sulita/curatorr/commit/c012e71))

## 1.3.5 (2026-10-20)

- fix(profiles): keep the spinner away when choosing a profile for the first time ([3a48cfb](https://github.com/cosmin-sulita/curatorr/commit/3a48cfb))
- fix(picks): open a Something like… pick tapped while the search is still updating ([3c209c1](https://github.com/cosmin-sulita/curatorr/commit/3c209c1))
- docs(claude): describe how the wizard moves on ([b639338](https://github.com/cosmin-sulita/curatorr/commit/b639338))
- fix(wizard): bring the previous question in from the left when going back ([7365c22](https://github.com/cosmin-sulita/curatorr/commit/7365c22))
- fix(app): ignore the second tap of a double tap once the next screen is up ([af284b7](https://github.com/cosmin-sulita/curatorr/commit/af284b7))
- fix(profiles): open the first question ready after choosing who's watching ([998d7ce](https://github.com/cosmin-sulita/curatorr/commit/998d7ce))
- fix(picks): ease the backdrop and the other picks in instead of popping them in ([4419672](https://github.com/cosmin-sulita/curatorr/commit/4419672))
- fix(picks): open a pick with its poster already in place ([62ca368](https://github.com/cosmin-sulita/curatorr/commit/62ca368))
- fix(wizard): show each question with its answers, without a spinner or the bottom bar blinking in between ([b3ab2a1](https://github.com/cosmin-sulita/curatorr/commit/b3ab2a1))
- refactor(web): share the wizard's addresses, queries and image preloading ([748092e](https://github.com/cosmin-sulita/curatorr/commit/748092e))
- docs(eval): list the --parts, --weights and --watch reports ([81798e2](https://github.com/cosmin-sulita/curatorr/commit/81798e2))
- fix(wizard): stop asking once a dozen movies or fewer are left ([af1018e](https://github.com/cosmin-sulita/curatorr/commit/af1018e))
- fix(wizard): don't offer an answer that matches every movie left ([566448e](https://github.com/cosmin-sulita/curatorr/commit/566448e))
- fix(picks): lean more on what you asked for, what just arrived and the next part of your saga ([5aff350](https://github.com/cosmin-sulita/curatorr/commit/5aff350))
- fix(picks): favour new arrivals that someone else in the household requested ([9054928](https://github.com/cosmin-sulita/curatorr/commit/9054928))
- chore(eval): measure what each part of the score does ([b359c0e](https://github.com/cosmin-sulita/curatorr/commit/b359c0e))
- refactor(scoring): keep what each part of a pick's score adds ([4a645ce](https://github.com/cosmin-sulita/curatorr/commit/4a645ce))

## 1.3.4 (2026-10-16)

- fix(images): show pictures straight away again, as before 1.3.3 ([9f17290](https://github.com/cosmin-sulita/curatorr/commit/9f17290))

## 1.3.3 (2026-10-16)

- perf(app): drop the server's tagging vocabulary from the app's download ([41855ca](https://github.com/cosmin-sulita/curatorr/commit/41855ca))
- fix(picks): name a pick's genres as the genre tiles do ([1df1afb](https://github.com/cosmin-sulita/curatorr/commit/1df1afb))
- perf(app): install only the font the app shows, and fetch the others when a title needs them ([12c4a39](https://github.com/cosmin-sulita/curatorr/commit/12c4a39))
- perf(server): send the app compressed when it first opens and after each update ([9473b1c](https://github.com/cosmin-sulita/curatorr/commit/9473b1c))
- perf(images): load pictures at the size each card shows, and only as they come into view ([98d28ac](https://github.com/cosmin-sulita/curatorr/commit/98d28ac))
- fix(profiles): centre "Who's watching together?" when it wraps on a phone ([0388955](https://github.com/cosmin-sulita/curatorr/commit/0388955))
- fix(picks): say "Not tonight" in the toast after passing on a pick ([705f429](https://github.com/cosmin-sulita/curatorr/commit/705f429))
- fix(settings): stop iPhones zooming in on address, key and password fields ([a23e730](https://github.com/cosmin-sulita/curatorr/commit/a23e730))

## 1.3.2 (2026-10-16)

- fix(picks): push a pick you keep passing on further down each evening ([49f5ffa](https://github.com/cosmin-sulita/curatorr/commit/49f5ffa))
- fix(picks): stop "Seen it" marks from steering your picks like movies you just watched ([4d3374d](https://github.com/cosmin-sulita/curatorr/commit/4d3374d))

## 1.3.1 (2026-10-16)

- fix(settings): call them your lists instead of naming your profile ([b1412d5](https://github.com/cosmin-sulita/curatorr/commit/b1412d5))
- chore(scripts): wrap the Something like… report's long lines ([3ba3658](https://github.com/cosmin-sulita/curatorr/commit/3ba3658))
- fix(picks): let likeness decide the order of movies like the one you loved ([2510278](https://github.com/cosmin-sulita/curatorr/commit/2510278))
- fix(picks): keep thinly-tagged movies from crowding every list of movies like the one you loved ([c17595f](https://github.com/cosmin-sulita/curatorr/commit/c17595f))
- fix(picks): match movies like the one you loved on what they're about, not TMDB's tone words ([e9bfc99](https://github.com/cosmin-sulita/curatorr/commit/e9bfc99))
- chore(scripts): explain and measure Something like… on a real library ([c5cfcfd](https://github.com/cosmin-sulita/curatorr/commit/c5cfcfd))
- build(licence): ship the libraries' licence notices with the app ([f2e9d38](https://github.com/cosmin-sulita/curatorr/commit/f2e9d38))
- test(picks): keep the ranking tests' movies further apart than the daily jitter ([6a8b921](https://github.com/cosmin-sulita/curatorr/commit/6a8b921))
- docs(github): link the bug form to the repository's security policy page ([7138cf1](https://github.com/cosmin-sulita/curatorr/commit/7138cf1))
- chore(deps): propose dependency, action and base-image updates with Dependabot ([160e164](https://github.com/cosmin-sulita/curatorr/commit/160e164))
- build(docker): pin the base images so each update is tested before it ships ([b6ec592](https://github.com/cosmin-sulita/curatorr/commit/b6ec592))
- docs: describe the new CI checks ([a7d28ec](https://github.com/cosmin-sulita/curatorr/commit/a7d28ec))
- build(docker): map stack traces to the source and keep local files out of the build ([9808d96](https://github.com/cosmin-sulita/curatorr/commit/9808d96))
- ci(docker): show the image's description on its package page ([2c142af](https://github.com/cosmin-sulita/curatorr/commit/2c142af))
- docs(github): add issue forms and a pull request template ([e366abf](https://github.com/cosmin-sulita/curatorr/commit/e366abf))
- ci(docker): start the built image and wait until it's healthy ([7772b42](https://github.com/cosmin-sulita/curatorr/commit/7772b42))
- ci(test): also test and build on Node 22.13 ([c96eff7](https://github.com/cosmin-sulita/curatorr/commit/c96eff7))
- ci: pin actions to commits, drop the kept token and add timeouts ([aae84ae](https://github.com/cosmin-sulita/curatorr/commit/aae84ae))
- docs: add a security policy ([ec533a8](https://github.com/cosmin-sulita/curatorr/commit/ec533a8))
- ci(release): only publish a changelog version newer than the last release ([7a80de0](https://github.com/cosmin-sulita/curatorr/commit/7a80de0))

## 1.3.0 (2026-10-15)

- fix(settings): list the connections together and let a change be cancelled ([10d68e0](https://github.com/cosmin-sulita/curatorr/commit/10d68e0))
- fix(settings): move the sync interval to Library and Refresh profiles to Profiles ([e2bc781](https://github.com/cosmin-sulita/curatorr/commit/e2bc781))
- feat(settings): open the watchlist, Seen it and Never on pages of their own ([bc2a31b](https://github.com/cosmin-sulita/curatorr/commit/bc2a31b))
- fix(picks): show "On watchlist" for picks already on it, and take them off with a tap ([e83b175](https://github.com/cosmin-sulita/curatorr/commit/e83b175))
- feat(settings): show when a new version of Curatorr is out ([d215ff6](https://github.com/cosmin-sulita/curatorr/commit/d215ff6))

## 1.2.3 (2026-10-12)

- fix(header): keep the profile photo from blinking when a pick opens ([1e15535](https://github.com/cosmin-sulita/curatorr/commit/1e15535))

## 1.2.2 (2026-10-12)

- fix(profiles): read each profile's watch history from the libraries shared with them ([cf1fa45](https://github.com/cosmin-sulita/curatorr/commit/cf1fa45))
- fix(wizard): show the "Something like…" card with its posters from the start ([1964fc2](https://github.com/cosmin-sulita/curatorr/commit/1964fc2))

## 1.2.1 (2026-10-11)

- fix(settings): line up the Radarr section and show its whole address ([636627b](https://github.com/cosmin-sulita/curatorr/commit/636627b))
- docs(readme): show the request bonus as a line of its own ([aca364a](https://github.com/cosmin-sulita/curatorr/commit/aca364a))
- docs: describe the shown-pick grace and feedback pruning as they work ([64589ac](https://github.com/cosmin-sulita/curatorr/commit/64589ac))
- fix(docker): keep the database readable by Curatorr's user only ([97d53fd](https://github.com/cosmin-sulita/curatorr/commit/97d53fd))
- perf(picks): find movies like the one you loved faster ([84ef4ca](https://github.com/cosmin-sulita/curatorr/commit/84ef4ca))
- fix(status): show why a sync failed to the owner only ([b787738](https://github.com/cosmin-sulita/curatorr/commit/b787738))
- fix(images): never show what Radarr or Jellyfin sends for a picture as a page ([54bc877](https://github.com/cosmin-sulita/curatorr/commit/54bc877))
- fix(picks): only undo tonight's marks for others when watching together ([e2589a7](https://github.com/cosmin-sulita/curatorr/commit/e2589a7))
- fix(setup): keep the media server once Curatorr is set up ([90e4b83](https://github.com/cosmin-sulita/curatorr/commit/90e4b83))
- fix(settings): only let the browser that started a Plex sign-in finish it ([2b3b8d4](https://github.com/cosmin-sulita/curatorr/commit/2b3b8d4))
- fix(picks): keep a Jellyfin profile to its libraries until Curatorr knows them ([17529ba](https://github.com/cosmin-sulita/curatorr/commit/17529ba))
- fix(settings): only check Jellyfin administrators' passwords when signing in ([875b2db](https://github.com/cosmin-sulita/curatorr/commit/875b2db))
- fix(profiles): give custom Plex restrictions the strictest limit ([bb4b85e](https://github.com/cosmin-sulita/curatorr/commit/bb4b85e))
- fix(profiles): apply a PIN or parental limit added in Plex or Jellyfin at the next sync ([a3c804a](https://github.com/cosmin-sulita/curatorr/commit/a3c804a))

## 1.2.0 (2026-10-11)

- feat(profiles): mark a movie watched for everyone who watched it together ([2cbd4be](https://github.com/cosmin-sulita/curatorr/commit/2cbd4be))
- feat(picks): ask who Seen it, Watchlist or Never is for when watching together ([58ffda8](https://github.com/cosmin-sulita/curatorr/commit/58ffda8))
- feat(profiles): pick one movie for two or more people watching together ([1d32217](https://github.com/cosmin-sulita/curatorr/commit/1d32217))
- fix(setup): make the server step's Back button round like the others ([233f21b](https://github.com/cosmin-sulita/curatorr/commit/233f21b))
- refactor(picks): rank for several profiles at once ([ee8ef06](https://github.com/cosmin-sulita/curatorr/commit/ee8ef06))
- fix(sync): let calls from Radarr that name no movie through the webhook ([4510cb6](https://github.com/cosmin-sulita/curatorr/commit/4510cb6))
- feat(wizard): suggest Halloween movies in October and Christmas movies in December ([bb88869](https://github.com/cosmin-sulita/curatorr/commit/bb88869))
- feat(wizard): go straight to a pick from what just arrived ([f1a54c7](https://github.com/cosmin-sulita/curatorr/commit/f1a54c7))
- feat(sync): show new downloads within minutes through a Radarr webhook ([bef2958](https://github.com/cosmin-sulita/curatorr/commit/bef2958))
- ci(release): publish a release only once its image is pushed ([24666f9](https://github.com/cosmin-sulita/curatorr/commit/24666f9))
- ci(build): build the app and the Docker image on develop and pull requests ([7c23b29](https://github.com/cosmin-sulita/curatorr/commit/7c23b29))

## 1.1.0 (2026-10-11)

- chore(deps): update to Node 26 and the latest packages ([5f201a4](https://github.com/cosmin-sulita/curatorr/commit/5f201a4))
- feat(picks): count what audiences think, not only critics ([6032866](https://github.com/cosmin-sulita/curatorr/commit/6032866))
- fix(header): keep the logo in place between screens on desktop ([e47b3b9](https://github.com/cosmin-sulita/curatorr/commit/e47b3b9))
- docs(readme): put the badges under the title and the screenshots in their own section ([cc2cd53](https://github.com/cosmin-sulita/curatorr/commit/cc2cd53))

## 1.0.0 (2026-10-10)

- fix(app): make the Back button a round button that's easier to spot ([3ea3acb](https://github.com/cosmin-sulita/curatorr/commit/3ea3acb))
- fix(profiles): keep the PIN pad still while the PIN is checked ([c5df3f0](https://github.com/cosmin-sulita/curatorr/commit/c5df3f0))
- feat(jellyfin): connect Jellyfin instead of Plex ([fac718f](https://github.com/cosmin-sulita/curatorr/commit/fac718f))
- refactor(server): name what Plex and Jellyfin share after the media server ([bea4e30](https://github.com/cosmin-sulita/curatorr/commit/bea4e30))
- docs(claude): describe the release flow and the branch and commit rules ([e0a478a](https://github.com/cosmin-sulita/curatorr/commit/e0a478a))
- docs(readme): write it for people installing Curatorr, with screenshots ([12acf10](https://github.com/cosmin-sulita/curatorr/commit/12acf10))
- docs(contributing): add a guide for contributors ([ec4c97c](https://github.com/cosmin-sulita/curatorr/commit/ec4c97c))
- docs(license): add the MIT license ([35bd0e0](https://github.com/cosmin-sulita/curatorr/commit/35bd0e0))
- ci(release): tag and publish each new changelog version ([b772476](https://github.com/cosmin-sulita/curatorr/commit/b772476))
- chore(git): ignore local Claude Code settings and keep docs out of the image build ([928770e](https://github.com/cosmin-sulita/curatorr/commit/928770e))
- docs(changelog): point commit links at the rewritten history ([ab614d4](https://github.com/cosmin-sulita/curatorr/commit/ab614d4))

## 0.10.0 (2026-10-10)

- feat(setup): connect Seerr while setting up, or skip it ([a136166](https://github.com/cosmin-sulita/curatorr/commit/a136166))
- feat(app): suggest adding Curatorr to the home screen on phones ([aadc13d](https://github.com/cosmin-sulita/curatorr/commit/aadc13d))
- feat(picks): let Surprise me draw from the ten best picks, new each evening ([ec9c5db](https://github.com/cosmin-sulita/curatorr/commit/ec9c5db))
- fix(picks): count a new arrival from when its file arrived, not when it was requested ([60525a6](https://github.com/cosmin-sulita/curatorr/commit/60525a6))
- fix(app): open What's new once the screen behind has loaded ([cee55e2](https://github.com/cosmin-sulita/curatorr/commit/cee55e2))
- refactor(picks): drop the unused Rotten Tomatoes review-count adjustment ([2fd13a4](https://github.com/cosmin-sulita/curatorr/commit/2fd13a4))
- fix(wizard): keep 20th-century biopics out of Historical Epics ([82900d1](https://github.com/cosmin-sulita/curatorr/commit/82900d1))
- fix(wizard): don't read "haunted by his past" as a ghost story ([232554d](https://github.com/cosmin-sulita/curatorr/commit/232554d))
- fix(wizard): stop calling every missing-person story a whodunit ([57f5cad](https://github.com/cosmin-sulita/curatorr/commit/57f5cad))

## 0.9.0 (2026-10-09)

- chore(git): ignore brag-output folders ([0d7fe9b](https://github.com/cosmin-sulita/curatorr/commit/0d7fe9b))
- fix(settings): stop offering a switch to hide the owner's profile ([afc1744](https://github.com/cosmin-sulita/curatorr/commit/afc1744))
- fix(app): make a few small controls easier to tap ([4ee8819](https://github.com/cosmin-sulita/curatorr/commit/4ee8819))
- fix(app): show the outline of a switch that's off ([a321ed4](https://github.com/cosmin-sulita/curatorr/commit/a321ed4))
- fix(picks): name Rotten Tomatoes for screen readers ([9ce49b0](https://github.com/cosmin-sulita/curatorr/commit/9ce49b0))
- fix(wizard): make the dots for questions still to come visible ([7f0802d](https://github.com/cosmin-sulita/curatorr/commit/7f0802d))
- fix(picks): show the ratings above the action bar on small phones ([310e4b0](https://github.com/cosmin-sulita/curatorr/commit/310e4b0))
- fix(picks): keep the header and small text readable over bright backdrops ([0cc9d65](https://github.com/cosmin-sulita/curatorr/commit/0cc9d65))
- fix(app): undo a mark or skip with Ctrl+Z or ⌘Z ([7da91e0](https://github.com/cosmin-sulita/curatorr/commit/7da91e0))
- fix(picks): keep keyboard focus on the button you pressed between picks ([3fadd32](https://github.com/cosmin-sulita/curatorr/commit/3fadd32))
- fix(settings): move switches as soon as you tap them ([d90166f](https://github.com/cosmin-sulita/curatorr/commit/d90166f))
- fix(app): keep the screen when Curatorr can't be reached for a moment ([2dd209b](https://github.com/cosmin-sulita/curatorr/commit/2dd209b))
- fix(picks): keep a pick's buttons in view on laptop-sized windows ([102c978](https://github.com/cosmin-sulita/curatorr/commit/102c978))
- fix(settings): confirm Restore and Remove, and offer Undo ([6dad5f6](https://github.com/cosmin-sulita/curatorr/commit/6dad5f6))
- fix(setup): stop connecting Plex from ending at an error with no way forward ([b2827dc](https://github.com/cosmin-sulita/curatorr/commit/b2827dc))
- fix(app): keep the What's new button full size when there are many notes ([a983b74](https://github.com/cosmin-sulita/curatorr/commit/a983b74))
- fix(picks): show the next pick from the top after scrolling down ([0f05c0e](https://github.com/cosmin-sulita/curatorr/commit/0f05c0e))
- feat(picks): lean toward what each person watched lately ([7d2cbb1](https://github.com/cosmin-sulita/curatorr/commit/7d2cbb1))
- feat(picks): rotate picks you keep passing over ([9454169](https://github.com/cosmin-sulita/curatorr/commit/9454169))
- feat(picks): favour movies that just arrived in the library ([e470a81](https://github.com/cosmin-sulita/curatorr/commit/e470a81))
- chore(scripts): measure picks against a real library's watch history ([1e7b58a](https://github.com/cosmin-sulita/curatorr/commit/1e7b58a))

## 0.8.0 (2026-10-08)

- feat(profiles): give blobatars friendlier shapes in one tone ([e0b0010](https://github.com/cosmin-sulita/curatorr/commit/e0b0010))
- fix(app): keep keyboard focus inside dialogs and return it on close ([4b99426](https://github.com/cosmin-sulita/curatorr/commit/4b99426))
- docs(readme): describe close matches and settings without Plex accurately ([c081cfc](https://github.com/cosmin-sulita/curatorr/commit/c081cfc))
- test(server): check who can call each route ([cf6d1cb](https://github.com/cosmin-sulita/curatorr/commit/cf6d1cb))
- fix(settings): make Restore and Remove easier to tap ([b2939b1](https://github.com/cosmin-sulita/curatorr/commit/b2939b1))
- fix(picks): keep a pick when marking it fails, and refresh the questions after Undo ([6de36bf](https://github.com/cosmin-sulita/curatorr/commit/6de36bf))
- fix(picks): stop waiting on an unreachable Plex server for every pick ([3e9e0ec](https://github.com/cosmin-sulita/curatorr/commit/3e9e0ec))
- fix(sync): sync again when settings change during a sync ([12ee038](https://github.com/cosmin-sulita/curatorr/commit/12ee038))
- fix(picks): keep the same shuffle all evening, turning over at 4 am local time ([ce4d661](https://github.com/cosmin-sulita/curatorr/commit/ce4d661))
- fix(sagas): stop restricted earlier parts from holding back sequels a profile may watch ([a00e839](https://github.com/cosmin-sulita/curatorr/commit/a00e839))
- fix(profiles): ask to pick the profile again when its Plex sign-in stops working ([aabb978](https://github.com/cosmin-sulita/curatorr/commit/aabb978))
- fix(profiles): pause PIN entry after too many wrong tries ([65cc7d8](https://github.com/cosmin-sulita/curatorr/commit/65cc7d8))
- fix(profiles): ask for a protected profile's PIN once on each device ([b588387](https://github.com/cosmin-sulita/curatorr/commit/b588387))
- fix(settings): explain malformed addresses instead of failing ([e00a889](https://github.com/cosmin-sulita/curatorr/commit/e00a889))
- fix(settings): ask for the API key again when Radarr or Seerr moves to a new address ([62bee66](https://github.com/cosmin-sulita/curatorr/commit/62bee66))
- fix(setup): only the Plex account that set up Curatorr can continue setup ([755466e](https://github.com/cosmin-sulita/curatorr/commit/755466e))
- fix(profiles): keep everyone's profiles when Plex Home can't be read ([72587bc](https://github.com/cosmin-sulita/curatorr/commit/72587bc))
- fix(wizard): stop counting a break-in as a slasher movie ([e5b9a46](https://github.com/cosmin-sulita/curatorr/commit/e5b9a46))

## 0.7.0 (2026-10-08)

- fix(wizard): use updated themes and moods as soon as Curatorr restarts ([abba7dc](https://github.com/cosmin-sulita/curatorr/commit/abba7dc))
- feat(wizard): a Moving mood for emotional dramas ([59ec025](https://github.com/cosmin-sulita/curatorr/commit/59ec025))
- feat(wizard): new themes for prison escapes, family dramas, politics and addiction ([3e93bbe](https://github.com/cosmin-sulita/curatorr/commit/3e93bbe))
- fix(wizard): match themes and moods to the right movies ([37ebfa4](https://github.com/cosmin-sulita/curatorr/commit/37ebfa4))
- chore(tags): add a tagging report for real libraries ([308b0a2](https://github.com/cosmin-sulita/curatorr/commit/308b0a2))
- feat(profiles): give people without a Plex photo their own blobatar ([d0db3c1](https://github.com/cosmin-sulita/curatorr/commit/d0db3c1))

## 0.6.2 (2026-10-08)

- fix(app): keep toasts on screen when skipping quickly ([ad3543e](https://github.com/cosmin-sulita/curatorr/commit/ad3543e))
- fix(picks): stop the screen jumping in size when leaving a pick on phones ([0209341](https://github.com/cosmin-sulita/curatorr/commit/0209341))

## 0.6.1 (2026-10-08)

- fix(picks): drop movies you've since watched in Plex without re-picking your profile ([f5c6052](https://github.com/cosmin-sulita/curatorr/commit/f5c6052))
- fix(app): load new versions without closing the app ([30f6b3d](https://github.com/cosmin-sulita/curatorr/commit/30f6b3d))

## 0.6.0 (2026-10-08)

- feat(picks): favour movies you requested in Seerr ([f4ad2dc](https://github.com/cosmin-sulita/curatorr/commit/f4ad2dc))
- feat(picks): suggest movies like one you loved ([143187e](https://github.com/cosmin-sulita/curatorr/commit/143187e))

## 0.5.0 (2026-10-08)

- feat(picks): shuffle the posters before a Surprise me pick lands ([2869aae](https://github.com/cosmin-sulita/curatorr/commit/2869aae))
- docs(readme): describe Watchlist and Surprise me, and add CLAUDE.md ([575eeb7](https://github.com/cosmin-sulita/curatorr/commit/575eeb7))
- fix(profiles): read the PIN lock after the profile's name ([2d33571](https://github.com/cosmin-sulita/curatorr/commit/2d33571))
- fix(app): make the logo and the What's new link easier to tap ([0560df2](https://github.com/cosmin-sulita/curatorr/commit/0560df2))
- fix(picks): keep the first alternative in view after Undo ([af0d667](https://github.com/cosmin-sulita/curatorr/commit/af0d667))
- fix(app): read profile names and loading states properly with VoiceOver ([c31b90a](https://github.com/cosmin-sulita/curatorr/commit/c31b90a))
- fix(wizard): show different posters for each theme ([f86c639](https://github.com/cosmin-sulita/curatorr/commit/f86c639))
- fix(profiles): cover the whole screen behind the PIN pad ([d5a7283](https://github.com/cosmin-sulita/curatorr/commit/d5a7283))
- fix(picks): offer a way forward when you've passed on every match ([2b3cac7](https://github.com/cosmin-sulita/curatorr/commit/2b3cac7))
- fix(picks): keep the desktop buttons together ([8f2ad71](https://github.com/cosmin-sulita/curatorr/commit/8f2ad71))
- fix(picks): line up Other good picks and show their focus ring ([43eb2ad](https://github.com/cosmin-sulita/curatorr/commit/43eb2ad))
- fix(app): make faint text and the main button easier to read ([6117f14](https://github.com/cosmin-sulita/curatorr/commit/6117f14))
- fix(app): only show What's new when there's something new ([57892d9](https://github.com/cosmin-sulita/curatorr/commit/57892d9))
- fix(app): make small buttons easier to tap ([efde7bc](https://github.com/cosmin-sulita/curatorr/commit/efde7bc))
- fix(picks): keep tonight's pick when you go back to an answer ([e334347](https://github.com/cosmin-sulita/curatorr/commit/e334347))
- fix(picks): fade the backdrop out instead of cutting it off ([05771c0](https://github.com/cosmin-sulita/curatorr/commit/05771c0))
- fix(picks): show ratings and the story above the buttons on phones ([fc8016d](https://github.com/cosmin-sulita/curatorr/commit/fc8016d))
- fix(picks): rename Later to Watchlist ([4d229ce](https://github.com/cosmin-sulita/curatorr/commit/4d229ce))
- feat(picks): undo Not tonight and swipes ([f1e5d3f](https://github.com/cosmin-sulita/curatorr/commit/f1e5d3f))
- feat(wizard): go straight to a pick with Surprise me ([370afef](https://github.com/cosmin-sulita/curatorr/commit/370afef))
- feat(wizard): pin Surprise me and Doesn't matter to the bottom of the screen ([ccf7a42](https://github.com/cosmin-sulita/curatorr/commit/ccf7a42))
- docs(readme): describe a generic Docker install ([2701575](https://github.com/cosmin-sulita/curatorr/commit/2701575))

## 0.4.1 (2026-10-08)

- fix(app): keep the page still behind dialogs ([f2152be](https://github.com/cosmin-sulita/curatorr/commit/f2152be))

## 0.4.0 (2026-10-08)

- feat(picks): keep sagas in order and offer to start one ([59cf218](https://github.com/cosmin-sulita/curatorr/commit/59cf218))

## 0.3.2 (2026-10-08)

- fix(app): show what's new on devices updating from before 0.3.0 ([d01b3f4](https://github.com/cosmin-sulita/curatorr/commit/d01b3f4))

## 0.3.1 (2026-10-08)

- chore(ci): run the docker actions on Node 24 ([48117f8](https://github.com/cosmin-sulita/curatorr/commit/48117f8))

## 0.3.0 (2026-10-08)

- feat(app): show what's new after an update ([1e9bcc1](https://github.com/cosmin-sulita/curatorr/commit/1e9bcc1))
- feat(plex): sync Seen it and Later with Plex ([9499669](https://github.com/cosmin-sulita/curatorr/commit/9499669))

## 0.2.1 (2026-10-08)

- fix(plex): open picks in the redesigned Plex apps ([61fd972](https://github.com/cosmin-sulita/curatorr/commit/61fd972))

## 0.2.0 (2026-10-08)

- fix(icons): make the home screen icon full-bleed ([59f8f9f](https://github.com/cosmin-sulita/curatorr/commit/59f8f9f))
- fix(header): clear the iOS status bar blur ([40501f2](https://github.com/cosmin-sulita/curatorr/commit/40501f2))

## 0.1.0 (2026-10-08)

First release.

- Release 0.1.0 ([e694bc6](https://github.com/cosmin-sulita/curatorr/commit/e694bc6))
