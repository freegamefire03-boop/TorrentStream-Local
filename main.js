const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')
const https = require('https')
const { searchAll } = require('./providers')
// WebTorrent v2 is ESM-only with top-level await, so it must be loaded via dynamic import.
let WebTorrent = null
async function getWebTorrent() {
  if (!WebTorrent) {
    WebTorrent = (await import('webtorrent')).default
  }
  return WebTorrent
}

const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', 'm4v']

// ---- Isolated Brave profile for 1337x browsing (extension-intercepted magnets) ----
const BRAVE_EXE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const BRAVE_PROFILE_DIR = path.join(__dirname, 'brave-profile')
const BRAVE_EXT_DIR = path.join(__dirname, 'brave-extension')
const BRAVE_HOME_URL = 'https://1337x.to'

let braveProcess = null

function launchBrave1337x() {
  // Use the isolated profile + sideload our extension. The extension intercepts magnet
  // clicks and forwards them to the app's local server (see background.js).
  const args = [
    `--user-data-dir=${BRAVE_PROFILE_DIR}`,
    `--load-extension=${BRAVE_EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    BRAVE_HOME_URL
  ]
  try {
    braveProcess = spawn(BRAVE_EXE, args, { detached: false, stdio: 'ignore' })
    braveProcess.on('exit', () => { braveProcess = null })
    braveProcess.on('error', (err) => {
      if (mainWindow) mainWindow.webContents.send('brave-error', err.message)
      braveProcess = null
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function killBrave() {
  if (braveProcess) {
    try { braveProcess.kill() } catch (e) {}
    braveProcess = null
  }
}

// ---- Magnet server for Brave extension (localhost:43161/magnet?uri=...) ----
const MAGNET_PORT = 43161
const JUNK = /sample|rarbg|trailer|advert|intro|preview/i

function pickBestVideo(files) {
  // files = array of { name, path, length, video, ... }
  const vids = files.filter((f) => f.video && !JUNK.test(f.name))
  if (!vids.length) vids.push(...files.filter((f) => f.video))
  vids.sort((a, b) => b.length - a.length)
  return vids[0] || null
}

let magnetServer = null

function startMagnetServer() {
  if (magnetServer) return
  magnetServer = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/magnet')) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const u = new URL(req.url, 'http://x')
    const uri = u.searchParams.get('uri')
    if (!uri || !/^magnet:\?/i.test(uri)) {
      res.writeHead(400)
      res.end('Invalid magnet')
      return
    }
    res.writeHead(200)
    res.end('ok')
    try {
      // Use existing loadMagnetUri which adds torrent and resolves when metadata ready
      const result = await loadMagnetUri(uri)
      // result = { name, files, saveMode }
      const best = pickBestVideo(result.files)
      if (!best) throw new Error('No video file found in torrent.')
      // Find the file index in currentTorrent.files
      const fileIndex = currentTorrent.files.findIndex((f) => f.path === best.path)
      if (fileIndex === -1) throw new Error('Video file not found in torrent.')
      // Stream it (selects file + matching subs, starts HTTP server)
      const { url, subtitlePaths } = await streamFile(fileIndex)
      // Launch VLC with subtitles
      await launchVlc(url, subtitlePaths)
      if (mainWindow) mainWindow.webContents.send('magnet-loaded', { name: best.name })
    } catch (err) {
      console.error('Magnet auto-play failed:', err.message)
      if (mainWindow) mainWindow.webContents.send('magnet-error', err.message)
    }
  })
  magnetServer.listen(MAGNET_PORT, '127.0.0.1', () => {
    console.log('Magnet server listening on http://127.0.0.1:' + MAGNET_PORT)
  })
  magnetServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.warn('Magnet server port ' + MAGNET_PORT + ' in use; extension will fail to deliver.')
    }
  })
}

function stopMagnetServer() {
  if (magnetServer) {
    magnetServer.close()
    magnetServer = null
  }
}

let mainWindow = null
let client = null
let currentTorrent = null
let currentTorrentFolder = null // absolute path on disk for the loaded torrent (disk mode only)
let streamServer = null
let streamPort = 0

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile('renderer.html')

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Full teardown of torrent + server. `removeData` deletes the on-disk folder.
function cleanup(removeData) {
  if (streamServer) {
    try { streamServer.close() } catch (e) {}
    streamServer = null
  }
  if (currentTorrent) {
    try { client.remove(currentTorrent, { destroyStore: false }) } catch (e) {}
    currentTorrent = null
  }
  if (removeData && currentTorrentFolder && fs.existsSync(currentTorrentFolder)) {
    try { fs.rmSync(currentTorrentFolder, { recursive: true, force: true }) } catch (e) {}
  }
  currentTorrentFolder = null
  if (client) {
    try { client.destroy() } catch (e) {}
    client = null
  }
}

// Resolve the on-disk folder webtorrent writes for a given torrent (subfolder named after torrent).
function torrentFolderFor(torrent) {
  const base = settings.downloadPath || app.getPath('downloads')
  return path.join(base, sanitize(torrent.name || torrent.infoHash || 'torrent'))
}

function sanitize(name) {
  const s = String(name || 'torrent')
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
}

function isVideo(name) {
  const ext = path.extname(name).toLowerCase().replace('.', '')
  return VIDEO_EXTS.includes(ext)
}

function buildFileList(torrent) {
  return torrent.files.map((file, index) => ({
    index,
    name: file.name,
    path: file.path,
    size: file.length,
    video: isVideo(file.name)
  }))
}

async function ensureClient() {
  if (!client) {
    const WT = await getWebTorrent()
    client = new WT()
  }
}

// Build the add() options based on the current save-mode setting.
function torrentAddOptions() {
  if (settings.saveMode === 'disk') {
    const base = settings.downloadPath || app.getPath('downloads')
    return { strategy: 'sequential', path: base }
  }
  // In-memory: no path → webtorrent keeps pieces in RAM.
  return { strategy: 'sequential' }
}

async function loadMagnetUri(magnetUri) {
  if (!magnetUri || !/^magnet:\?/.test(magnetUri)) {
    throw new Error('Invalid magnet link.')
  }
  cleanup(false)
  await ensureClient()
  return addTorrent(magnetUri)
}

// Called when a magnet: link is handed to the app (from the OS / default handler).
function handleIncomingMagnet(uri) {
  if (!uri || !/^magnet:\?/i.test(uri)) return
  if (!mainWindow) return
  mainWindow.webContents.send('magnet-received', uri)
  loadMagnetUri(uri)
    .then((result) => {
      if (mainWindow) mainWindow.webContents.send('magnet-loaded', { name: result.name, files: result.files })
      // Auto-pick best video and stream it
      const best = pickBestVideo(result.files)
      if (best) {
        return streamFile(best.index).then(({ url, subtitles }) => launchVlc(url, subtitles))
      }
    })
    .catch((err) => {
      if (mainWindow) mainWindow.webContents.send('magnet-error', err.message)
    })
}

ipcMain.handle('load-magnet', async (event, magnetUri) => loadMagnetUri(magnetUri))

ipcMain.handle('launch-brave-1337x', async () => {
  if (!fs.existsSync(BRAVE_EXE)) {
    return { ok: false, error: 'Brave not found at ' + BRAVE_EXE }
  }
  return launchBrave1337x()
})

ipcMain.handle('load-torrent-file', async (event, filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('Torrent file not found.')
  }
  cleanup(false)
  await ensureClient()
  return addTorrent(fs.readFileSync(filePath))
})

function addTorrent(arg) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out fetching torrent metadata. No peers found (the tracker may be unreachable).'))
    }, 60000)
    currentTorrent = client.add(arg, torrentAddOptions(), (torrent) => {
      clearTimeout(timeout)
      if (settings.saveMode === 'disk') {
        currentTorrentFolder = torrentFolderFor(torrent)
      }
      resolve({ name: torrent.name, files: buildFileList(torrent), saveMode: settings.saveMode })
    })
    currentTorrent.on('error', (err) => { clearTimeout(timeout); reject(err) })
    currentTorrent.on('metadata', () => {
      if (!currentTorrent._reported) {
        currentTorrent._reported = true
        clearTimeout(timeout)
        if (settings.saveMode === 'disk') {
          currentTorrentFolder = torrentFolderFor(currentTorrent)
        }
        resolve({ name: currentTorrent.name, files: buildFileList(currentTorrent), saveMode: settings.saveMode })
      }
    })
  })
}

ipcMain.handle('search-torrents', async (event, query, opts) => {
  if (!query || !query.trim()) throw new Error('Enter a search term.')
  return searchAll(query, opts || {})
})

// Download a .torrent from a URL and load it (YTS returns torrent URLs, not always magnets).
function httpsGetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'TorrentStream-Local' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          return resolve(httpsGetBuffer(next, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error('Torrent download failed (HTTP ' + res.statusCode + ')'))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', reject)
  })
}

ipcMain.handle('load-torrent-url', async (event, url) => {
  if (!/^https?:\/\//.test(url)) throw new Error('Invalid torrent URL.')
  const buf = await httpsGetBuffer(url)
  cleanup(false)
  await ensureClient()
  return addTorrent(buf)
})

ipcMain.handle('pick-torrent-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a .torrent file',
    filters: [{ name: 'Torrent', extensions: ['torrent'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

const SUB_EXTS = ['.srt', '.ass', '.sub', '.vtt', '.ssa', '.smi']
// Find subtitle files in the torrent that match the selected video (same base name / same folder).
function findMatchingSubs(videoFile) {
  const videoBase = path.basename(videoFile.name, path.extname(videoFile.name)).toLowerCase()
  const videoDir = path.dirname(videoFile.path).toLowerCase()
  return currentTorrent.files.filter((f) => {
    const ext = path.extname(f.name).toLowerCase()
    if (!SUB_EXTS.includes(ext)) return false
    const base = path.basename(f.name, ext).toLowerCase()
    const dir = path.dirname(f.path).toLowerCase()
    // Match by same base name, or same folder with a similar name.
    return base === videoBase || (dir === videoDir && base.startsWith(videoBase.slice(0, 6)))
  })
}

// Download the given subtitle files to a temp folder, return their local paths.
async function downloadSubs(subs) {
  const dir = path.join(app.getPath('temp'), 'torrentstream-subs-' + Date.now())
  fs.mkdirSync(dir, { recursive: true })
  const paths = []
  for (const sub of subs) {
    try {
      const buf = await new Promise((resolve, reject) => {
        const chunks = []
        const s = sub.createReadStream()
        s.on('data', (c) => chunks.push(c))
        s.on('end', () => resolve(Buffer.concat(chunks)))
        s.on('error', reject)
      })
      const out = path.join(dir, sub.name)
      fs.writeFileSync(out, buf)
      paths.push(out)
    } catch (e) {
      console.error('sub download failed', e.message)
    }
  }
  return paths
}

// ---- Reusable stream + VLC launch (used by IPC and magnet auto-play) ----
async function streamFile(fileIndex) {
  if (!currentTorrent) throw new Error('No torrent loaded.')
  if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= currentTorrent.files.length) {
    throw new Error('File index out of range.')
  }
  const file = currentTorrent.files[fileIndex]
  if (!file) throw new Error('File index out of range.')

  // Deselect everything else to save bandwidth, keep only the selected file + its subs.
  const subs = findMatchingSubs(file)
  const keep = new Set([fileIndex, ...subs.map((s) => currentTorrent.files.indexOf(s))])
  currentTorrent.files.forEach((f, i) => {
    if (!keep.has(i)) f.deselect()
  })
  file.select()
  subs.forEach((s) => s.select())

  // (Re)start the HTTP stream server with range support.
  if (streamServer) {
    try { streamServer.close() } catch (e) {}
  }

  const fileSize = file.length

  return new Promise((resolve, reject) => {
    streamServer = http.createServer((req, res) => {
      if (req.url !== '/' && req.url !== '/stream') {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const range = req.headers.range
      let start = 0
      let end = fileSize - 1
      let statusCode = 200

      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        if (match) {
          if (match[1]) start = parseInt(match[1], 10)
          if (match[2]) end = parseInt(match[2], 10)
          if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
            res.end()
            return
          }
          statusCode = 206
        }
      }

      const headers = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      }
      if (statusCode === 206) {
        headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
      }
      res.writeHead(statusCode, headers)

      const stream = file.createReadStream({ start, end })
      let clientGone = false
      res.on('close', () => { clientGone = true })
      stream.on('error', (err) => {
        if (clientGone || /closed|aborted|prematurely/i.test(err.message)) return
        console.error('stream error', err)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
      stream.pipe(res)
    })

    streamServer.on('error', (err) => reject(err))

    streamServer.listen(0, '127.0.0.1', async () => {
      streamPort = streamServer.address().port
      const url = `http://127.0.0.1:${streamPort}/stream`
      let subtitlePaths = []
      if (subs.length) {
        try { subtitlePaths = await downloadSubs(subs) } catch (e) {}
      }
      resolve({ url, subtitles: subtitlePaths })
    })
  })
}

