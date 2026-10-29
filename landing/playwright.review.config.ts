import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Test des Markier-Werkzeugs gegen den Dev-Server (das Werkzeug existiert nur dort).
// Notizen landen in einem temporären Ordner, nicht in landing/review/.
const reviewDir = process.env.REVIEW_DIR ?? mkdtempSync(join(tmpdir(), 'pf-review-'))
process.env.REVIEW_DIR = reviewDir

export default defineConfig({
  testDir: './e2e-review',
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5179', locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: false,
    env: { REVIEW_DIR: reviewDir },
    timeout: 60_000,
  },
})
