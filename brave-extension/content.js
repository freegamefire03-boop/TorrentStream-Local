(function () {
  const APP_PORT = 43161

  // ---- Progress overlay DOM ----
  let overlay = null
  let pollTimer = null
  let active = false

  function createOverlay() {
    const doc = document.documentElement
    overlay = document.createElement('div')
    overlay.id = '__ts_progress_overlay'
    overlay.innerHTML = `
      <div id="__ts_overlay_box">
        <div id="__ts_overlay_header">TorrentStream</div>
        <div id="__ts_overlay_stage">Connecting...</div>
        <div id="__ts_overlay_bar_container">
          <div id="__ts_overlay_bar_fill"></div>
        </div>
        <div id="__ts_overlay_pct">0%</div>
        <div id="__ts_overlay_hint"></div>
      </div>
    `
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      zIndex: '2147483647', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.65)', fontFamily: 'system-ui, -apple-system, sans-serif'
    })
    const box = overlay.querySelector('#__ts_overlay_box')
    Object.assign(box.style, {
      backgroundColor: '#1e1e1e', color: '#e0e0e0', padding: '32px 40px',
      borderRadius: '12px', minWidth: '320px', maxWidth: '420px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', textAlign: 'center'
    })
    const header = overlay.querySelector('#__ts_overlay_header')
    Object.assign(header.style, {
      fontSize: '14px', fontWeight: '600', color: '#888', textTransform: 'uppercase',
      letterSpacing: '1.5px', marginBottom: '16px'
    })
    const stage = overlay.querySelector('#__ts_overlay_stage')
    Object.assign(stage.style, { fontSize: '18px', fontWeight: '500', marginBottom: '16px' })
    const barContainer = overlay.querySelector('#__ts_overlay_bar_container')
    Object.assign(barContainer.style, {
      width: '100%', height: '6px', backgroundColor: '#333', borderRadius: '3px',
      overflow: 'hidden', marginBottom: '8px'
    })
    const fill = overlay.querySelector('#__ts_overlay_bar_fill')
    Object.assign(fill.style, {
      height: '100%', width: '0%', backgroundColor: '#4caf50', borderRadius: '3px',
      transition: 'width 0.4s ease'
    })
    const pct = overlay.querySelector('#__ts_overlay_pct')
    Object.assign(pct.style, { fontSize: '14px', color: '#aaa', marginBottom: '12px' })
    const hint = overlay.querySelector('#__ts_overlay_hint')
    Object.assign(hint.style, {
      fontSize: '13px', color: '#ff9800', marginTop: '8px', lineHeight: '1.4'
    })
    doc.appendChild(overlay)
  }

  function updateOverlay(data) {
    if (!overlay) return
    const stageEl = overlay.querySelector('#__ts_overlay_stage')
    const fillEl = overlay.querySelector('#__ts_overlay_bar_fill')
    const pctEl = overlay.querySelector('#__ts_overlay_pct')
    const hintEl = overlay.querySelector('#__ts_overlay_hint')

    let text = ''
    let barWidth = 0
    switch (data.stage) {
      case 'connecting':
        text = 'Connecting to swarm...'
        barWidth = 5
        break
      case 'downloading':
        text = 'Downloading...'
        barWidth = data.pct || 0
        break
      case 'starting-player':
        text = 'Starting player...'
        barWidth = 90
        break
      case 'done':
        text = 'Launching VLC'
        barWidth = 100
        break
      default:
        text = data.stage || 'Working...'
        barWidth = data.pct || 0
    }
    stageEl.textContent = text
    fillEl.style.width = barWidth + '%'
    pctEl.textContent = (data.pct || 0) + '%'

    if (data.hint) {
      hintEl.textContent = data.hint
      hintEl.style.display = 'block'
    } else {
      hintEl.style.display = 'none'
    }
  }

  function removeOverlay() {
    active = false
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
    overlay = null
  }

  function pollStatus() {
    if (!active) return
    fetch('http://127.0.0.1:' + APP_PORT + '/status', { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 204) { pollTimer = setTimeout(pollStatus, 500); return }
        return r.json()
      })
      .then(function (data) {
        if (!active || !data) return
        updateOverlay(data)
        if (data.stage === 'done' || data.stage === 'error') {
          if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
          setTimeout(removeOverlay, 1200)
          return
        }
        pollTimer = setTimeout(pollStatus, 500)
      })
      .catch(function () {
        if (active) pollTimer = setTimeout(pollStatus, 1000)
      })
  }

  // ---- Magnet click interception ----
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="magnet:"]') : null
    if (!a) return
    var uri = a.getAttribute('href')
    if (!uri || !/^magnet:\?/i.test(uri)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    active = true
    createOverlay()
    updateOverlay({ stage: 'connecting', pct: 0, peers: 0, hint: null })
    pollStatus()

    try {
      chrome.runtime.sendMessage({ type: 'magnet', uri: uri }, function (resp) {
        if (chrome.runtime.lastError) {
          console.error('[ts-ext] sendMessage failed:', chrome.runtime.lastError.message)
        }
      })
    } catch (err) {
      console.error('[ts-ext] sendMessage threw:', err)
    }
  }, true)
})()