async function launchVlc(url, subtitlePaths) {
  const vlcPath = findVlc()
  if (!vlcPath) {
    throw new Error('VLC not found. Install VLC or set its path in settings.')
  }
  const args = [url]
  if (Array.isArray(subtitlePaths)) {
    for (const sp of subtitlePaths) args.push('--sub-file', sp)
  }
  const proc = spawn(vlcPath, args, { detached: true, stdio: 'ignore' })
  proc.on('error', (err) => { throw new Error('Failed to launch VLC: ' + err.message) })
  proc.unref()
  return { ok: true }
}

ipcMain.handle('stream-file', async (event, fileIndex) => streamFile(fileIndex))

ipcMain.handle('launch-vlc', async (event, url, subtitlePaths) => launchVlc(url, subtitlePaths))

// ---- Settings ----
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const settings = {
  vlcPath: null,
  downloadPath: null,   // null → OS Downloads folder
  saveMode: 'memory'    // 'memory' | 'disk'
}
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    Object.assign(settings, s)
  } catch (e) {}
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)) } catch (e) {}
}

ipcMain.handle('get-settings', async () => ({
  vlcPath: settings.vlcPath || null,
  downloadPath: settings.downloadPath || app.getPath('downloads'),
  saveMode: settings.saveMode
}))

