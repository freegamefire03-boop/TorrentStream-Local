const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  loadMagnet: (uri) => ipcRenderer.invoke('load-magnet', uri),
  loadTorrentFile: (filePath) => ipcRenderer.invoke('load-torrent-file', filePath),
  loadTorrentUrl: (url) => ipcRenderer.invoke('load-torrent-url', url),
  pickTorrentFile: () => ipcRenderer.invoke('pick-torrent-file'),
  searchTorrents: (query, opts) => ipcRenderer.invoke('search-torrents', query, opts),
  streamFile: (index) => ipcRenderer.invoke('stream-file', index),
  launchVlc: (url, subtitlePaths) => ipcRenderer.invoke('launch-vlc', url, subtitlePaths),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setVlcPath: (p) => ipcRenderer.invoke('set-vlc-path', p),
  promptVlcPath: () => ipcRenderer.invoke('prompt-vlc-path'),
  setDownloadPath: (p) => ipcRenderer.invoke('set-download-path', p),
  promptDownloadPath: () => ipcRenderer.invoke('prompt-download-path'),
  setSaveMode: (mode) => ipcRenderer.invoke('set-save-mode', mode),
  onMagnetReceived: (cb) => ipcRenderer.on('magnet-received', (e, uri) => cb(uri)),
  onMagnetLoaded: (cb) => ipcRenderer.on('magnet-loaded', (e, result) => cb(result)),
  onMagnetError: (cb) => ipcRenderer.on('magnet-error', (e, msg) => cb(msg)),
  launchBrave1337x: () => ipcRenderer.invoke('launch-brave-1337x')
})
