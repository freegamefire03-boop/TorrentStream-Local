// Torrent search providers. Each provider exposes:
//   name: string
//   search(query, opts) -> Promise<Array<Result>>
// Result shape:
//   { title, year, size (bytes), seeders, leechers, rating (imdb 0-10 or null),
//     magnet, torrentUrl, quality, provider, poster }
const https = require('https')
const { URL } = require('url')

function httpsGetJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'TorrentStream-Local' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          return resolve(httpsGetJson(next, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error('Search request failed (HTTP ' + res.statusCode + ')'))
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('Bad response from search provider'))
          }
        })
      })
      .on('error', reject)
  })
}

function qualityToBytes(sizeStr) {
  // YTS returns sizes like "1.2 GB" or "850 MB"
  if (!sizeStr) return 0
  const m = /([\d.]+)\s*(GB|MB|KB|B)/i.exec(sizeStr)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toUpperCase()
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[unit] || 1
  return Math.round(n * mult)
}

// ---- YTS (YIFY) provider ----
const yts = {
  name: 'YTS',
  async search(query, opts = {}) {
    const term = encodeURIComponent(query.trim())
    const url = `https://yts.am/api/v2/list_movies.json?query_term=${term}&limit=20&sort_by=seeds`
    const json = await httpsGetJson(url)
    const movies = json?.data?.movies || []
    const minSeeders = opts.minSeeders ?? 0
    const results = []
    for (const m of movies) {
      const torrents = m.torrents || []
      for (const t of torrents) {
        const seeders = parseInt(t.seeds, 10) || 0
        if (seeders < minSeeders) continue
        results.push({
          title: m.title,
          year: m.year || null,
          size: qualityToBytes(t.size),
          seeders,
          leechers: parseInt(t.peers, 10) || 0,
          rating: m.rating ? parseFloat(m.rating) : null,
          magnet: t.magnet || null,
          torrentUrl: t.url || null,
          quality: t.quality || null,
          provider: 'YTS',
          poster: m.medium_cover_image || m.large_cover_image || null
        })
      }
    }
    return rank(results, opts)
  }
}

// Rank: respect keyword relevance (already server-filtered), then sort by
// seeders desc, tie-broken by rating desc, preferring 1080p.
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

// ---- TPB (The Pirate Bay) via apibay.org ----
// General index: movies, TV (cat 205/208), etc. No rating, so rank by seeders only.
const TV_CATS = new Set(['205', '208'])
function tpbCatLabel(cat) {
  if (TV_CATS.has(cat)) return 'TV'
  if (cat === '201' || cat === '202') return 'Movies'
  if (cat === '100') return 'Audio'
  if (cat === '300') return 'Apps'
  if (cat === '400') return 'Games'
  return 'Other'
}
const tpb = {
  name: 'TPB',
  async search(query, opts = {}) {
    const term = encodeURIComponent(query.trim())
    const url = `https://apibay.org/q.php?q=${term}&cat=0`
    const json = await httpsGetJson(url)
    if (!Array.isArray(json) || json.length === 0) return []
    if (json[0] && json[0].error) return []
    const minSeeders = opts.minSeeders ?? 0
    const results = []
    // WebTorrent finds peers best via WebSocket (wss://) trackers; UDP trackers have
    // limited support in WebTorrent, so we append public WS trackers to every magnet.
    const WS_TRACKERS = [
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.webtorrent.dev'
    ]
    for (const t of json) {
      const seeders = parseInt(t.seeders, 10) || 0
      if (seeders < minSeeders) continue
      const hash = t.info_hash ? t.info_hash.toLowerCase() : ''
      const dn = encodeURIComponent(t.name || 'torrent')
      let magnet = null
      if (hash) {
        magnet = `magnet:?xt=urn:btih:${hash}&dn=${dn}`
        for (const tr of WS_TRACKERS) magnet += `&tr=${encodeURIComponent(tr)}`
      }
      results.push({
        title: t.name,
        year: null,
        size: parseInt(t.size, 10) || 0,
        seeders,
        leechers: parseInt(t.leechers, 10) || 0,
        rating: null,
        magnet,
        torrentUrl: null,
        quality: tpbCatLabel(t.category),
        provider: 'TPB',
        poster: null
      })
    }
    // Keyword relevance preserved (server already matched). Rank by seeders desc.
    return results.sort((a, b) => b.seeders - a.seeders)
  }
}

const providers = { YTS: yts, TPB: tpb }

async function searchAll(query, opts = {}) {
  const useProviders = opts.providers || Object.keys(providers)
  const all = []
  for (const name of useProviders) {
    const p = providers[name]
    if (!p) continue
    try {
      const r = await p.search(query, opts)
      all.push(...r)
    } catch (e) {
      console.error(`provider ${name} failed:`, e.message)
    }
  }
  return rank(all, opts)
}

module.exports = { providers, searchAll }