ipcMain.handle('set-vlc-path', async (event, vlcPath) => {
  if (vlcPath) { settings.vlcPath = vlcPath; saveSettings() }
  return settings.vlcPath || null
})

ipcMain.handle('prompt-vlc-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Locate vlc.exe',
    filters: [{ name: 'VLC executable', extensions: ['exe'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths.length) return settings.vlcPath
  settings.vlcPath = result.filePaths[0]
  saveSettings()
  return settings.vlcPath
})

ipcMain.handle('set-download-path', async (event, p) => {
  if (p) { settings.downloadPath = p; saveSettings() }
  return settings.downloadPath || app.getPath('downloads')
})

ipcMain.handle('prompt-download-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a download folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths.length) return settings.downloadPath
  settings.downloadPath = result.filePaths[0]
  saveSettings()
  return settings.downloadPath
})

ipcMain.handle('set-save-mode', async (event, mode) => {
  if (mode === 'disk' || mode === 'memory') {
    settings.saveMode = mode
    saveSettings()
  }
  return settings.saveMode
})

function findVlc() {
  if (settings.vlcPath && fs.existsSync(settings.vlcPath)) return settings.vlcPath
  const candidates = [
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\VideoLAN\\VLC\\vlc.exe'
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      settings.vlcPath = c
      saveSettings()
      return c
    }
  }
  return null
}

