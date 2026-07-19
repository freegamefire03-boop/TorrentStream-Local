# Testing Map — TorrentStream-Local

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Electron App                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  main.js (815 lines)                             │    │
│  │  • WebTorrent lifecycle (load, add, stream)      │    │
│  │  • Magnet server (localhost:43161)               │    │
│  │  • Stream server (127.0.0.1:random)              │    │
│  │  • VLC launch                                    │    │
│  │  • Settings persistence                          │    │
│  │  • Brave browser spawning                        │    │
│  │  • OS magnet protocol handler                    │    │
│  └────────────┬─────────────────────────────────────┘    │
│               │ IPC (contextBridge)                       │
│  ┌────────────▼─────────────────────────────────────┐    │
│  │  preload.js (22 lines) — IPC bridge              │    │
│  └────────────┬─────────────────────────────────────┘    │
│               │ window.api.*                              │
│  ┌────────────▼─────────────────────────────────────┐    │
│  │  renderer.js (439 lines) — UI logic              │    │
│  │  renderer.html (92 lines) — DOM structure        │    │
│  │  renderer.css — styling                          │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  providers.js (179 lines) — search providers     │    │
│  │  • YTS (yts.am API)                              │    │
│  │  • TPB (apibay.org API)                          │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Brave Extension                                         │
│  ┌──────────────────────────────────────────────────┐    │
│  │  background.js (39 lines) — service worker      │    │
│  │  • Forwards magnets to localhost:43161/magnet   │    │
│  │  • Caches /status for content-script polling    │    │
│  └────────────┬─────────────────────────────────────┘    │
│               │ chrome.runtime.sendMessage                │
│  ┌────────────▼─────────────────────────────────────┐    │
│  │  content.js (163 lines) — overlay + interception│    │
│  │  • Magnet link click interception               │    │
│  │  • Progress overlay (DOM injection)              │    │
│  │  • Poll loop (60 retries, ~30s timeout)          │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  manifest.json (18 lines)                       │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## Test Layers

### Layer 1: Pure Unit Tests (no Electron, no network)
Run: `node --test tests/unit/*.test.js`

| File | Functions Tested | Test File |
|---|---|---|
| `main.js` | `isVideo()`, `sanitize()`, `pickBestVideo()`, `torrentFolderFor()`, `healthHint()`, `buildFileList()`, `findMatchingSubs()`, `markHeadPriority()`, `waitForHeadReady()` | `tests/unit/main-pure.test.js` |
| `renderer.js` | `fmtSize()`, `pickBestVideo()`, `JUNK` regex, `STAGE_TEXT` | `tests/unit/renderer-pure.test.js` |
| `providers.js` | `qualityToBytes()`, `rank()`, `tpbCatLabel()` | `tests/unit/providers.test.js` |

### Layer 2: Integration Tests (mocked dependencies)
Run: `node --test tests/integration/*.test.js`

| File | Functions Tested | Test File |
|---|---|---|
| `providers.js` | YTS search with mocked HTTP, TPB search with mocked HTTP, `searchAll` aggregation | `tests/integration/providers-int.test.js` |
| `main.js` | `addTorrent` callback handling, magnet URI validation, `healthHint` edge cases | `tests/integration/main-int.test.js` |

### Layer 3: Extension Tests (headless Chromium with Playwright)
Run: `node --test tests/e2e/extension.test.mjs`

| Test | Description |
|---|---|
| Extension loads | Load unpacked extension in Chromium, verify service worker starts |
| Magnet interception | Inject magnet link into DOM, click it, verify message sent |
| Overlay creation | Simulate magnet click, verify overlay DOM elements injected |
| Overlay removal | Simulate done/error status, verify overlay removed after 1.2s |
| Poll timeout | Simulate no response for 60 retries, verify overlay auto-dismisses |

### Layer 4: E2E (1337x scraping with Playwright)
Run: `node tests/e2e/1337x-scrape.mjs`

| Test | Description |
|---|---|
| 1337x reachable | Navigate to 1337x.to, verify page loads |
| Search works | Execute a search, verify results appear |
| Magnet links exist | Extract magnet: href attributes, verify format |
| Magnet URL format | Validate extracted URIs match `magnet:?xt=urn:btih:[a-f0-9]{40}` |

## Running Tests

```bash
# Layer 1 - Pure unit tests
node --test tests/unit/*.test.js

# Layer 2 - Integration tests
node --test tests/integration/*.test.js

# Layer 1 + 2 combined
node --test tests/**/*.test.js

# Layer 3 - Extension E2E
node tests/e2e/extension.test.mjs

# Layer 4 - 1337x scraping
node tests/e2e/1337x-scrape.mjs

# All tests
npm test
```
