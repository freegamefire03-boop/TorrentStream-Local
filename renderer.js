const $ = (sel) => document.querySelector(sel)

const magnetInput = $('#magnet')
const loadMagnetBtn = $('#load-magnet')
const pickFileBtn = $('#pick-file')
const dropZone = $('#drop-zone')
const statusEl = $('#status')
const fileSection = $('#file-section')
const torrentNameEl = $('#torrent-name')
const fileTreeEl = $('#file-tree')
const nowPlayingEl = $('#now-playing')
const vlcStatusEl = $('#vlc-status')
const vlcSettingsBtn = $('#vlc-settings')

// Settings modal elements
const openSettingsBtn = $('#open-settings')
const open1337xBtn = $('#open-1337x')
const settingsModal = $('#settings-modal')
const closeSettingsBtn = $('#close-settings')
const modeMemoryBtn = $('#mode-memory')
const modeDiskBtn = $('#mode-disk')
const modeHint = $('#mode-hint')
const downloadPathEl = $('#download-path')
const pickDownloadBtn = $('#pick-download')
const vlcPathEl = $('#vlc-path')
const pickVlcBtn = $('#pick-vlc')

let currentFiles = []

function setStatus(msg, kind = 'info') {
  statusEl.textContent = msg || ''
  statusEl.className = 'status' + (kind ? ' ' + kind : '')
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(i ? 1 : 0) + ' ' + units[i]
}

let loadToken = 0

async function loadTorrent(loader) {
  const myToken = ++loadToken
  setStatus('Fetching metadata… please wait (this may take a while)')
  loadMagnetBtn.disabled = true
  pickFileBtn.disabled = true
  // Clear the previous torrent's tree immediately so old video indices can't be clicked.
  fileSection.hidden = true
  fileTreeEl.innerHTML = ''
  nowPlayingEl.hidden = true
  try {
    const result = await loader()
    if (myToken !== loadToken) return null // a newer load superseded this one
    currentFiles = result.files
    renderTree(result.name, result.files)
    setStatus(`Loaded ${result.files.length} file(s). Click a highlighted video to stream.`)
    return result
  } catch (err) {
    setStatus(err.message || String(err), 'error')
    return null
  } finally {
    loadMagnetBtn.disabled = false
    pickFileBtn.disabled = false
  }
}

function renderTree(name, files) {
  torrentNameEl.textContent = name
  fileTreeEl.innerHTML = ''
  const folders = {}
  const roots = []
  files.forEach((f) => {
    const parts = f.path.split('/')
    if (parts.length > 1) {
      const folder = parts.slice(0, -1).join('/')
      ;(folders[folder] = folders[folder] || []).push(f)
    } else {
      roots.push(f)
    }
  })
  roots.forEach((f) => fileTreeEl.appendChild(renderFile(f)))
  Object.keys(folders).sort().forEach((folder) => {
    const li = document.createElement('li')
    li.className = 'folder'
    li.textContent = '📁 ' + folder
    fileTreeEl.appendChild(li)
    folders[folder].forEach((f) => fileTreeEl.appendChild(renderFile(f)))
  })
  fileSection.hidden = false
}

function renderFile(f) {
  const li = document.createElement('li')
  li.className = 'file' + (f.video ? ' video' : '')
  const label = document.createElement('span')
  label.textContent = (f.video ? '▶ ' : '') + f.name
  const size = document.createElement('span')
  size.className = 'size'
  size.textContent = fmtSize(f.size)
  li.appendChild(label)
  li.appendChild(size)
  if (f.video) {
    li.addEventListener('click', () => selectVideo(f.index, f.name))
  }
  return li
}

// Pick the best video: largest non-junk video file.
const JUNK = /sample|rarbg|trailer|advert|intro|preview/i
function pickBestVideo(files) {
  const vids = files.filter((f) => f.video && !JUNK.test(f.name))
  if (!vids.length) vids.push(...files.filter((f) => f.video))
  vids.sort((a, b) => b.size - a.size)
  return vids[0] || null
}

async function selectVideo(index, name) {
  setStatus('Starting local stream server…')
  try {
    const { url, subtitles } = await window.api.streamFile(index)
    nowPlayingEl.hidden = false
    const subNote = subtitles && subtitles.length
      ? ` · ${subtitles.length} subtitle(s) loaded`
      : ''
    nowPlayingEl.innerHTML = `Streaming <strong>${name}</strong> → <a href="${url}">${url}</a>. Launching VLC…${subNote}`
    await window.api.launchVlc(url, subtitles)
    setStatus('VLC launched. Enjoy!' + subNote)
  } catch (err) {
    setStatus(err.message || String(err), 'error')
  }
}

async function handleTorrentFilePath(filePath) {
  await loadTorrent(() => window.api.loadTorrentFile(filePath))
}

loadMagnetBtn.addEventListener('click', () => {
  const uri = magnetInput.value.trim()
  if (!uri) { setStatus('Enter a magnet link first.', 'error'); return }
  if (/^magnet:\?/i.test(uri)) {
    loadTorrent(() => window.api.loadMagnet(uri))
  } else if (/^https?:\/\//i.test(uri)) {
    loadTorrent(() => window.api.loadTorrentUrl(uri))
  } else {
    setStatus('That doesn\'t look like a magnet link or .torrent URL.', 'error')
  }
})

magnetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadMagnetBtn.click()
})

// ---- Search (YTS / TPB) ----
const searchInput = $('#search')
const searchBtn = $('#search-btn')
const searchStatus = $('#search-status')
const searchResults = $('#search-results')
const inputBar = $('#input-bar')
const srcYtsBtn = $('#src-yts')
const srcTpbBtn = $('#src-tpb')
let currentSource = 'YTS' // 'YTS' | 'TPB'

function setManualLoaderVisible(visible) {
  inputBar.hidden = !visible
  dropZone.hidden = !visible
}

function updateSourceUI() {
  srcYtsBtn.classList.toggle('active', currentSource === 'YTS')
  srcTpbBtn.classList.toggle('active', currentSource === 'TPB')
  searchInput.placeholder = currentSource === 'YTS'
    ? 'Search movies by name… (YTS)'
    : 'Search TV shows & more… (TPB)'
}
srcYtsBtn.addEventListener('click', () => { currentSource = 'YTS'; updateSourceUI() })
srcTpbBtn.addEventListener('click', () => { currentSource = 'TPB'; updateSourceUI() })
updateSourceUI()

const PAGE_SIZE = 5
let allSearchResults = []
let visibleResults = PAGE_SIZE

async function runSearch() {
  const q = searchInput.value.trim()
  if (!q) { searchStatus.textContent = 'Type a search term.'; searchStatus.className = 'search-status error'; return }
  setManualLoaderVisible(false)
  searchStatus.textContent = 'Searching ' + currentSource + '…'
  searchStatus.className = 'search-status'
  searchResults.hidden = true
  searchResults.innerHTML = ''
  visibleResults = PAGE_SIZE
  try {
    const opts = { minSeeders: 5, providers: [currentSource], preferQuality: '1080p' }
    allSearchResults = await window.api.searchTorrents(q, opts)
    if (!allSearchResults.length) {
      searchStatus.textContent = 'No results.'
      return
    }
    searchStatus.textContent = `${allSearchResults.length} result(s) from ${currentSource}`
    renderVisibleResults()
    searchResults.hidden = false
  } catch (err) {
    searchStatus.textContent = err.message || String(err)
    searchStatus.className = 'search-status error'
  }
}

// Render only the first `visibleResults` cards into a horizontal row, then append a
// "Load More" button if there are more results to reveal.
function renderVisibleResults() {
  searchResults.innerHTML = ''
  const slice = allSearchResults.slice(0, visibleResults)
  slice.forEach((r) => searchResults.appendChild(renderResult(r)))
  if (visibleResults < allSearchResults.length) {
    const more = document.createElement('button')
    more.className = 'load-more-btn'
    more.textContent = 'Load More ▸'
    more.addEventListener('click', () => {
      visibleResults += PAGE_SIZE
      renderVisibleResults()
      // Keep the newly revealed cards in view by scrolling to the end of the row.
      searchResults.scrollLeft = searchResults.scrollWidth
    })
    searchResults.appendChild(more)
  }
}

// Show the manual loader again once the search box is emptied.
searchInput.addEventListener('input', () => {
  if (!searchInput.value.trim()) {
    setManualLoaderVisible(true)
    searchResults.hidden = true
  }
})

function renderResult(r) {
  const card = document.createElement('div')
  card.className = 'result-card'
  if (r.poster) {
    const img = document.createElement('img')
    img.src = r.poster
    img.alt = r.title
    img.loading = 'lazy'
    card.appendChild(img)
  }
  const info = document.createElement('div')
  info.className = 'info'
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = `${r.title}${r.year ? ' (' + r.year + ')' : ''}`
  const meta = document.createElement('div')
  meta.className = 'meta'
  const q = document.createElement('span')
  q.className = 'badge' + (r.quality === '1080p' ? ' quality-1080p' : '')
  q.textContent = r.quality || '?'
  const seed = document.createElement('span')
  seed.className = 'seeders'
  seed.textContent = '⬆ ' + (r.seeders ?? '?')
  const size = document.createElement('span')
  size.textContent = fmtSize(r.size)
  const rating = document.createElement('span')
  rating.textContent = r.rating ? '★ ' + r.rating : ''
  meta.append(q, seed, size, rating)
  info.append(title, meta)
  card.appendChild(info)
  let clickTimer = null
  card.addEventListener('click', (e) => {
    // e.detail === 2 means this is the second click of a double-click.
    if (e.detail >= 2) {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
      loadAndPlay(r)
      return
    }
    // First click: wait to see if a second click (double) arrives.
    if (clickTimer) return
    clickTimer = setTimeout(() => {
      clickTimer = null
      loadResult(r)
      fileSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 280)
  })
  return card
}

async function loadResult(r) {
  if (r.magnet) {
    magnetInput.value = r.magnet
    await loadTorrent(() => window.api.loadMagnet(r.magnet))
  } else if (r.torrentUrl) {
    magnetInput.value = r.torrentUrl
    await loadTorrent(() => window.api.loadTorrentUrl(r.torrentUrl))
  } else {
    searchStatus.textContent = 'No source for this result.'
    searchStatus.className = 'search-status error'
    return
  }
  searchResults.hidden = true
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function loadAndPlay(r) {
  let source
  if (r.magnet) source = () => window.api.loadMagnet(r.magnet)
  else if (r.torrentUrl) source = () => window.api.loadTorrentUrl(r.torrentUrl)
  else {
    searchStatus.textContent = 'No source for this result.'
    searchStatus.className = 'search-status error'
    return
  }
  const myToken = ++loadToken
  setStatus('Loading…')
  const result = await loadTorrent(source)
  if (myToken !== loadToken || !result) return
  const best = pickBestVideo(result.files)
  if (!best) { setStatus('No video file found in this torrent.', 'error'); return }
  searchResults.hidden = true
  nowPlayingEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  await selectVideo(best.index, best.name)
}

searchBtn.addEventListener('click', runSearch)
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch() })