// ---- Close behavior: warn about on-disk data in disk mode ----
app.on('before-quit', async (event) => {
  if (quitting) return
  // If we have a torrent folder on disk, ask the user whether to keep or delete.
  if (settings.saveMode === 'disk' && currentTorrentFolder && fs.existsSync(currentTorrentFolder)) {
    event.preventDefault()
    quitting = true
    const choice = dialog.showMessageBoxSync(mainWindow || undefined, {
      type: 'question',
      buttons: ['Keep files', 'Delete files', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Torrent files on disk',
      message: 'You have downloaded torrent data saved on disk. Keep it or delete it?',
      detail: currentTorrentFolder
    })
    if (choice === 2) {
      // Cancel the quit entirely.
      quitting = false
      return
    }
    cleanup(choice === 1)
    app.quit()
  }
})

let quitting = false

// Register as the magnet: handler ONLY while the app is running, so it "takes priority"
// when open but leaves the system default untouched when closed.
function registerMagnetHandler() {
  try { app.setAsDefaultProtocolClient('magnet') } catch (e) {}
}
function unregisterMagnetHandler() {
  try { app.removeAsDefaultProtocolClient('magnet') } catch (e) {}
}

// Windows/Linux: clicking a magnet launches a second instance with the URL as argv.
app.on('second-instance', (event, argv) => {
  const uri = argv.find((a) => /^magnet:\?/i.test(a))
  if (uri) handleIncomingMagnet(uri)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
// macOS: the OS delivers the URL via open-url.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleIncomingMagnet(url)
})

app.whenReady().then(() => {
  loadSettings()
  createWindow()
  registerMagnetHandler()
  startMagnetServer()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Teardown server/torrent but rely on before-quit for the delete prompt.
  if (streamServer) { try { streamServer.close() } catch (e) {} streamServer = null }
  if (process.platform !== 'darwin') app.quit()
})

// Remove the magnet handler on quit so the system default is restored.
app.on('will-quit', () => {
  unregisterMagnetHandler()
  killBrave()
})
