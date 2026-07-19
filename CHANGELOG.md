# Changelog

All notable changes to this project are logged here, newest first.

## 2026-07-19
- Changed: `markCriticalEnds` replaced with `markHeadPriority` — first 40 pieces only (no tail preload);
  tail is handled reactively on VLC's Range request.
- Changed: head budget from 20 to 40 pieces (~10 MB) for modern 1080p/4K bitrates.
- Added: `waitForHeadReady()` gate — waits up to 4s for first ~10 MB verified in the chunk store.
- Added: reactive priority bump in HTTP handler for VLC Range requests.
- Added: stale prefetch stream cancellation on large seeks (>5 MB).
- Changed: HTTP headers include `Connection: keep-alive` / `Keep-Alive`.
- Changed: VLC `--network-caching` from 300 to 1000.
- Added: four-stage progress dialog with health hints over IPC.
- Fixed: HTTP handler was missing `res.writeHead(statusCode, headers)`.
- Added: browser extension (Brave) now shows a centered progress overlay when a magnet is clicked; polls `/status` endpoint on the localhost server for stage/percentage/hint updates until VLC launches. No more silent clicks.
- Added: TPB magnets now append public HTTP trackers (opentrackr, openbittorrent, coppersurfer) in
  addition to the WebSocket trackers, so more TPB torrents find peers.
- Added: TPB results whose `info_hash` is not a valid 40-char hex string are skipped, avoiding dead magnets.
- Changed: metadata-fetch timeout reduced from 60s to 10s for faster failure feedback; status now reads
  "Connecting to peers (10s timeout)…" instead of "Fetching metadata…".
- Optimized: VLC starts faster — subtitles now download in the background (no longer block VLC launch),
  the selected video pre-fetches its first ~2 MB before VLC connects, and VLC is launched with
  `--network-caching=300` for a quicker initial buffer.
- Optimized: the HTTP stream server is created once and reused across file switches (no per-play port rebind).
- Fixed: stream-server race where the first play of a session handed VLC an invalid
  `http://127.0.0.1:0/stream` URL (port was read before the async `listen` resolved); `streamFile` now
  awaits server readiness before building the URL.

## 2026-07-18 (UI)
- Fixed: YTS movie posters/covers were blocked by the Content-Security-Policy (`default-src 'self'`);
  added `img-src 'self' https:` to renderer.html so external cover images now load.
- Changed: search results now render in a horizontal-scrolling row instead of a vertical grid, so the
  page layout stays clean regardless of result count.
- Added: results show 5 at a time with a "Load More ▸" button that reveals 5 more per click and scrolls
  the row to the newly loaded cards (no vertical page growth).
- Fixed: result-card width is fixed (220px, no shrink) so cards keep a consistent poster shape.

## 2026-07-18
- Added: 🌐 1337x via Brave — header button launches 1337x.to in an isolated Brave profile with a
  sideloaded MV3 extension (`brave-extension/`) that intercepts magnet clicks and streams them into the app.
- Added: localhost magnet server on `127.0.0.1:43161` — receives `?uri=<magnet>` from the Brave extension,
  resolves metadata, auto-picks the best video, streams it, and launches VLC with subtitles.
- Added: app registers as the `magnet:` protocol handler only while running (unregistered on quit), so
  clicking a magnet in any browser loads it into the app; system default is restored on close.
- Fixed: auto-play reported "No video file found in torrent" for single-file torrents (e.g. a lone MP4).
  Root cause: a duplicate `pickBestVideo` (index-returning) shadowed the file-object version, and the
  magnet-server check `if (!best) throw` wrongly fired on index 0 (`!0 === true`). Removed the duplicate.
- Fixed: `handleIncomingMagnet` (OS-level magnet handler) now uses the selected file's `.index` after the
  `pickBestVideo` dedupe, so it auto-streams + plays instead of silently no-op'ing.
- Removed: duplicate index-returning `pickBestVideo` in `main.js` (the file-object version is the single source).

## 2026-07-17
- Added: Initial MVP — Electron app with magnet/.torrent loading via webtorrent
- Added: File tree UI with video filtering and click-to-stream
- Added: Local HTTP stream server piping the selected file via `file.createReadStream()`
- Added: VLC auto-launch with Windows path detection and manual path picker
- Added: Cleanup on new load / app close and basic error handling
- Added: Settings (⚙) — save mode toggle (Memory vs Disk) and download folder picker
- Added: Disk mode writes torrent to a per-torrent subfolder; quit dialog asks keep/delete files
- Added: HTTP Range/seek support (206 Partial Content) so VLC forward/backward scrubbing works
- Fixed: VLC seeking restarting from beginning (server now honors `Range` headers)
- Added: Keyword movie search via YTS provider (`providers.js`) with poster grid + click-to-load
- Added: Result ranking by seeders/rating preferring 1080p, min-seeders filter; query relevance preserved
- Added: Torrent-URL loader (YTS returns .torrent links, not always magnets) with redirect following
- Added: Provider #2 — TPB (The Pirate Bay via apibay.org) for TV shows + general search
- Added: Source toggle in search UI (YTS / TPB) so results don't mix; TPB builds magnets from info_hash
- Added: Category labels (TV/Movies/…) on TPB results; seeders-only ranking where no rating exists
- Fixed: "File index out of range" when playing a second video — file tree is now cleared at load
  start and only re-rendered after metadata, with a load-token guarding stale resolves
- Fixed: Harmless "Writable stream closed prematurely" errors spammed on VLC seek/stop — now
  treated as expected client disconnects and not logged
- Fixed: Magnet input now routes http(s) .torrent URLs to the torrent-URL loader (no "Invalid magnet")
- Added: UX — manual magnet/.torrent loader hidden during active search, shown when search box cleared
- Added: UX — single click result shows file tree; double click auto-picks best video & launches VLC
- Added: Auto-detect best video (largest non-junk; ignores Sample/RARBG/trailer) for double-click
- Added: Subtitle auto-download + auto-load into VLC via --sub-file (matching .srt/.ass/.sub/.vtt by name)
- Fixed: Crash `Cannot read properties of undefined (reading 'replace')` in sanitize() when a
  torrent has no name at metadata time (fallback to infoHash / 'torrent')
- Fixed: Manual magnet/.torrent bar AND drop-zone now hide during active search (CSS [hidden] override)
- Fixed: Double-click on a search result now reliably auto-plays (uses click detail count, 280ms window)
- Fixed: TPB magnets only had a UDP tracker (poor WebTorrent peer discovery) → now append public
  WebSocket trackers (openwebtorrent/btorrent.xyz/webtorrent.dev) so TV/other torrents find peers
- Added: 60s metadata-fetch timeout with a clear error instead of an endless "Fetching metadata" hang
- Fixed: TPB magnets only had a UDP tracker (poor WebTorrent peer discovery) → now append public
  WebSocket trackers (openwebtorrent/btorrent.xyz/webtorrent.dev) so TV/other torrents find peers
- Added: 60s metadata-fetch timeout with a clear error instead of an endless "Fetching metadata" hang
- Removed: In-app 1337x browser panel (BrowserView/webview) — 1337x blocks embedded browsers via Cloudflare.
  Replaced with a magnet: protocol handler that is active ONLY while the app runs (unregistered on quit),
  so clicking a magnet in your real browser loads it into the app; system default is restored on close.

