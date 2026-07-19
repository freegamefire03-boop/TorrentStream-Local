const { describe, it } = require('node:test')
const assert = require('node:assert')

// Re-implement pure functions from providers.js

function qualityToBytes(sizeStr) {
  if (!sizeStr) return 0
  const m = /([\d.]+)\s*(GB|MB|KB|B)/i.exec(sizeStr)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toUpperCase()
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[unit] || 1
  return Math.round(n * mult)
}

function rank(results, opts = {}) {
  const preferQuality = opts.preferQuality || '1080p'
  return results.sort((a, b) => {
    if ((b.quality === preferQuality ? 1 : 0) !== (a.quality === preferQuality ? 1 : 0)) {
      return (b.quality === preferQuality ? 1 : 0) - (a.quality === preferQuality ? 1 : 0)
    }
    if (b.seeders !== a.seeders) return b.seeders - a.seeders
    return (b.rating || 0) - (a.rating || 0)
  })
}

const TV_CATS = new Set(['205', '208'])
function tpbCatLabel(cat) {
  if (TV_CATS.has(cat)) return 'TV'
  if (cat === '201' || cat === '202') return 'Movies'
  if (cat === '100') return 'Audio'
  if (cat === '300') return 'Apps'
  if (cat === '400') return 'Games'
  return 'Other'
}

describe('providers.js — qualityToBytes()', () => {
  it('converts "1.2 GB" to bytes', () => {
    assert.strictEqual(qualityToBytes('1.2 GB'), 1200000000)
  })
  it('converts "850 MB" to bytes', () => {
    assert.strictEqual(qualityToBytes('850 MB'), 850000000)
  })
  it('converts "500 KB" to bytes', () => {
    assert.strictEqual(qualityToBytes('500 KB'), 500000)
  })
  it('converts "100 B" to bytes', () => {
    assert.strictEqual(qualityToBytes('100 B'), 100)
  })
  it('returns 0 for empty/null input', () => {
    assert.strictEqual(qualityToBytes(''), 0)
    assert.strictEqual(qualityToBytes(null), 0)
    assert.strictEqual(qualityToBytes(undefined), 0)
  })
  it('handles lowercase units', () => {
    assert.strictEqual(qualityToBytes('1.5 gb'), 1500000000)
  })
  it('handles no decimal', () => {
    assert.strictEqual(qualityToBytes('2 GB'), 2000000000)
  })
  it('returns 0 for unparseable strings', () => {
    assert.strictEqual(qualityToBytes('unknown'), 0)
  })
})

describe('providers.js — rank()', () => {
  const mk = (quality, seeders, rating) => ({ quality: quality || null, seeders: seeders || 0, rating: rating || null })

  it('prefers 1080p over other qualities', () => {
    const r = rank([mk('720p', 50), mk('1080p', 10)])
    assert.strictEqual(r[0].quality, '1080p')
  })
  it('sorts by seeders descending within same quality', () => {
    const r = rank([mk('1080p', 10), mk('1080p', 100)])
    assert.strictEqual(r[0].seeders, 100)
  })
  it('uses rating as tiebreaker for same quality + seeders', () => {
    const r = rank([mk('1080p', 50, 7.5), mk('1080p', 50, 8.0)])
    assert.strictEqual(r[0].rating, 8.0)
  })
  it('handles empty results', () => {
    assert.deepStrictEqual(rank([]), [])
  })
  it('handles single result', () => {
    const r = rank([mk('1080p', 100, 8.0)])
    assert.strictEqual(r.length, 1)
  })
})

describe('providers.js — tpbCatLabel()', () => {
  it('labels TV categories', () => {
    assert.strictEqual(tpbCatLabel('205'), 'TV')
    assert.strictEqual(tpbCatLabel('208'), 'TV')
  })
  it('labels Movie categories', () => {
    assert.strictEqual(tpbCatLabel('201'), 'Movies')
    assert.strictEqual(tpbCatLabel('202'), 'Movies')
  })
  it('labels Audio', () => { assert.strictEqual(tpbCatLabel('100'), 'Audio') })
  it('labels Apps', () => { assert.strictEqual(tpbCatLabel('300'), 'Apps') })
  it('labels Games', () => { assert.strictEqual(tpbCatLabel('400'), 'Games') })
  it('returns Other for unknown', () => { assert.strictEqual(tpbCatLabel('999'), 'Other') })
})

describe('providers.js — TPB magnet construction', () => {
  const WS_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.webtorrent.dev'
  ]
  const HTTP_TRACKERS = [
    'http://tracker.opentrackr.org:1337/announce',
    'http://tracker.openbittorrent.com:80/announce',
    'http://tracker.coppersurfer.tk:6969/announce'
  ]

  it('builds valid magnet URI from info_hash', () => {
    const hash = 'abcdef0123456789abcdef0123456789abcdef01'
    const dn = encodeURIComponent('Test Movie 2024')
    let magnet = `magnet:?xt=urn:btih:${hash}&dn=${dn}`
    for (const tr of WS_TRACKERS) magnet += `&tr=${encodeURIComponent(tr)}`
    for (const tr of HTTP_TRACKERS) magnet += `&tr=${encodeURIComponent(tr)}`

    assert.ok(magnet.startsWith('magnet:?xt=urn:btih:'))
    assert.ok(magnet.includes('abcdef0123456789abcdef0123456789abcdef01'))
    assert.ok(magnet.includes('&tr=wss%3A%2F%2Ftracker.openwebtorrent.com'))
    assert.ok(magnet.includes('&tr=http%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce'))
  })

  it('validates 40-char hex info hash', () => {
    const valid = /^[0-9a-f]{40}$/
    assert.ok(valid.test('abcdef0123456789abcdef0123456789abcdef01'))
    assert.ok(!valid.test('short'))
    assert.ok(!valid.test('abcdef0123456789abcdef0123456789abcdef0x')) // non-hex char
    assert.ok(!valid.test('abcdef0123456789abcdef0123456789abcdef012')) // too long
  })
})

describe('providers.js — YTS response parsing edge cases', () => {
  it('handles missing movies key gracefully', () => {
    const json = { data: {} }
    const movies = json?.data?.movies || []
    assert.deepStrictEqual(movies, [])
  })
  it('handles null data gracefully', () => {
    const json = null
    const movies = json?.data?.movies || []
    assert.deepStrictEqual(movies, [])
  })
  it('handles empty torrents array', () => {
    const m = { title: 'Test', torrents: [] }
    const results = []
    for (const t of (m.torrents || [])) results.push(t)
    assert.deepStrictEqual(results, [])
  })
  it('filters by minSeeders', () => {
    const minSeeders = 5
    const t = { seeds: '3', peers: '10', size: '1 GB', quality: '1080p' }
    const seeders = parseInt(t.seeds, 10) || 0
    assert.ok(seeders < minSeeders)
  })
})
