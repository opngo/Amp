# Changelog

Amp's releases, newest first. Dates are ISO. The format is plain on purpose: one line per
change, with the reason behind it when the reason is not obvious.

## Unreleased

### The visualizer, again

- **The row of bars comes back down.** It could sit at its loudest point and stay there:
  the fall was tied to the same smoothing constant as the rise, so a high smoothing
  setting turned the decay into a drift, and a band with no signal kept a floor of a
  pixel and a half so the row stayed continuous - a floor which the bloom then picked
  up and amplified into a line drawn across the player. Bars with no signal are not
  drawn at all now, the fall has its own rate, and silence is a hard decay, so the
  drawing always returns to rest.
- **Sensitivity cannot flatten the drawing.** Past a certain setting every band landed
  on 1 at once and the meter became a solid block that had nowhere left to move. The
  level curve flattens towards the top instead of reaching it, so shape survives at
  any sensitivity.
- **The band dissolves instead of ending.** It is masked on both axes - sideways so
  the row has no start and no end, downwards so the baseline is a soft floor rather
  than a drawn edge - and the outer bars taper. The animation that read as a border
  moving along the player is gone.
- Controls that push the drawing to an extreme still leave it moving: the settings
  page can be dragged to 3x sensitivity and 95% smoothing without the meter stopping.

### The sidebar, aligned

- **One column of 40px tiles in the rail.** Every control is the same width and every
  icon is centred inside its tile, so the rail reads as a single line of targets
  instead of rows that were each centred in whatever space was left.
- **Folders in the rail are their colour dot.** The delete button is a hover action in
  the full sidebar and is not in the rail at all: a destructive control next to a row
  of icons, reachable by a stray click, is not worth the two pixels it saves.
- **The middle of the sidebar scrolls, the ends do not.** The groups between the search
  field and the tools take the room that is left; a library with forty folders pushes
  them, not the Settings row.

### Scrollbars that fade

- **A thumb appears while it is being used.** Every scrollable panel draws its
  scrollbar only during a scroll (the document carries `data-scrolling` for a moment
  after the last event) and while the pointer is over a panel that can scroll. The
  track is always transparent and always reserved, so nothing shifts when the thumb
  fades in or out.

### Downloads actually reach the library

- **The finished file that imported as zero books.** qBittorrent describes a torrent
  twice - the folder it downloaded into, and the path of the torrent itself - and the
  files inside are named relative to the torrent's own root. Amp joined the wrong pair,
  looked at a path that did not exist, and reported a download that was plainly on disk
  as unreadable. Every plausible path is tried now, first one that exists wins, in both
  the desktop host and the Python one.
- **A missing member no longer fails the whole import.** A torrent that says it is
  finished is not always all there: sampled audio, a companion PDF, an interview. The
  files that are present are imported and the rest are named in a warning. m4b wins over
  the split mp3s of the same book, so a torrent carrying both imports once.
- **The switch that did nothing.** "Import finished downloads into the library" had no
  watcher behind it: a finished book sat in the transfer list until somebody pressed a
  button. Downloads now watches while its page is open, imports each finished transfer
  once, and says so in the library rather than in a toast per file.
- **"0 books imported" has three meanings and the interface now tells them apart.** The
  import result carries how many files it found and how many were new, and every place
  that reports an import - the add menu, the drag and drop, the download rows - says
  which of them happened: nothing to import there, already on the shelf, or a file that
  could not be read.
- **A dropped `.torrent` is a download, not a book.** It used to be handed to the audio
  importer, which found no audio in it and reported zero books. Torrent files now go to
  qBittorrent and appear in Downloads, from a drop or from "Open a .torrent file" in the
  add menu and on the downloads page.

### One player, not two

- **The now playing page and the immersive overlay were both mounted at once.** With the
  route on the player and fullscreen switched on, the same surface rendered twice - two
  canvases animating, two chapter lists, every row twice in the accessibility tree - which
  is why a probe counting rows saw ten where the book had five. The route now steps aside
  while the overlay is up.

