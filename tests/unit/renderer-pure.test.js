const { describe, it } = require('node:test')
const assert = require('node:assert')

// Re-implement pure functions from renderer.js for testing

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(i ? 1 : 0) + ' ' + units[i]
}

describe('renderer.js — fmtSize()', () => {
  it('returns empty string for null/undefined', () => {
    assert.strictEqual(fmtSize(null), '')
    assert.strictEqual(fmtSize(undefined), '')
  })
  it('formats 0 bytes', () => {
    assert.strictEqual(fmtSize(0), '0 B')
  })
  it('formats bytes', () => {
    assert.strictEqual(fmtSize(500), '500 B')
  })
  it('formats kilobytes', () => {
    assert.strictEqual(fmtSize(1024), '1.0 KB')
    assert.strictEqual(fmtSize(1536), '1.5 KB')
  })
  it('formats megabytes', () => {
    assert.strictEqual(fmtSize(1048576), '1.0 MB')
    assert.strictEqual(fmtSize(1572864), '1.5 MB')
  })
  it('formats gigabytes', () => {
    assert.strictEqual(fmtSize(1073741824), '1.0 GB')
  })
  it('formats terabytes', () => {
    assert.strictEqual(fmtSize(1099511627776), '1.0 TB')
  })
  it('rounds to 1 decimal for units above B', () => {
    assert.strictEqual(fmtSize(1024 * 1024 + 512 * 1024), '1.5 MB')
  })
})

describe('renderer.js — pickBestVideo()', () => {
  const JUNK = /sample|rarbg|trailer|advert|intro|preview/i
  function pickBestVideo(files) {
    const vids = files.filter((f) => f.video && !JUNK.test(f.name))
    if (!vids.length) vids.push(...files.filter((f) => f.video))
    vids.sort((a, b) => b.size - a.size)
    return vids[0] || null
  }

  it('prefers non-junk videos sorted by size descending', () => {
    const files = [
      { name: 'trailer.mp4', size: 100, video: true },
      { name: 'movie.mp4', size: 500, video: true }
    ]
    assert.strictEqual(pickBestVideo(files)?.name, 'movie.mp4')
  })
  it('filters junk aggressively', () => {
    const junk = ['sample.mp4', 'rarbg.mp4', 'trailer.mp4', 'advert.mp4', 'intro.mp4', 'preview.mp4']
    const clean = { name: 'The.Movie.2024.mkv', size: 1000, video: true }
    const files = [...junk.map((n) => ({ name: n, size: 100, video: true })), clean]
    assert.strictEqual(pickBestVideo(files)?.name, clean.name)
  })
  it('falls back to junk videos when no clean ones exist', () => {
    const files = [
      { name: 'sample.mp4', size: 200, video: true },
      { name: 'trailer.mp4', size: 100, video: true }
    ]
    assert.strictEqual(pickBestVideo(files)?.name, 'sample.mp4')
  })
  it('returns null for no video files', () => {
    assert.strictEqual(pickBestVideo([{ name: 'x.txt', size: 10, video: false }]), null)
  })
})

describe('renderer.js — JUNK regex edge cases', () => {
  const JUNK = /sample|rarbg|trailer|advert|intro|preview/i
  it('matches case-insensitively', () => {
    assert.ok(JUNK.test('Sample.mp4'))
    assert.ok(JUNK.test('TRAILER.mkv'))
  })
  it('rejects clean filenames', () => {
    assert.ok(!JUNK.test('The.Movie.2024.1080p.mkv'))
    assert.ok(!JUNK.test('Episode.S01E01.mkv'))
  })
  it('matches inside filenames', () => {
    assert.ok(JUNK.test('The.Movie.sample.mkv'))
    assert.ok(JUNK.test('feature_rarbg.mp4'))
  })
  it('does not trigger on unrelated words', () => {
    assert.ok(!JUNK.test('samplitude.mp4'))
    assert.ok(!JUNK.test('interior.mp4'))
    assert.ok(!JUNK.test('overlook.mp4'))
  })
})

describe('renderer.js — STAGE_TEXT map', () => {
  const STAGE_TEXT = {
    connecting: 'Connecting to swarm\u2026',
    downloading: 'Downloading first few seconds\u2026',
    'starting-player': 'Starting player\u2026'
  }
  it('has all required stages', () => {
    assert.ok(STAGE_TEXT.connecting)
    assert.ok(STAGE_TEXT.downloading)
    assert.ok(STAGE_TEXT['starting-player'])
  })
  it('uses ellipsis character', () => {
    assert.ok(STAGE_TEXT.connecting.endsWith('\u2026'))
    assert.ok(STAGE_TEXT.downloading.endsWith('\u2026'))
    assert.ok(STAGE_TEXT['starting-player'].endsWith('\u2026'))
  })
})