pickFileBtn.addEventListener('click', async () => {
  const filePath = await window.api.pickTorrentFile()
  if (filePath) await handleTorrentFilePath(filePath)
})

// Drag & drop .torrent
;['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover') })
)
;['dragleave', 'drop'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover') })
)
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0]
  if (file && /\.torrent$/i.test(file.name)) {
    handleTorrentFilePath(file.path)
  } else {
    setStatus('Please drop a .torrent file.', 'error')
  }
})

// VLC settings (legacy header button removed; kept for compatibility)
if (vlcSettingsBtn) {
  vlcSettingsBtn.addEventListener('click', async () => {
    const p = await window.api.promptVlcPath()
    updateVlcStatus(p)
  })
}

function updateVlcStatus(path) {
  if (!vlcStatusEl) return
  vlcStatusEl.textContent = path ? 'set' : 'not found'
  vlcStatusEl.style.color = path ? 'var(--video)' : 'var(--error)'
}

// ---- 1337x in isolated Brave ----
open1337xBtn.addEventListener('click', async () => {
  setStatus('Launching 1337x in isolated Brave…', 'info')
  try {
    const res = await window.api.launchBrave1337x()
    if (res && res.ok) {
      setStatus('1337x opened in Brave. Click a magnet link — it will load here.', 'info')
    } else {
      setStatus('Could not launch Brave: ' + (res && res.error ? res.error : 'unknown error'), 'error')
    }
  } catch (e) {
    setStatus('Could not launch Brave: ' + (e.message || e), 'error')
  }
})

// ---- Settings modal ----
let currentSettings = { saveMode: 'memory', downloadPath: '', vlcPath: '' }

async function refreshSettingsUI() {
  currentSettings = await window.api.getSettings()
  modeMemoryBtn.classList.toggle('active', currentSettings.saveMode === 'memory')
  modeDiskBtn.classList.toggle('active', currentSettings.saveMode === 'disk')
  modeHint.textContent = currentSettings.saveMode === 'disk'
    ? 'Files are written to disk and kept. On quit you choose to keep or delete them.'
    : 'Files are streamed in RAM only. Closing re-downloads from scratch next time.'
  downloadPathEl.textContent = currentSettings.downloadPath || '(Downloads)'
  downloadPathEl.title = currentSettings.downloadPath || ''
  vlcPathEl.textContent = currentSettings.vlcPath || '(auto-detect)'
  vlcPathEl.title = currentSettings.vlcPath || ''
}

openSettingsBtn.addEventListener('click', async () => {
  await refreshSettingsUI()
  settingsModal.hidden = false
})
closeSettingsBtn.addEventListener('click', () => { settingsModal.hidden = true })

modeMemoryBtn.addEventListener('click', async () => {
  await window.api.setSaveMode('memory')
  await refreshSettingsUI()
})
modeDiskBtn.addEventListener('click', async () => {
  await window.api.setSaveMode('disk')
  await refreshSettingsUI()
})
pickDownloadBtn.addEventListener('click', async () => {
  const p = await window.api.promptDownloadPath()
  if (p) await refreshSettingsUI()
})
pickVlcBtn.addEventListener('click', async () => {
  const p = await window.api.promptVlcPath()
  if (p) await refreshSettingsUI()
})

;(async () => {
  await refreshSettingsUI()
})()

// ---- Incoming magnet (app registered as magnet: handler while running) ----
window.api.onMagnetReceived((uri) => {
  // A magnet was handed to the app from the OS; show that we're loading it.
  setStatus('Loading magnet from browser…', 'info')
  fileSection.hidden = true
  fileTreeEl.innerHTML = ''
  nowPlayingEl.hidden = true
})
window.api.onMagnetLoaded((result) => {
  currentFiles = result.files
  renderTree(result.name, result.files)
  setStatus(`Loaded ${result.files.length} file(s). Click a highlighted video to stream.`)
})
window.api.onMagnetError((msg) => {
  setStatus(msg || 'Failed to load magnet.', 'error')
})

