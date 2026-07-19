const { describe, it, before, after, mock } = require('node:test')
const assert = require('node:assert')
const https = require('https')

// We test searchAll with mocked HTTP responses
// Import the real module
const { searchAll } = require('../../providers')

// Helper to mock https.get with a custom responder
function mockHttpsGet(responder) {
  mock.method(https, 'get', (url, opts, callback) => {
    if (typeof opts === 'function') { callback = opts; opts = {} }
    const res = responder(url)
    if (res instanceof Promise) {
      return res.then((r) => { callback(r); return { on: () => {} } })
    }
    process.nextTick(() => callback(res))
    return { on: () => {} }
  })
}

function restoreHttpsGet() {
  mock.restoreAll()
}

function makeResponse(statusCode, body, redirectLocation) {
  const chunks = typeof body === 'string' ? [Buffer.from(body)] : body
  const events = {}
  return {
    statusCode,
    headers: { location: redirectLocation },
    setEncoding: () => {},
    resume: () => {},
    on: (ev, cb) => {
      if (ev === 'data') {
        for (const c of chunks) process.nextTick(() => cb(c))
      } else if (ev === 'end') {
        process.nextTick(() => cb())
      } else {
        events[ev] = cb
      }
    }
  }
}

describe('providers.js — searchAll with mocked YTS', () => {
  before(() => {
    const ytsResponse = JSON.stringify({
      data: {
        movies: [
          {
            title: 'Test Movie',
            year: 2024,
            rating: 8.5,
            medium_cover_image: 'https://example.com/poster.jpg',
            torrents: [
              { quality: '1080p', size: '1.5 GB', seeds: '100', peers: '50', magnet: 'magnet:?xt=urn:btih:aaa', url: null },
              { quality: '720p', size: '800 MB', seeds: '50', peers: '25', magnet: 'magnet:?xt=urn:btih:bbb', url: null }
            ]
          }
        ]
      }
    })
    mockHttpsGet(() => makeResponse(200, ytsResponse))
  })

  after(() => restoreHttpsGet())

  it('returns results from YTS', async () => {
    const results = await searchAll('test', { providers: ['YTS'] })
    assert.ok(results.length > 0)
    assert.strictEqual(results[0].provider, 'YTS')
    assert.strictEqual(results[0].title, 'Test Movie')
  })

  it('prefers 1080p in ranking', async () => {
    const results = await searchAll('test', { providers: ['YTS'], preferQuality: '1080p' })
    assert.strictEqual(results[0].quality, '1080p')
  })

  it('filters by minSeeders', async () => {
    const results = await searchAll('test', { providers: ['YTS'], minSeeders: 80 })
    assert.ok(results.every((r) => r.seeders >= 80))
  })
})

describe('providers.js — searchAll with mocked TPB', () => {
  before(() => {
    const tpbResponse = JSON.stringify([
      {
        name: 'TV Show S01E01 1080p',
        seeders: '200',
        leechers: '50',
        size: '2147483648',
        info_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        category: '205'
      },
      {
        name: 'Movie 2024 720p',
        seeders: '50',
        leechers: '10',
        size: '1073741824',
        info_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        category: '201'
      }
    ])
    mockHttpsGet(() => makeResponse(200, tpbResponse))
  })

  after(() => restoreHttpsGet())

  it('returns results from TPB with magnets', async () => {
    const results = await searchAll('test', { providers: ['TPB'] })
    assert.ok(results.length > 0)
    assert.ok(results.every((r) => r.magnet && r.magnet.startsWith('magnet:')))
  })

  it('sets quality label from TPB category', async () => {
    const results = await searchAll('test', { providers: ['TPB'] })
    const tv = results.find((r) => r.quality === 'TV')
    const movie = results.find((r) => r.quality === 'Movies')
    assert.ok(tv)
    assert.ok(movie)
  })
})

describe('providers.js — searchAll error handling', () => {
  it('handles YTS HTTP error gracefully', async () => {
    mock.method(https, 'get', (url, opts, callback) => {
      if (typeof opts === 'function') { callback = opts; opts = {} }
      let responder
      if (String(url).includes('yts')) responder = () => makeResponse(500, 'Internal Server Error')
      else responder = () => makeResponse(200, JSON.stringify([]))
      process.nextTick(() => callback(responder(url)))
      return { on: () => {} }
    })
    const results = await searchAll('test', { providers: ['YTS', 'TPB'] })
    mock.restoreAll()
    assert.ok(Array.isArray(results))
  })

  it('handles malformed JSON from YTS gracefully', async () => {
    mock.method(https, 'get', (url, opts, callback) => {
      if (typeof opts === 'function') { callback = opts; opts = {} }
      let responder
      if (String(url).includes('yts')) responder = () => makeResponse(200, 'not json at all')
      else responder = () => makeResponse(200, JSON.stringify([]))
      process.nextTick(() => callback(responder(url)))
      return { on: () => {} }
    })
    const results = await searchAll('test', { providers: ['YTS', 'TPB'] })
    mock.restoreAll()
    assert.ok(Array.isArray(results))
  })

  it('handles TPB error response gracefully', async () => {
    mock.method(https, 'get', (url, opts, callback) => {
      if (typeof opts === 'function') { callback = opts; opts = {} }
      const responder = () => makeResponse(200, JSON.stringify([{ error: 'No results' }]))
      process.nextTick(() => callback(responder(url)))
      return { on: () => {} }
    })
    const results = await searchAll('test', { providers: ['TPB'] })
    mock.restoreAll()
    assert.strictEqual(results.length, 0)
  })
})

describe('providers.js — searchAll aggregation', () => {
  before(() => {
    // YTS returns nothing, TPB returns something
    mockHttpsGet((url) => {
      if (url.includes('yts')) return makeResponse(200, JSON.stringify({ data: { movies: [] } }))
      return makeResponse(200, JSON.stringify([
        { name: 'Result 1', seeders: '10', leechers: '5', size: '500', info_hash: 'cccccccccccccccccccccccccccccccccccccccc', category: '201' }
      ]))
    })
  })

  after(() => restoreHttpsGet())

  it('aggregates results from multiple providers', async () => {
    const results = await searchAll('test', { providers: ['YTS', 'TPB'] })
    assert.ok(results.length > 0)
    assert.strictEqual(results[0].provider, 'TPB')
  })

  it('handles empty providers list', async () => {
    const results = await searchAll('test', { providers: [] })
    assert.deepStrictEqual(results, [])
  })
})
