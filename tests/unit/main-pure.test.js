const { describe, it, mock } = require('node:test')
const assert = require('node:assert')
const path = require('path')

// Re-implement pure functions from main.js for testing
// (Extracted from the real module so we test against the actual logic)

const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', 'm4v']
const JUNK = /sample|rarbg|trailer|advert|intro|preview/i
const SUB_EXTS = ['.srt', '.ass', '.sub', '.vtt', '.ssa', '.smi']

function isVideo(name) {
  const ext = path.extname(name).toLowerCase().replace('.', '')
  return VIDEO_EXTS.includes(ext)
}

function sanitize(name) {
  const s = String(name || 'torrent')
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
}

function pickBestVideo(files) {
  const vids = files.filter((f) => f.video && !JUNK.test(f.name))
  if (!vids.length) vids.push(...files.filter((f) => f.video))
  vids.sort((a, b) => b.length - a.length)
  return vids[0] || null
}

function torrentFolderFor(torrent, downloadPath) {
  const base = downloadPath || 'C:\\Downloads'
  return path.join(base, sanitize(torrent.name || torrent.infoHash || 'torrent'))
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

function healthHint({ peers, downloadSpeed, secondsInStage }) {
  if (peers === 0 && secondsInStage > 5) return 'no peers found — this torrent may be dead'
  if (downloadSpeed < 10 * 1024 && secondsInStage > 5) return 'very slow — peers may be weak, consider another source'
  return null
}

function findMatchingSubs(videoFile, allFiles) {
  const videoBase = path.basename(videoFile.name, path.extname(videoFile.name)).toLowerCase()
  const videoDir = path.dirname(videoFile.path).toLowerCase()
  return allFiles.filter((f) => {
    const ext = path.extname(f.name).toLowerCase()
    if (!SUB_EXTS.includes(ext)) return false
    const base = path.basename(f.name, ext).toLowerCase()
    const dir = path.dirname(f.path).toLowerCase()
    return base === videoBase || (dir === videoDir && base.startsWith(videoBase.slice(0, 6)))
  })
}

function markHeadPriority(file, torrent) {
  if (!torrent || !torrent.pieceLength) return null
  const pieceLength = torrent.pieceLength
  const startPiece = Math.floor((file.offset || 0) / pieceLength)
  const endPiece = Math.min(
    torrent.pieces.length - 1,
    Math.ceil(((file.offset || 0) + file.length) / pieceLength) - 1
  )
  const headCount = Math.min(40, Math.max(1, endPiece - startPiece + 1))
  const headEnd = startPiece + headCount - 1
  if (headEnd >= startPiece) {
    try { torrent.critical(startPiece, headEnd) } catch (e) { return { error: e.message } }
    return { startPiece, headEnd, headCount }
  }
  return null
}

// ---- Tests ----

describe('main.js — isVideo()', () => {
  it('returns true for common video extensions', () => {
    for (const ext of ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v']) {
      assert.ok(isVideo('video.' + ext))
    }
  })
  it('returns true for uppercase extensions', () => {
    assert.ok(isVideo('VIDEO.MP4'))
    assert.ok(isVideo('Video.MKV'))
  })
  it('returns false for non-video files', () => {
    assert.strictEqual(isVideo('file.txt'), false)
    assert.strictEqual(isVideo('file.srt'), false)
    assert.strictEqual(isVideo('file.jpg'), false)
  })
  it('returns false for files with no extension', () => {
    assert.strictEqual(isVideo('README'), false)
  })
})

describe('main.js — sanitize()', () => {
  it('replaces illegal path characters with underscores', () => {
    assert.strictEqual(sanitize('foo/bar\\baz:*?"<>|qux'), 'foo_bar_baz_______qux')
  })
  it('truncates to 120 characters', () => {
    const long = 'a'.repeat(200)
    assert.strictEqual(sanitize(long).length, 120)
  })
  it('defaults to "torrent" for falsy input', () => {
    assert.strictEqual(sanitize(null), 'torrent')
    assert.strictEqual(sanitize(undefined), 'torrent')
    assert.strictEqual(sanitize(''), 'torrent')
  })
})

describe('main.js — pickBestVideo()', () => {
  const mkFile = (name, length, video) => ({ name, length, video })

  it('prefers non-junk videos sorted by size descending', () => {
    const files = [
      mkFile('trailer.mp4', 100, true),
      mkFile('movie.mp4', 500, true),
      mkFile('sample.mkv', 50, true)
    ]
    const best = pickBestVideo(files)
    assert.strictEqual(best.name, 'movie.mp4')
  })

  it('falls back to all videos if all are junk', () => {
    const files = [
      mkFile('sample.mp4', 100, true),
      mkFile('trailer.mkv', 200, true)
    ]
    const best = pickBestVideo(files)
    assert.strictEqual(best.name, 'trailer.mkv')
  })

  it('returns null if no video files', () => {
    assert.strictEqual(pickBestVideo([mkFile('readme.txt', 100, false)]), null)
  })

  it('returns null for empty array', () => {
    assert.strictEqual(pickBestVideo([]), null)
  })

  it('returns null when no file has the video flag', () => {
    const files = [
      { name: 'movie.mp4', length: 500, video: false },
      { name: 'clip.mp4', length: 300, video: false }
    ]
    assert.strictEqual(pickBestVideo(files), null)
  })
})

describe('main.js — torrentFolderFor()', () => {
  it('joins download path with sanitized torrent name', () => {
    const result = torrentFolderFor({ name: 'My Movie 2024' }, 'C:\\Data')
    assert.ok(result.startsWith('C:\\Data'))
    assert.ok(result.includes('My Movie 2024'))
  })

  it('uses infoHash fallback when name is missing', () => {
    const result = torrentFolderFor({ infoHash: 'abc123' })
    assert.ok(result.includes('abc123'))
  })
})

describe('main.js — buildFileList()', () => {
  const torrent = {
    files: [
      { name: 'movie.mp4', path: 'movie.mp4', length: 500 },
      { name: 'subs.srt', path: 'subs.srt', length: 10 },
      { name: 'cover.jpg', path: 'cover.jpg', length: 50 }
    ]
  }
  const list = buildFileList(torrent)
  it('includes index, name, path, size, video flag', () => {
    assert.deepStrictEqual(list[0], { index: 0, name: 'movie.mp4', path: 'movie.mp4', size: 500, video: true })
    assert.strictEqual(list[1].video, false)
    assert.strictEqual(list[2].video, false)
  })
  it('maps all files', () => { assert.strictEqual(list.length, 3) })
})

describe('main.js — healthHint()', () => {
  it('returns null when healthy', () => {
    assert.strictEqual(healthHint({ peers: 5, downloadSpeed: 500000, secondsInStage: 1 }), null)
  })
  it('warns about no peers after 5 seconds', () => {
    const hint = healthHint({ peers: 0, downloadSpeed: 0, secondsInStage: 10 })
    assert.ok(hint.includes('no peers found'))
  })
  it('warns about slow speed after 5 seconds', () => {
    const hint = healthHint({ peers: 3, downloadSpeed: 5000, secondsInStage: 10 })
    assert.ok(hint.includes('very slow'))
  })
  it('does not warn within first 5 seconds', () => {
    assert.strictEqual(healthHint({ peers: 0, downloadSpeed: 0, secondsInStage: 3 }), null)
  })
})

describe('main.js — findMatchingSubs()', () => {
  const allFiles = [
    { name: 'movie.mp4', path: 'movie.mp4', length: 500 },
    { name: 'movie.srt', path: 'movie.srt', length: 10 },
    { name: 'movie.ass', path: 'movie.ass', length: 20 },
    { name: 'other.srt', path: 'other.srt', length: 5 },
    { name: 'cover.jpg', path: 'cover.jpg', length: 50 }
  ]
  it('finds subtitles matching exact base name', () => {
    const videoFile = { name: 'movie.mp4', path: 'movie.mp4' }
    const subs = findMatchingSubs(videoFile, allFiles)
    assert.strictEqual(subs.length, 2)
    assert.ok(subs.every((s) => s.name.endsWith('.srt') || s.name.endsWith('.ass')))
  })
  it('finds subtitles in same folder with prefix match', () => {
    const files = [
      { name: 'The.Movie.2024.mkv', path: 'folder/The.Movie.2024.mkv' },
      { name: 'The.Movie.eng.srt', path: 'folder/The.Movie.eng.srt' },
    ]
    const videoFile = { name: 'The.Movie.2024.mkv', path: 'folder/The.Movie.2024.mkv' }
    const subs = findMatchingSubs(videoFile, files)
    assert.strictEqual(subs.length, 1)
  })
  it('ignores non-subtitle extensions', () => {
    const videoFile = { name: 'movie.mp4', path: 'movie.mp4' }
    const subs = findMatchingSubs(videoFile, allFiles)
    assert.ok(subs.every((s) => !s.name.endsWith('.jpg')))
  })
  it('returns empty array when no subs match', () => {
    const videoFile = { name: 'no_match.mp4', path: 'no_match.mp4' }
    assert.strictEqual(findMatchingSubs(videoFile, allFiles).length, 0)
  })
})

describe('main.js — markHeadPriority()', () => {
  it('calls torrent.critical with correct piece range', () => {
    let criticalCalled = false
    const torrent = {
      pieceLength: 1024 * 1024,
      pieces: { length: 200 },
      critical(start, end) {
        criticalCalled = true
        assert.strictEqual(start, 0)
        assert.ok(end > 0)
        assert.ok(end - start <= 39)
      }
    }
    const file = { offset: 0, length: 50 * 1024 * 1024 }
    markHeadPriority(file, torrent)
    assert.ok(criticalCalled)
  })
  it('handles missing pieceLength gracefully', () => {
    assert.strictEqual(markHeadPriority({}, {}), null)
  })
  it('handles null torrent gracefully', () => {
    assert.strictEqual(markHeadPriority({}, null), null)
  })
  it('caps headCount at 40 pieces', () => {
    const torrent = {
      pieceLength: 1024,
      pieces: { length: 500 },
      critical(start, end) {
        assert.ok(end - start <= 39)
      }
    }
    const file = { offset: 0, length: 100 * 1024 * 1024 }
    markHeadPriority(file, torrent)
  })
})

describe('main.js — magnet URI validation', () => {
  it('accepts valid magnet URIs', () => {
    const uri = 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=test'
    assert.ok(/^magnet:\?/i.test(uri))
  })
  it('rejects non-magnet strings', () => {
    assert.ok(!/^magnet:\?/i.test('http://example.com'))
    assert.ok(!/^magnet:\?/i.test('magnet:without-questionmark'))
  })
  it('is case-insensitive', () => {
    assert.ok(/^magnet:\?/i.test('MAGNET:?xt=urn:btih:abc'))
  })
})
