// Background service worker: receives intercepted magnets from the content script
// and forwards them to the TorrentStream-Local app's local HTTP server.
const APP_PORT = 43161

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'magnet' && msg.uri) {
    const uri = msg.uri
    console.log('[ts-ext] intercepted magnet:', uri)

    // Forward to the Electron app's local server (Step 3 finalizes this endpoint).
    // Until the app is running, this fetch fails silently — interception itself still worked.
    fetch(`http://127.0.0.1:${APP_PORT}/magnet?uri=${encodeURIComponent(uri)}`, {
      method: 'GET',
      cache: 'no-store'
    }).catch((err) => {
      console.warn('[ts-ext] app not reachable yet:', err.message)
    })

    sendResponse({ ok: true })
  }
  return true
})
