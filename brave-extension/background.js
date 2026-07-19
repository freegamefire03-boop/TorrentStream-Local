const APP_PORT = 43161
let pollTimer = null
let pollActive = false
let latestStatus = null

// Poll the app's /status endpoint at intervals and broadcast to content scripts in active tabs
function startPolling() {
  if (pollActive) return
  pollActive = true
  pollCycle()
}

function stopPolling() {
  pollActive = false
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

function pollCycle() {
  if (!pollActive) return
  fetch(`http://127.0.0.1:${APP_PORT}/status`, { cache: 'no-store' })
    .then(function (r) {
      if (r.status === 204) {
        latestStatus = null
        pollTimer = setTimeout(pollCycle, 500)
        return
      }
      return r.json()
    })
    .then(function (data) {
      if (!pollActive) return
      if (data) {
        latestStatus = data
        // Broadcast to all tabs where content script is listening
        chrome.runtime.sendMessage({ type: 'status', status: data }).catch(() => {})
        if (data.stage === 'done' || data.stage === 'error') {
          stopPolling()
        }
      }
      if (pollActive) pollTimer = setTimeout(pollCycle, 500)
    })
    .catch(function () {
      if (pollActive) pollTimer = setTimeout(pollCycle, 1000)
    })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'magnet' && msg.uri) {
    const uri = msg.uri
    fetch(`http://127.0.0.1:${APP_PORT}/magnet?uri=${encodeURIComponent(uri)}`, {
      method: 'GET', cache: 'no-store'
    }).catch(() => {})
    sendResponse({ ok: true })
    return true
  }

  if (msg && msg.type === 'startMagnetPoll') {
    latestStatus = null
    startPolling()
    sendResponse({ ok: true })
    return true
  }
})