### More of the app lives in the tray

- **The tray menu carries the transport**: play and pause, back and forward by the
  configured skip, previous and next chapter, previous and next book, add bookmark, the
  sleep timer, show or hide the window, open the player, the mini player, always on top,
  import a folder, and Quit. Its tooltip names what is playing and where it has reached.
- **Settings has a tray card** that says what the menu holds, keeps the two on-top
  switches in one place, and can show Amp from anywhere or send it back to the tray.

### The player

- **The around-cover shape is circles.** It had become an outline that bulged with
  the spectrum and a highlight that chased each ring on a timer of its own, which
  read as an oval pulsing across the screen rather than waves around the artwork.
  The rings are circles centred on the cover now - the innermost one clears the
  square corner - they move only with the audio, and the whole set is scaled to
  fit the canvas so a ring can never be clipped into a crescent.
- **The visualizer draws even when there is no analyser.** A blank canvas during
  the wait for the first click looked exactly like a broken visualizer. The quiet
  version of the chosen shape is drawn instead, at a resting level, and the
  canvas is never empty.
- **The visualizer keeps working on machines that refuse the effects graph.** The
  audio element can report its own output through `captureStream()` without being
  captured by an AudioContext, so the visualizer analyses that in a separate
  graph: no equalizer, but real levels. The Settings card says which of the two
  is running instead of reporting both as off.
- **The chapter list scrolls.** Long books pushed their rows past the window with
  nothing to scroll: the column is now a fixed height with the list scrolling
  inside it, and the footer stays visible.
- **Leaving a chapter any way at all leaves a note.** Scrubber, chapter row and
  chapter dropdown now remember the stop, not just the next/previous buttons, so
  "Continue with the remaining" is offered for every chapter you step out of.


### Playback repairs itself

- **A stop nobody asked for is repaired in place.** If the element goes quiet while the listener
  still expects sound - a settings change that rebuilt the effects graph, an output device that
  disappeared, a driver that dropped the stream - Amp reloads the same chapter at the position it
  reached, instead of waiting for a chapter change. The transport keeps what the listener wanted
  (`desiredPlaying`) rather than what the element is doing, and a two-second watchdog plus the
  engine's own hooks (settings writes, window focus, an unexpected pause event) start the repair.
  The chapter does not move and the position does not reset: the same sentence carries on after a
  short gap.
