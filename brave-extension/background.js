const APP_PORT = 43161
let latestStatus = null

// When the content script asks for the current status:
//   - Return cached latestStatus if we have it
//   - Otherwise fetch fresh from the app
// This keeps the service worker alive because onMessage is an event that
// extends the worker's lifetime.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'magnet' && msg.uri) {
    fetch(`http://127.0.0.1:${APP_PORT}/magnet?uri=${encodeURIComponent(msg.uri)}`, {
      method: 'GET', cache: 'no-store'
    }).catch(() => {})
    latestStatus = null
    sendResponse({ ok: true })
    return true
  }

  if (msg && msg.type === 'getStatus') {
    if (latestStatus) {
      sendResponse({ status: latestStatus })
      return true
    }
    fetch(`http://127.0.0.1:${APP_PORT}/status`, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 204) return null
        return r.json()
      })
      .then(function (data) {
        if (data) { latestStatus = data } else { latestStatus = null }
        sendResponse({ status: data })
      })
      .catch(function () {
        latestStatus = null
        sendResponse({ status: null })
      })
    return true
  }
})
