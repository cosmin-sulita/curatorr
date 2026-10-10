# Changelog

The commits in each version of Curatorr, newest first.

## 0.10.0 (2026-10-10)

- feat(setup): connect Seerr while setting up, or skip it ([0dfaabf](https://github.com/cosmin-sulita/curatorr/commit/0dfaabf))
- feat(app): suggest adding Curatorr to the home screen on phones ([a1888eb](https://github.com/cosmin-sulita/curatorr/commit/a1888eb))
- feat(picks): let Surprise me draw from the ten best picks, new each evening ([cb4b35c](https://github.com/cosmin-sulita/curatorr/commit/cb4b35c))
- fix(picks): count a new arrival from when its file arrived, not when it was requested ([c5c53a8](https://github.com/cosmin-sulita/curatorr/commit/c5c53a8))
- fix(app): open What's new once the screen behind has loaded ([86b9229](https://github.com/cosmin-sulita/curatorr/commit/86b9229))
- refactor(picks): drop the unused Rotten Tomatoes review-count adjustment ([d801824](https://github.com/cosmin-sulita/curatorr/commit/d801824))
- fix(wizard): keep 20th-century biopics out of Historical Epics ([1037821](https://github.com/cosmin-sulita/curatorr/commit/1037821))
- fix(wizard): don't read "haunted by his past" as a ghost story ([c2c0c1b](https://github.com/cosmin-sulita/curatorr/commit/c2c0c1b))
- fix(wizard): stop calling every missing-person story a whodunit ([df03797](https://github.com/cosmin-sulita/curatorr/commit/df03797))

## 0.9.0 (2026-10-09)

- chore(git): ignore brag-output folders ([523691a](https://github.com/cosmin-sulita/curatorr/commit/523691a))
- fix(settings): stop offering a switch to hide the owner's profile ([c0d8755](https://github.com/cosmin-sulita/curatorr/commit/c0d8755))
- fix(app): make a few small controls easier to tap ([0d3cfbc](https://github.com/cosmin-sulita/curatorr/commit/0d3cfbc))
- fix(app): show the outline of a switch that's off ([b9836e6](https://github.com/cosmin-sulita/curatorr/commit/b9836e6))
- fix(picks): name Rotten Tomatoes for screen readers ([7439462](https://github.com/cosmin-sulita/curatorr/commit/7439462))
- fix(wizard): make the dots for questions still to come visible ([eedb495](https://github.com/cosmin-sulita/curatorr/commit/eedb495))
- fix(picks): show the ratings above the action bar on small phones ([8ecd97c](https://github.com/cosmin-sulita/curatorr/commit/8ecd97c))
- fix(picks): keep the header and small text readable over bright backdrops ([490b290](https://github.com/cosmin-sulita/curatorr/commit/490b290))
- fix(app): undo a mark or skip with Ctrl+Z or ⌘Z ([c67c77d](https://github.com/cosmin-sulita/curatorr/commit/c67c77d))
- fix(picks): keep keyboard focus on the button you pressed between picks ([0e08a1a](https://github.com/cosmin-sulita/curatorr/commit/0e08a1a))
- fix(settings): move switches as soon as you tap them ([7f6d14c](https://github.com/cosmin-sulita/curatorr/commit/7f6d14c))
- fix(app): keep the screen when Curatorr can't be reached for a moment ([d866af4](https://github.com/cosmin-sulita/curatorr/commit/d866af4))
- fix(picks): keep a pick's buttons in view on laptop-sized windows ([bf8ca81](https://github.com/cosmin-sulita/curatorr/commit/bf8ca81))
- fix(settings): confirm Restore and Remove, and offer Undo ([4be0c3c](https://github.com/cosmin-sulita/curatorr/commit/4be0c3c))
- fix(setup): stop connecting Plex from ending at an error with no way forward ([2880507](https://github.com/cosmin-sulita/curatorr/commit/2880507))
- fix(app): keep the What's new button full size when there are many notes ([2e3f65e](https://github.com/cosmin-sulita/curatorr/commit/2e3f65e))
- fix(picks): show the next pick from the top after scrolling down ([e28ef31](https://github.com/cosmin-sulita/curatorr/commit/e28ef31))
- feat(picks): lean toward what each person watched lately ([c455393](https://github.com/cosmin-sulita/curatorr/commit/c455393))
- feat(picks): rotate picks you keep passing over ([0011ab2](https://github.com/cosmin-sulita/curatorr/commit/0011ab2))
- feat(picks): favour movies that just arrived in the library ([c5620ea](https://github.com/cosmin-sulita/curatorr/commit/c5620ea))
- chore(scripts): measure picks against a real library's watch history ([1702a4b](https://github.com/cosmin-sulita/curatorr/commit/1702a4b))

## 0.8.0 (2026-10-08)

- feat(profiles): give blobatars friendlier shapes in one tone ([5b58ccc](https://github.com/cosmin-sulita/curatorr/commit/5b58ccc))
- fix(app): keep keyboard focus inside dialogs and return it on close ([501ab14](https://github.com/cosmin-sulita/curatorr/commit/501ab14))
- docs(readme): describe close matches and settings without Plex accurately ([bbaf0b4](https://github.com/cosmin-sulita/curatorr/commit/bbaf0b4))
- test(server): check who can call each route ([c8fe516](https://github.com/cosmin-sulita/curatorr/commit/c8fe516))
- fix(settings): make Restore and Remove easier to tap ([6339b98](https://github.com/cosmin-sulita/curatorr/commit/6339b98))
- fix(picks): keep a pick when marking it fails, and refresh the questions after Undo ([085ba29](https://github.com/cosmin-sulita/curatorr/commit/085ba29))
- fix(picks): stop waiting on an unreachable Plex server for every pick ([1068fe0](https://github.com/cosmin-sulita/curatorr/commit/1068fe0))
- fix(sync): sync again when settings change during a sync ([22f80ec](https://github.com/cosmin-sulita/curatorr/commit/22f80ec))
- fix(picks): keep the same shuffle all evening, turning over at 4 am local time ([d164e2d](https://github.com/cosmin-sulita/curatorr/commit/d164e2d))
- fix(sagas): stop restricted earlier parts from holding back sequels a profile may watch ([9c2cdd6](https://github.com/cosmin-sulita/curatorr/commit/9c2cdd6))
- fix(profiles): ask to pick the profile again when its Plex sign-in stops working ([5e52d3e](https://github.com/cosmin-sulita/curatorr/commit/5e52d3e))
- fix(profiles): pause PIN entry after too many wrong tries ([ae7edaa](https://github.com/cosmin-sulita/curatorr/commit/ae7edaa))
- fix(profiles): ask for a protected profile's PIN once on each device ([1f4d5db](https://github.com/cosmin-sulita/curatorr/commit/1f4d5db))
- fix(settings): explain malformed addresses instead of failing ([e3d13e7](https://github.com/cosmin-sulita/curatorr/commit/e3d13e7))
- fix(settings): ask for the API key again when Radarr or Seerr moves to a new address ([213e926](https://github.com/cosmin-sulita/curatorr/commit/213e926))
- fix(setup): only the Plex account that set up Curatorr can continue setup ([dd74379](https://github.com/cosmin-sulita/curatorr/commit/dd74379))
- fix(profiles): keep everyone's profiles when Plex Home can't be read ([025490a](https://github.com/cosmin-sulita/curatorr/commit/025490a))
- fix(wizard): stop counting a break-in as a slasher movie ([be21abe](https://github.com/cosmin-sulita/curatorr/commit/be21abe))

## 0.7.0 (2026-10-08)

- fix(wizard): use updated themes and moods as soon as Curatorr restarts ([088d615](https://github.com/cosmin-sulita/curatorr/commit/088d615))
- feat(wizard): a Moving mood for emotional dramas ([83fb9b6](https://github.com/cosmin-sulita/curatorr/commit/83fb9b6))
- feat(wizard): new themes for prison escapes, family dramas, politics and addiction ([0472567](https://github.com/cosmin-sulita/curatorr/commit/0472567))
- fix(wizard): match themes and moods to the right movies ([89ead3a](https://github.com/cosmin-sulita/curatorr/commit/89ead3a))
- chore(tags): add a tagging report for real libraries ([5298076](https://github.com/cosmin-sulita/curatorr/commit/5298076))
- feat(profiles): give people without a Plex photo their own blobatar ([d389d6b](https://github.com/cosmin-sulita/curatorr/commit/d389d6b))

## 0.6.2 (2026-10-08)

- fix(app): keep toasts on screen when skipping quickly ([146ab83](https://github.com/cosmin-sulita/curatorr/commit/146ab83))
- fix(picks): stop the screen jumping in size when leaving a pick on phones ([88a2591](https://github.com/cosmin-sulita/curatorr/commit/88a2591))

## 0.6.1 (2026-10-08)

- fix(picks): drop movies you've since watched in Plex without re-picking your profile ([d5341ed](https://github.com/cosmin-sulita/curatorr/commit/d5341ed))
- fix(app): load new versions without closing the app ([72b1877](https://github.com/cosmin-sulita/curatorr/commit/72b1877))

## 0.6.0 (2026-10-08)

- feat(picks): favour movies you requested in Seerr ([0c2ad15](https://github.com/cosmin-sulita/curatorr/commit/0c2ad15))
- feat(picks): suggest movies like one you loved ([d479d7b](https://github.com/cosmin-sulita/curatorr/commit/d479d7b))

## 0.5.0 (2026-10-08)

- feat(picks): shuffle the posters before a Surprise me pick lands ([9795ba9](https://github.com/cosmin-sulita/curatorr/commit/9795ba9))
- docs(readme): describe Watchlist and Surprise me, and add CLAUDE.md ([7b0c9d2](https://github.com/cosmin-sulita/curatorr/commit/7b0c9d2))
- fix(profiles): read the PIN lock after the profile's name ([ca9283a](https://github.com/cosmin-sulita/curatorr/commit/ca9283a))
- fix(app): make the logo and the What's new link easier to tap ([02833f2](https://github.com/cosmin-sulita/curatorr/commit/02833f2))
- fix(picks): keep the first alternative in view after Undo ([dceda2e](https://github.com/cosmin-sulita/curatorr/commit/dceda2e))
- fix(app): read profile names and loading states properly with VoiceOver ([ea40476](https://github.com/cosmin-sulita/curatorr/commit/ea40476))
- fix(wizard): show different posters for each theme ([cd18478](https://github.com/cosmin-sulita/curatorr/commit/cd18478))
- fix(profiles): cover the whole screen behind the PIN pad ([925eb3c](https://github.com/cosmin-sulita/curatorr/commit/925eb3c))
- fix(picks): offer a way forward when you've passed on every match ([3a5a91b](https://github.com/cosmin-sulita/curatorr/commit/3a5a91b))
- fix(picks): keep the desktop buttons together ([9ff2b5c](https://github.com/cosmin-sulita/curatorr/commit/9ff2b5c))
- fix(picks): line up Other good picks and show their focus ring ([1c1486c](https://github.com/cosmin-sulita/curatorr/commit/1c1486c))
- fix(app): make faint text and the main button easier to read ([1d43603](https://github.com/cosmin-sulita/curatorr/commit/1d43603))
- fix(app): only show What's new when there's something new ([7774f55](https://github.com/cosmin-sulita/curatorr/commit/7774f55))
- fix(app): make small buttons easier to tap ([98d4ef9](https://github.com/cosmin-sulita/curatorr/commit/98d4ef9))
- fix(picks): keep tonight's pick when you go back to an answer ([2a7653a](https://github.com/cosmin-sulita/curatorr/commit/2a7653a))
- fix(picks): fade the backdrop out instead of cutting it off ([b6f0d4f](https://github.com/cosmin-sulita/curatorr/commit/b6f0d4f))
- fix(picks): show ratings and the story above the buttons on phones ([57d4412](https://github.com/cosmin-sulita/curatorr/commit/57d4412))
- fix(picks): rename Later to Watchlist ([2004bf2](https://github.com/cosmin-sulita/curatorr/commit/2004bf2))
- feat(picks): undo Not tonight and swipes ([fc437af](https://github.com/cosmin-sulita/curatorr/commit/fc437af))
- feat(wizard): go straight to a pick with Surprise me ([8e1ad24](https://github.com/cosmin-sulita/curatorr/commit/8e1ad24))
- feat(wizard): pin Surprise me and Doesn't matter to the bottom of the screen ([b712a29](https://github.com/cosmin-sulita/curatorr/commit/b712a29))
- docs(readme): describe a generic Docker install ([263e6b2](https://github.com/cosmin-sulita/curatorr/commit/263e6b2))

## 0.4.1 (2026-10-08)

- fix(app): keep the page still behind dialogs ([2ee2ad9](https://github.com/cosmin-sulita/curatorr/commit/2ee2ad9))

## 0.4.0 (2026-10-08)

- feat(picks): keep sagas in order and offer to start one ([1306b5c](https://github.com/cosmin-sulita/curatorr/commit/1306b5c))

## 0.3.2 (2026-10-08)

- fix(app): show what's new on devices updating from before 0.3.0 ([c6e3485](https://github.com/cosmin-sulita/curatorr/commit/c6e3485))

## 0.3.1 (2026-10-08)

- chore(ci): run the docker actions on Node 24 ([a3fe4c8](https://github.com/cosmin-sulita/curatorr/commit/a3fe4c8))

## 0.3.0 (2026-10-08)

- feat(app): show what's new after an update ([4e2227d](https://github.com/cosmin-sulita/curatorr/commit/4e2227d))
- feat(plex): sync Seen it and Later with Plex ([68cd9c6](https://github.com/cosmin-sulita/curatorr/commit/68cd9c6))

## 0.2.1 (2026-10-08)

- fix(plex): open picks in the redesigned Plex apps ([fd564ac](https://github.com/cosmin-sulita/curatorr/commit/fd564ac))

## 0.2.0 (2026-10-08)

- fix(icons): make the home screen icon full-bleed ([d820993](https://github.com/cosmin-sulita/curatorr/commit/d820993))
- fix(header): clear the iOS status bar blur ([1a4e48e](https://github.com/cosmin-sulita/curatorr/commit/1a4e48e))

## 0.1.0 (2026-10-08)

First release.

- Release 0.1.0 ([ee95770](https://github.com/cosmin-sulita/curatorr/commit/ee95770))
