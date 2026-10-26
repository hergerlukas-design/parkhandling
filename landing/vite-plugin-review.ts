// Vite-Plugin für das Markier-Werkzeug (nur Dev-Server, nie im Build):
//  * GET/PUT /__review/notes liest bzw. schreibt landing/review/notes.json
//  * schreibt daneben landing/review/NOTES.md (Aufbereitung für Claude Code)
//  * erzeugt im Hintergrund Screenshots offener Markierungen (review/screens/<nr>.png) mit Playwright.
//    Fehlt der Browser (npx playwright install chromium), wird ohne Screenshots weitergearbeitet.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { toMarkdown } from './src/review-tool/markdown.ts'
import { EMPTY_FILE, isReviewFile, type ReviewFile } from './src/review-tool/types.ts'

const MAX_BODY = 5 * 1024 * 1024

export function reviewNotes(appVersion: string): Plugin {
  let dir = ''
  let server: ViteDevServer
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let rerun = false
  let warned = false

  const jsonPath = () => join(dir, 'notes.json')
  const screensDir = () => join(dir, 'screens')
  const shotPath = (nr: number) => join(screensDir(), `${nr}.png`)

  function read(): ReviewFile {
    try {
      const data: unknown = JSON.parse(readFileSync(jsonPath(), 'utf-8'))
      return isReviewFile(data) ? data : EMPTY_FILE
    } catch {
      return EMPTY_FILE
    }
  }

  function writeMarkdown(file: ReviewFile) {
    const shots = new Set(
      file.marks.filter((m) => m.status === 'offen' && existsSync(shotPath(m.nr))).map((m) => m.id),
    )
    writeFileSync(join(dir, 'NOTES.md'), toMarkdown(file, appVersion, shots))
  }

  /** Screenshots löschen, zu denen es keine offene Markierung mehr gibt */
  function pruneScreens(file: ReviewFile) {
    if (!existsSync(screensDir())) return
    const keep = new Set(file.marks.filter((m) => m.status === 'offen').map((m) => `${m.nr}.png`))
    for (const name of readdirSync(screensDir())) if (name.endsWith('.png') && !keep.has(name)) unlinkSync(join(screensDir(), name))
  }

  async function runShots() {
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      const file = read()
      const base = server.resolvedUrls?.local[0]
      const todo = file.marks.filter(
        (m) => m.status === 'offen' && (!existsSync(shotPath(m.nr)) || statSync(shotPath(m.nr)).mtimeMs < Date.parse(m.updatedAt)),
      )
      if (!base || todo.length === 0) return
      let browser
      try {
        const { chromium } = await import('@playwright/test')
        browser = await chromium.launch()
      } catch (e) {
        if (!warned) {
          server.config.logger.warn(
            `[review] Screenshots übersprungen – Browser fehlt? Einmalig "npx playwright install chromium" ausführen. (${String(e).split('\n')[0]})`,
          )
          warned = true
        }
        return
      }
      mkdirSync(screensDir(), { recursive: true })
      try {
        for (const m of todo) {
          const page = await browser.newPage({ viewport: m.viewport, deviceScaleFactor: 1 })
          try {
            const url = new URL(m.page, base)
            url.searchParams.set('review-shot', m.id)
            await page.goto(url.href)
            await page.waitForFunction(() => document.documentElement.dataset.reviewShot === 'ready', null, { timeout: 15_000 })
            const size = await page.evaluate(() => ({
              w: document.documentElement.scrollWidth,
              h: document.documentElement.scrollHeight,
            }))
            const pad = 80
            const x = Math.max(0, Math.floor(m.box.x - pad))
            const y = Math.max(0, Math.floor(m.box.y - pad))
            await page.screenshot({
              path: shotPath(m.nr),
              fullPage: true,
              clip: {
                x,
                y,
                width: Math.max(1, Math.min(size.w - x, Math.ceil(m.box.w + 2 * pad))),
                height: Math.max(1, Math.min(size.h - y, Math.ceil(m.box.h + 2 * pad))),
              },
            })
          } catch (e) {
            server.config.logger.warn(`[review] Screenshot #${m.nr} fehlgeschlagen: ${String(e).split('\n')[0]}`)
          } finally {
            await page.close()
          }
        }
      } finally {
        await browser.close()
      }
      writeMarkdown(read())
      server.config.logger.info(`[review] ${todo.length} Screenshot(s) in review/screens/ aktualisiert`)
    } finally {
      running = false
      if (rerun) {
        rerun = false
        void runShots()
      }
    }
  }

  function scheduleShots() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void runShots(), 1500)
  }

  return {
    name: 'pf-review-notes',
    apply: 'serve',
    configureServer(s) {
      server = s
      // REVIEW_DIR nur für den automatischen Test, damit echte Notizen unberührt bleiben
      dir = process.env.REVIEW_DIR ?? join(s.config.root, 'review')
      s.middlewares.use('/__review/notes', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        if (req.method === 'GET') return send(200, read())
        if (req.method !== 'PUT') return send(405, { error: 'Methode nicht erlaubt' })
        let raw = ''
        req.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf-8')
          if (raw.length > MAX_BODY) req.destroy()
        })
        req.on('end', () => {
          let file: unknown
          try {
            file = JSON.parse(raw)
          } catch {
            return send(400, { error: 'Ungültiges JSON' })
          }
          if (!isReviewFile(file)) return send(400, { error: 'Unbekanntes Format' })
          mkdirSync(dir, { recursive: true })
          writeFileSync(jsonPath(), `${JSON.stringify(file, null, 2)}\n`)
          pruneScreens(file)
          writeMarkdown(file)
          scheduleShots()
          send(200, { ok: true, path: 'review/NOTES.md' })
        })
      })
    },
  }
}
