/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}
const buildTime = new Date().toISOString()

/**
 * Erzeugt `version.json` (Update-Prüfung der Tablets) und liefert `CHANGELOG.md` mit aus.
 * Beide Dateien werden bewusst NICHT vom Service Worker vorgehalten, damit die App
 * immer den Stand des Servers sieht.
 */
function versionFiles(): Plugin {
  const versionJson = () => JSON.stringify({ version: pkg.version, buildTime }, null, 2)
  const changelog = () => readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf-8')
  return {
    name: 'pf-version-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url === '/version.json' || url === '/CHANGELOG.md') {
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader(
            'Content-Type',
            url === '/version.json' ? 'application/json' : 'text/markdown; charset=utf-8',
          )
          res.end(url === '/version.json' ? versionJson() : changelog())
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: versionJson() })
      this.emitFile({ type: 'asset', fileName: 'CHANGELOG.md', source: changelog() })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    tailwindcss(),
    versionFiles(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Park & Fly Manager',
        short_name: 'Park & Fly',
        description: 'Interne Steuerung des Park & Fly Betriebs',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['version.json', 'CHANGELOG.md'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/version\.json$/, /^\/CHANGELOG\.md$/],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
