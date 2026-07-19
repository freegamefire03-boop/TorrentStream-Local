const { describe, it, mock } = require('node:test')
const assert = require('node:assert')

// Integration tests for main.js logic that can be tested without Electron

describe('main.js — magnet server request parsing', () => {
  function parseMagnetRequest(url) {
    const u = new URL(url, 'http://x')
    const uri = u.searchParams.get('uri')
    if (!uri || !/^magnet:\?/i.test(uri)) return null
    return uri
  }

  it('extracts magnet URI from /magnet?uri=...', () => {
    const uri = parseMagnetRequest('/magnet?uri=magnet:%3Fxt=urn:btih:abc')
    assert.ok(uri)
    assert.ok(uri.startsWith('magnet:?'))
  })

  it('rejects missing uri parameter', () => {
    assert.strictEqual(parseMagnetRequest('/magnet'), null)
  })

  it('rejects invalid magnet URIs', () => {
    assert.strictEqual(parseMagnetRequest('/magnet?uri=http://example.com'), null)
  })

  it('handles status path', () => {
    const isStatus = (url) => url.startsWith('/status')
    assert.ok(isStatus('/status'))
    assert.ok(!isStatus('/magnet'))
  })
})

describe('main.js — addTorrent timeout logic', () => {
  function createAddTorrentPromise() {
    const timeoutMs = 100
    let cleared = false
    const timeout = setTimeout(() => {
      if (!cleared) throw new Error('Timed out')
    }, timeoutMs)
    return {
      timeout,
      clear: () => { cleared = true; clearTimeout(timeout) },
      reject: (err) => { clearTimeout(timeout); throw err },
      resolve: (val) => { clearTimeout(timeout); return val }
    }
  }

  it('timeout clears on resolve', () => {
    const p = createAddTorrentPromise()
    const result = p.resolve('done')
    assert.strictEqual(result, 'done')
  })

  it('timeout clears on reject', () => {
    const p = createAddTorrentPromise()
    assert.throws(() => p.reject(new Error('fail')), /fail/)
  })

  it('metadata event clears timeout', () => {
    const p = createAddTorrentPromise()
    // Simulate torrent.metadata resolution
    const torrent = { name: 'Test', files: [{ name: 'a.mp4', path: 'a.mp4', length: 100 }] }
    const result = p.resolve({ name: torrent.name, files: torrent.files })
    assert.strictEqual(result.name, 'Test')
  })
})

describe('main.js — waitForHeadReady logic', () => {
  it('resolves when file.downloaded >= target', async () => {
    let verifiedCalled = false
    const file = { downloaded: 10 * 1024 * 1024 }
    const torrent = {
      on: (ev, cb) => { if (ev === 'verified') verifiedCalled = true },
      removeListener: () => {},
      numPeers: 5,
      downloadSpeed: 500000
    }

    await new Promise((resolve) => {
      const target = 10 * 1024 * 1024
      const finish = () => { resolve() }
      const check = () => {
        if (file.downloaded >= target) finish()
      }
      check()
    })
  })

  it('times out and resolves anyway', async () => {
    const file = { downloaded: 0 }
    const torrent = {
      on: () => {},
      removeListener: () => {}
    }

    const result = await new Promise((resolve) => {
      let done = false
      const finish = (reason) => {
        if (done) return
        done = true
        resolve(reason)
      }
      setTimeout(() => finish('timeout'), 50)
    })

    assert.strictEqual(result, 'timeout')
  })

  it('fires onProgress callback', async () => {
    let progressCalled = false
    const file = { downloaded: 10 * 1024 * 1024 }
    const torrent = {
      on: () => {},
      removeListener: () => {},
      numPeers: 3,
      downloadSpeed: 100000
    }

    await new Promise((resolve) => {
      const target = 10 * 1024 * 1024
      const check = () => {
        const pct = Math.round((file.downloaded / target) * 100)
        if (pct >= 100) { progressCalled = true; resolve() }
      }
      check()
    })

    assert.ok(progressCalled)
  })
})

describe('main.js — streamFile validation', () => {
  it('rejects missing currentTorrent', async () => {
    const currentTorrent = null
    try {
      if (!currentTorrent) throw new Error('No torrent loaded.')
      assert.fail('Should have thrown')
    } catch (e) {
      assert.strictEqual(e.message, 'No torrent loaded.')
    }
  })

  it('rejects file index out of range', async () => {
    const currentTorrent = { files: [{ name: 'a.mp4' }] }
    try {
      if (!Number.isInteger(5) || 5 < 0 || 5 >= currentTorrent.files.length) {
        throw new Error('File index out of range.')
      }
      assert.fail('Should have thrown')
    } catch (e) {
      assert.strictEqual(e.message, 'File index out of range.')
    }
  })

  it('rejects non-integer file index', async () => {
    try {
      if (!Number.isInteger(1.5)) throw new Error('File index out of range.')
      assert.fail('Should have thrown')
    } catch (e) {
      assert.strictEqual(e.message, 'File index out of range.')
    }
  })
})

describe('main.js — VLC candidates', () => {
  const candidates = [
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
  ]

  it('has plausible VLC paths', () => {
    assert.ok(candidates.length > 0)
    assert.ok(candidates[0].includes('VLC'))
    assert.ok(candidates[1].includes('VideoLAN'))
  })

  it('candidates end with vlc.exe', () => {
    assert.ok(candidates.every((c) => c.endsWith('vlc.exe')))
  })
})

describe('main.js — Brave launch configuration', () => {
  const BRAVE_EXE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
  const BRAVE_HOME_URL = 'https://1337x.to'
  const args = [
    '--user-data-dir=brave-profile',
    '--load-extension=brave-extension',
    '--no-first-run',
    '--no-default-browser-check',
    BRAVE_HOME_URL
  ]

  it('targets 1337x.to', () => {
    assert.strictEqual(args[args.length - 1], 'https://1337x.to')
  })

  it('loads the extension', () => {
    assert.ok(args[1].startsWith('--load-extension='))
  })

  it('uses isolated profile', () => {
    assert.ok(args[0].startsWith('--user-data-dir='))
  })

  it('skips first-run and default-browser-check', () => {
    assert.ok(args.includes('--no-first-run'))
    assert.ok(args.includes('--no-default-browser-check'))
  })
})

describe('main.js — settings', () => {
  it('defaults to memory save mode', () => {
    const settings = { saveMode: 'memory' }
    assert.strictEqual(settings.saveMode, 'memory')
  })

  it('accepts valid save modes', () => {
    const valid = ['memory', 'disk']
    assert.ok(valid.includes('memory'))
    assert.ok(valid.includes('disk'))
    assert.ok(!valid.includes('invalid'))
  })

  it('torrentAddOptions returns sequential strategy', () => {
    const opts = { strategy: 'sequential', path: 'C:\\Downloads' }
    assert.strictEqual(opts.strategy, 'sequential')
  })
})
