# TorrentStream-Local

Minimal Electron desktop app. Paste a magnet link or drop a `.torrent` file → browse the
file tree inside → click a video file → the app starts a local HTTP stream server for that
file → auto-launches VLC pointed at the local URL. No custom video player, no torrent
search, no accounts, no cloud.

## Status
MVP — core flow implemented and boots cleanly.

## Features
- **Search** by keyword with a **source toggle** so providers don't mix:
  - 🎬 **YTS** — movies only, poster grid, ranked by seeders ↓ / rating ↓, prefers 1080p
  - 📺 **TPB** (The Pirate Bay via apibay.org) — TV shows + general; ranked by seeders ↓
    (labeled by category: TV / Movies / etc.), builds magnets from info_hash
  - In both, your exact query words are matched first; dead torrents (under min seeders) filtered out
  - While a search is active the manual magnet/.torrent bar is hidden; it reappears when you clear the box
  - **Single click** a result → loads it and shows the file tree (pick a video manually)
  - **Double click** a result → auto-picks the best video (largest non-junk file, ignores samples/RARBG)
    and launches VLC immediately, skipping the tree
  - Results render in a **horizontal-scrolling row** (no vertical page growth); the first 5 are shown,
    with a **"Load More ▸"** button that reveals 5 more at a time and scrolls the row to them
  - YTS results show the movie **poster/cover** (loaded from the YTS image CDN) to help identify titles
- **Subtitles**: matching external subtitle files (`.srt/.ass/.sub/.vtt`…) for the chosen video are
  auto-downloaded and passed to VLC via `--sub-file`, so they load automatically. Embedded subs in
  MKV already play without action.
- Load torrents from a magnet link or a local `.torrent` file (with drag & drop)
- Read metadata only (no full download) and list files with sizes
- File tree respects subfolders; video files (mp4/mkv/avi/mov/webm/…) are highlighted
- Click a video → a local HTTP server streams it at `127.0.0.1:PORT` with WebTorrent critical-priority
  head (40 pieces) and reactive range-triggered priority bump for fast startup
- **Seek support**: the stream server honors HTTP `Range` requests (`206 Partial Content`) and kills
  stale prefetch streams on large seeks, so VLC's forward/backward scrubbing works smoothly
- **Fast first frame**: before VLC connects, app waits (up to 4s) for the first ~10 MB to be verified in the
  chunk store — eliminates head-tail queue contention stalls. On timeout, it launches anyway (worst case = original behavior)
- **VLC tuned**: `--network-caching=1000` (improved from 300) with explicit HTTP keep-alive
- **Startup progress**: a small overlay in both the app and the browser (via the extension) shows "Connecting to swarm..." / "Downloading x%" / "Starting player..." with health hints
  so you know what is happening
- **Save mode toggle** (⚙ Settings):
  - *Memory* — pieces cached in RAM, nothing written to disk; closing re-downloads next time
  - *Disk* — torrent saved to a chosen folder in its own subfolder; re-loading resumes from disk
    (so seeking reads from the local file instead of re-fetching chunks over the network)
- Auto-launch VLC as an external player pointed at the stream URL
- VLC path auto-detected on Windows, or set manually via Settings
- On quit in Disk mode, a dialog asks whether to **keep** or **delete** the downloaded torrent folder;
  in Memory mode it just closes (server/torrent torn down)
- 🌐 **1337x via Brave** (header button "🌐 1337x (Brave)"): opens 1337x.to in an **isolated Brave
  profile** with a sideloaded browser extension. The extension intercepts any magnet-link click and
  forwards it to the app's local server, which auto-picks the best video and launches VLC. This avoids
  Cloudflare, which blocks in-app/embedded browsing of 1337x.
  - The app also registers itself as the `magnet:` protocol handler **only while it is running**
    (unregistered on quit), so clicking a magnet in any browser loads it into the app.

## How 1337x (Brave) works
1. Click **🌐 1337x (Brave)** → the app launches Brave in a private `brave-profile/` with the
   `brave-extension/` loaded, then opens `https://1337x.to`.
2. Browse and click any **magnet** link on 1337x (or any site).
3. The extension (capture-phase click handler) cancels the default navigation and `fetch()`es
   `http://127.0.0.1:43161/magnet?uri=<magnet>` on the app's local server.
4. The app resolves metadata, picks the largest non-junk video, starts the HTTP stream, and launches VLC.
5. Closing the app unregisters the `magnet:` handler and kills the Brave process; `brave-profile/`
   subfolders are wiped on close (extension config is preserved).

## Tech Stack
- Electron (v33)
- Node.js
- `webtorrent` (v2, ESM) — core torrent engine
- VLC — external player launched via child process

## Setup / Run
```bash
npm install
npm start
```
Requires VLC installed (or use the "VLC" button in the app to point at `vlc.exe`).

## Project Structure
- `main.js` — Electron main process: IPC handlers, webtorrent client, HTTP stream server, VLC launch,
  localhost magnet server (`:43161`), Brave launch, `magnet:` protocol registration
- `preload.js` — contextBridge exposing a safe `window.api` to the renderer
- `renderer.html` / `renderer.js` / `renderer.css` — UI: input bar, file tree, status, search, settings
- `brave-extension/` — MV3 extension sideloaded into the isolated Brave profile; intercepts magnet clicks
  and forwards them to the app's local server
- `brave-profile/` — isolated Brave user-data dir (gitignored; wiped on app close, extension config kept)
- `providers.js` — YTS + TPB search providers
- `package.json` — deps + `electron-builder` config for packaging
- `tests/` — full test suite:
  - `tests/unit/` — 106 pure-fn unit tests (node:test, zero deps)
  - `tests/integration/` — provider search tests with mocked HTTP
  - `tests/e2e/` — 6 Playwright E2E tests (magnet format, TPB trackers, interception)

## Running Tests
```bash
npm test           # unit + integration + E2E (112 tests)
npm run test:unit  # unit + integration only (106 tests)
npm run test:e2e   # Playwright E2E only (6 tests)
```

## Known Issues / TODO
- Packaging to a double-click `.exe` is configured but untested (run `npm run dist`)
- macOS/Linux VLC detection paths not yet added (Windows-only candidate list today)
- In Disk mode, webtorrent still fetches missing pieces on demand; already-downloaded pieces play instantly
- Search currently uses YTS (movies only). More providers can be added in `providers.js` behind approval.
- E2E live-scraping of 1337x blocked by Cloudflare in headless Playwright (works in real Brave). Provider integration tests use mocked HTTP instead.
- Extension overlay E2E requires real Brave — Playwright's Chromium doesn't activate extension content scripts the same way.
