// Statischer Server für dist/ in den End-to-End-Tests. Liefert dieselben Sicherheits-Header wie nginx
// (deploy/security-headers.conf), damit die Tests auch Verstöße gegen die CSP finden. Abweichungen nur
// für den lokalen Supabase-Stack über http: dessen Adresse ist zusätzlich erlaubt, HSTS und
// upgrade-insecure-requests entfallen.
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.env.PORT ?? 4173)
const supabaseUrl = new URL(process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321')

const headers = {}
const conf = readFileSync(new URL('../deploy/security-headers.conf', import.meta.url), 'utf-8')
for (const m of conf.matchAll(/^add_header\s+(\S+)\s+(?:"([^"]*)"|(\S+))\s+always;/gm)) {
  headers[m[1]] = m[2] ?? m[3]
}
delete headers['Strict-Transport-Security']
headers['Content-Security-Policy'] = headers['Content-Security-Policy']
  .replace('; upgrade-insecure-requests', '')
  .replaceAll('https://*.supabase.co', `https://*.supabase.co ${supabaseUrl.origin}`)
  .replace('wss://*.supabase.co', `wss://*.supabase.co ws://${supabaseUrl.host}`)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, path)
  try {
    if (!statSync(file).isFile()) throw new Error()
  } catch {
    // SPA: unbekannte Pfade liefern index.html (wie try_files in nginx), Dateien unter /assets/ nicht
    if (path.startsWith('/assets/')) {
      res.writeHead(404, headers).end()
      return
    }
    file = join(root, 'index.html')
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`E2E-Server auf http://127.0.0.1:${port}`))
