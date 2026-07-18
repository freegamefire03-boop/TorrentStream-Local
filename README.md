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
- **Subtitles**: matching external subtitle files (`.srt/.ass/.sub/.vtt`…) for the chosen video are
  auto-downloaded and passed to VLC via `--sub-file`, so they load automatically. Embedded subs in
  MKV already play without action.
- Load torrents from a magnet link or a local `.torrent` file (with drag & drop)
- Read metadata only (no full download) and list files with sizes
- File tree respects subfolders; video files (mp4/mkv/avi/mov/webm/…) are highlighted
- Click a video → a local HTTP server streams it (sequential piece priority) at `127.0.0.1:PORT`
- **Seek support**: the stream server honors HTTP `Range` requests (`206 Partial Content`), so VLC's
  forward/backward scrubbing works instead of restarting from the beginning
- **Save mode toggle** (⚙ Settings):
  - *Memory* — pieces cached in RAM, nothing written to disk; closing re-downloads next time
  - *Disk* — torrent saved to a chosen folder in its own subfolder; re-loading resumes from disk
    (so seeking reads from the local file instead of re-fetching chunks over the network)
- Auto-launch VLC as an external player pointed at the stream URL
- VLC path auto-detected on Windows, or set manually via Settings
- On quit in Disk mode, a dialog asks whether to **keep** or **delete** the downloaded torrent folder;
  in Memory mode it just closes (server/torrent torn down)

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
- `main.js` — Electron main process: IPC handlers, webtorrent client, HTTP stream server, VLC launch
- `preload.js` — contextBridge exposing a safe `window.api` to the renderer
- `renderer.html` / `renderer.js` / `renderer.css` — UI: input bar, file tree, status
- `package.json` — deps + `electron-builder` config for packaging

## Known Issues / TODO
- Packaging to a double-click `.exe` is configured but untested (run `npm run dist`)
- macOS/Linux VLC detection paths not yet added (Windows-only candidate list today)
- In Disk mode, webtorrent still fetches missing pieces on demand; already-downloaded pieces play instantly
- Search currently uses YTS (movies only). More providers can be added in `providers.js` behind approval.
