# Changelog

All notable changes to this project are logged here, newest first.

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