- **`AudioEngine.recover(reason)`** is the engine half: it resumes a suspended context (and the
  fallback analyser's context) before deciding anything, rebuilds on a fresh element when the
  element really is stopped, and writes a line into the audio diagnostics log either way, so
  Settings can say what happened instead of guessing.
- The store exposes the same thing as `heal(reason)`, with a floor of one attempt every 1.5 s and
  a grace window after a chapter change, so the watchdog can never fight a load that is already in
  flight.
- **A pause the app asked for is not a failure.** The engine fires "paused" either way, so the
  store now records when it stopped the sound itself - pressing pause, the sleep timer fading out,
  a book that ran out, stop-after-chapter - and only repairs a pause that nobody asked for. The
  intent is a timestamp rather than a flag, so a stop that never produced its event cannot swallow
  a later real failure.
- **The repair keeps the chapter.** Reloading happens at the position that was reached, inside the
  chapter being read, at the same speed; a stop after ten seconds comes back after ten seconds,
  not at the end of the chapter and not one chapter on.

### The context menu, and the tokens behind it

- **The right-click panel asked for tokens that did not exist.** `--amp-surface` and
  `--amp-text-1` were never defined anywhere: the stylesheet dropped those declarations, so the
  menu rendered as a translucent white sheet with near-white text whenever the app was in dark
  mode. It now uses the panel and text tokens the rest of the UI uses, and both `--amp-surface`
  and `--amp-text-1` are gone.
- **A missing token is now a test failure.** `tokens.test.ts` reads every stylesheet, collects
  every `var(--amp-...)` use and fails when a token is neither declared, written by `applyTheme`
  at runtime, nor used with its own fallback. Silent CSS drops are exactly the kind of bug that
  survives screenshots.
- `--amp-danger` is defined per theme (a dark red on the light theme, a lighter one on the dark),
  so destructive rows keep their meaning in both, and the "no colour" swatch is drawn from the
  theme's fill tokens instead of two hard-coded greys.

### The audio graph

- **A suspended context is no longer read as a refusal.** Opening Amp does not
  count as touching the page, so the first book started by itself, or from a
  window that opened at sign-in, found the audio context suspended. `resume()`
  rejects without a user gesture, the rejection was caught by the graph builder,
  and the graph was thrown away for the rest of the session - the equalizer and
  the visualizer stayed off and the interface said the system had refused the
  effects graph. Amp now keeps the graph and starts it on the next click, key
  press or touch, and says "waiting for your first click" while it waits.

### Startup

- **Start on startup**, in Settings > Playback, with "start into the tray" as a
  second switch. The main process writes the login item (`applyLoginItem`) and
  the interface reads back what the operating system reports rather than what
  was asked for. A launch that came from the login item with "start hidden"
  opens straight into the tray.


### The mark

- **The logo is the player's own shape.** Five bars became a cover square with circles riding
  around it - the same picture the around-cover visualizer draws - so the icon says what the app
  does rather than what any audio app does. `scripts/make-icons.mjs` renders it as a distance
  field, so the tray icon, the app icon and the vector file are one geometry; the mark simplifies
  as it shrinks (three rings at icon sizes, one on the tray, the cover square alone below 48 px),
  because hairlines turn into mud at 32 px. `AmpLogo` in `packages/ui` draws the same geometry
  inline on the same 512-unit grid, which is what keeps the sidebar and the icon from drifting
  apart.

- Covers and banners share one resolver (`apps/renderer/src/platform/artwork.ts`). Order: picked
  image, then remote or host URL, then a path that is already a URL, then the host over HTTP by
  book id, then the desktop bridge, then the raw value. Covers and banners can no longer drift
  apart, and the rules are unit tested.
- A Windows path (`C:\Users\...`) is no longer mistaken for a URL. A drive letter matched the
  old "is this a URL" test, so the raw path was handed to the page and no cover and no audio
  ever loaded on Windows. Paths and URLs are now told apart with an explicit scheme whitelist
  (`packages/core/src/media.ts`).
- Banners load on Windows and over a network too: the metadata editor and the picker preview no
  longer put a raw path in an `img`.
- A banner chosen from a URL survives saving. The browser client used to strip `coverUrl` and
  `bannerUrl` on every save, because those fields were doing double duty as display-only values,
  so the artwork the user picked was silently dropped.
- The host stores artwork the interface picks: `POST /api/cover` (with `which=banner`) takes
  inline bytes or a URL to fetch, writes one image per book per kind, and answers with the path
  it stored. `POST /api/cover/extract` pulls the embedded cover out of the audio file.
- `GET /api/cover?which=banner` serves the wide image from the banner cache, the file the book
  points at, or a 404 for an unknown book. Asking for a cover of an unknown book used to
  answer 500.
- The Python library keeps `coverUrl`, `coverDataUrl`, `bannerPath`, `bannerUrl` and
  `bannerDataUrl` through a round trip; it dropped them on save.
- The cover and banner search reports results, emptiness and failures, and searches on Enter.
- A page served by Amp itself resolves artwork through `/api/cover` rather than the audio route.

### The immersive player

- The player is one surface now, and it fills the window. `FullPlayer` replaces the old page, in
  two forms from the same code: `variant="page"` on the Now playing route, and
  `variant="overlay"` over everything else, opened from the bottom bar, from `F`, or from the
  overflow menu. The bottom bar steps aside while it is open, and `Escape` or the top-left
  button closes it without moving the page underneath.
- Closing it asks about the tray. A window that is about to go away while a book is being read
  offers "Add to the tray" in the notice instead of silently hiding or silently quitting.
- Speed and volume live in one corner control that folds away until it is wanted. It unfolds
  into a flyout panel (speed, volume, output device, equalizer switch and curve) anchored
  bottom-right, the way a system flyout behaves: it opens from its own chip, closes on `Escape`
  or on a click outside, and takes no space when it is shut. Escape closes it first and the
  player second, so one keypress never loses the player a listener was watching.
- Behind it: three slow orbs carrying the cover's colours, a sheen that crosses the surface
  every half minute, the artwork floating on a 14-second cycle, a title that rises into place,
  and a ring that breathes out of the play button while the book is running. All of it is CSS,
  all of it stops under `prefers-reduced-motion`.
- The layout is measured against the window: the columns stack under 1000px, the type scales
  with a clamp, and under 620px by 460px - a flyout window - the same surface becomes the
  compact form: cover, title, transport, the corner, and nothing else.
- "Show as a flyout" puts the window in the bottom-right corner of the work area as a small
  always-on-top window next to the tray (`windows.ts`, `flyout` action on `player:window`),
  without recreating the window or interrupting playback. A browser answers the same command
  with real fullscreen, which is the closest thing a tab has.

### The visualizer

- Two new shapes: **Aurora** (ribbons of light drifting over each other, drawn in `lighter` mode
  so the overlaps build up) and **Orbit** (the spectrum bent into a halo that turns at the speed
  the new rotation control sets).
- The ring around the cover was rebuilt. Its contour is sampled in proportion to each piece of
  the outline, so a long edge carries real samples instead of a straight line through a moving
  spectrum; every ring is rounder than the cover and rounder than the one inside it; the alpha
  falls away steeply outward with a decay control of its own; and a highlight travels around it
  so the shape is alive between two sentences. The push is capped against the artwork's own
  width, so a 116px cover in the flyout gets a halo rather than a blob.
- Peak caps, a reflection under the bars, a soft fill under the wave and a glow strength control
  are all new, and all of them are settings. The wave's level curve is compressed, because
  speech spends most of its time well under full scale and a faithful mapping draws a flat line.
- The free-standing shapes (wave, bars, mirror, aurora) draw in their own band under the artwork
  instead of across the transport, where a row of bars through the play button was unreadable.
  The ring and the halo stay where they belong, around the cover.
- The glow pass copies the canvas at its own size. Under a 2x device pixel ratio the old pass
  drew the copy at double scale, which read as a smear rather than a halo.
- Settings carries every option, in the same place it always was: shape, lines, thickness,
  offset, sensitivity, smoothing, opacity, glow strength, decay, halo turn, mirrored, fill, peak
  caps and reflection, over a live preview that uses the drawing code itself.

### Audio that keeps playing

- A folder of tracks no longer stops at the first chapter boundary. The browser pauses the media
  element when a file ends and fires `ended` a moment later, and swapping in the next file
  flushes one more `ended` from the file that just went away. Both events were reported as real,
  so the player either stopped on the boundary or skipped a chapter. Media events that the
  element caused itself - the pause that comes with the end of a file, the pause and `ended`
  that a source change leaves behind - are now filtered in `audioEngine.ts`, with the reasoning
  written down.
- `load()` and `play()` address the element that is live after the effects graph was built, not
  the one they captured before it. A refused graph hands playback to a fresh element, and the
  old handle meant calling `play()` on an element that was no longer on screen: the
  silent-player bug that needed a relaunch.
- A `play()` that is aborted because another file was loaded is the normal case of moving
  between files, and is no longer reported as a playback failure.
- Settings gained an Audio effects card: it reports whether the equalizer and the visualizer are
  running, explains a refused graph, and rebuilds it on request. The engine raises a `graph`
  event so the card is a state rather than a poll.

### Library

- A right click opens the context menu and nothing else. It used to set the selected book as
  well, so the menu came with the book page behind it, and closing the menu left the book open.

### Developer notes

- `window.__amp` exposes the stores and the audio engine (with its diagnostics ring buffer) in
  every build. Amp is a local application: the window that runs the interface is the one
  somebody debugs, and a question about the library or the graph is answered in the console
  instead of guessed at.
- `F` is a new shortcut ("Immersive player") in the Player group, and it is editable with the
  rest.

### Playback on Windows and in the desktop app

- Audio and covers now load in the desktop app. The player reads media with
  `crossOrigin = "anonymous"` (WebAudio needs untainted samples for the equalizer), which makes
  every request a CORS request, and the `amp-media://` scheme sent no CORS headers and was not
  registered as CORS-enabled. Chromium refused every response and reported it as "no supported
  source was found" - the same message as a missing codec, so a book on disk that was perfectly
  playable looked like an unsupported format.
- A failed load says what actually happened. `MEDIA_ERR_SRC_NOT_SUPPORTED` is no longer
  explained as a codec problem when this build has the codec: it reports that Amp could not read
  the file, naming it, which is what a moved file or a refused response deserves.
- Range requests are handled properly, so seeking works: suffix ranges (`bytes=-500`) were read
  as "the first 501 bytes", an open range past the end of a file produced a negative length, and
  a request for bytes past the end is now a 416 with `Content-Range: bytes */size`.
- The remote server's `/api/audio` and `/api/cover` carry CORS headers and the range metadata a
  client needs to seek, and its JSON replies do too.
- A media request for a file that is missing or unreadable is written to the app log with the
  path and the reason, so a book that moved is findable instead of invisible.

### Keyboard

- Bare shortcuts are no longer registered globally. A `P` or `Space` grabbed by the OS never
  reaches the window, which is why they appeared to do nothing while the app was running. Only
  modifier combinations and media keys go to the OS; the rest stay in-app
  (`GLOBAL_SHORTCUT_IDS`, `isSafeGlobalAccelerator`).
- The player bar stays usable at narrower widths: speed, volume, time and the chapter select
  drop out in that order (breakpoints at 1560, 1400, 1240 and 1120), and the chapter select is
  never clipped.

### Browse

- Authors, Narrators, Series, Genres, Tags and Colour tags have their own tab, with real counts
  and a running time per entry. They used to expand inside the sidebar and lead nowhere.

### Installing and building

- `npm ci` no longer prunes `@electron-internal/extract-zip`, which Electron's installer needs.
  A fresh clone ended up with no Electron binary and "Electron uninstall" on launch.
- Electron is declared at the workspace root as well, so `electron-vite` finds it. It used to be
  nested under `apps/desktop`, and `electron-vite build` failed with
  `Cannot find module 'electron/package.json'`.
- CI and the release workflow run Node 22. Electron 44 asks for 22.12 or newer; on Node 20 the
  toolchain warns with `EBADENGINE` and packaging is unsupported.
- `npm run doctor` looks for packages where npm actually puts them, reports the Electron binary
  it finds, and explains the Node requirement instead of calling Node 20 fully supported.
- **The landing page is static.** `apps/website` left the npm workspaces: it is `index.html`, one
  stylesheet and two plain scripts, with no dependencies, no bundler and no build step. The ASCII
  art - the drifting background field, the section rules, the wordmarks, the app window drawn in
  box characters, the visualizer - is generated in the browser from sine fields and one canvas
  read-back. `npm run site:check` stands in for the build in CI: it checks that every reference in
  the markup resolves, that every id the script reaches for exists, and that nothing is loaded
  from another origin. The Pages workflow publishes the folder as it stands.
- **The site is ASCII first.** The source terminal sits next to the hero and types the clone,
  install and build commands out one character at a time; the page's texture is a field of
  characters rather than a gradient; the app itself is drawn - live - in box characters, with the
  chapter list set like a table of contents and the equalizer dancing in the bottom bar.
