// Local dev server for Quizard: serves dist/quizard-ng/browser with SPA
// fallback and proxies /gemini to the production relay (the relay only
// accepts the production origin, so the browser can't call it directly from
// localhost — the server does it server-to-server instead).
//
// Usage:  node scripts/local-dev-server.mjs [port]   (default 4310)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2] || 4310)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'quizard-ng', 'browser')
const SITE_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'site')
const RELAY = 'https://quizard-relay.quizard-app.workers.dev/gemini'
const RELAY_EXTRACT = 'https://quizard-relay.quizard-app.workers.dev/extract'
const RELAY_RATINGS = 'https://quizard-relay.quizard-app.workers.dev/ratings'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json'
}

async function serveFile(res, path) {
  const body = await readFile(path)
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
  res.end(body)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')

    // relay proxy — forward the body verbatim, strip browser headers
    if (url.pathname === '/gemini' && req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks)
      const headers = { 'Content-Type': 'application/json' }
      if (req.headers['x-quizard-key']) headers['x-quizard-key'] = req.headers['x-quizard-key']
      let out = null
      try {
        out = await fetch(RELAY, { method: 'POST', headers, body })
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'proxy_relay_unreachable: ' + e.message }))
        return
      }
      res.writeHead(out.status, { 'Content-Type': out.headers.get('content-type') || 'application/json' })
      res.end(Buffer.from(await out.arrayBuffer()))
      return
    }

    // page-extraction proxy — same treatment as /gemini
    if (url.pathname === '/extract' && req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      let out = null
      try {
        out = await fetch(RELAY_EXTRACT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks) })
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'proxy_relay_unreachable: ' + e.message }))
        return
      }
      res.writeHead(out.status, { 'Content-Type': out.headers.get('content-type') || 'application/json' })
      res.end(Buffer.from(await out.arrayBuffer()))
      return
    }

    // docs ratings — same-origin locally so the docs page can call it without
    // CORS; production calls the relay directly.
    if (url.pathname === '/ratings' && (req.method === 'GET' || req.method === 'POST')) {
      const init = { method: req.method, headers: {} }
      if (req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        init.headers['Content-Type'] = 'application/json'
        init.body = Buffer.concat(chunks)
      }
      let out = null
      try {
        out = await fetch(RELAY_RATINGS, init)
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'proxy_relay_unreachable: ' + e.message }))
        return
      }
      res.writeHead(out.status, { 'Content-Type': out.headers.get('content-type') || 'application/json' })
      res.end(Buffer.from(await out.arrayBuffer()))
      return
    }

    // docs site — served at the same /site/ path used in production
    if (url.pathname === '/site') {
      res.writeHead(302, { Location: '/site/' })
      res.end()
      return
    }
    if (url.pathname.startsWith('/site/')) {
      const rel = decodeURIComponent(url.pathname.slice('/site/'.length))
      let sitePath = join(SITE_ROOT, normalize(rel).replace(/^([A-Za-z]:)?[\\/]/, ''))
      if (!sitePath.startsWith(SITE_ROOT)) { res.writeHead(403); res.end(); return }
      try {
        if ((await stat(sitePath)).isDirectory()) sitePath = join(sitePath, 'index.html')
        await serveFile(res, sitePath)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Site page not found')
      }
      return
    }

    // static files with SPA fallback
    let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^([A-Za-z]:)?/, ''))
    if (!path.startsWith(ROOT)) { res.writeHead(403); res.end(); return }
    try { if ((await stat(path)).isDirectory()) path = join(path, 'index.html') } catch { path = join(ROOT, 'index.html') }
    await serveFile(res, path)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' })
    await serveFile(res, join(ROOT, 'index.html')).catch(() => res.end('not found'))
  }
})

server.listen(PORT, () => console.log(`Quizard dev server → http://127.0.0.1:${PORT}  (AI proxied to the relay)`))
