import { defineConfig, devices } from '@playwright/test'
import { localSupabase } from './e2e/supabase'

/**
 * End-to-End-Tests gegen einen lokalen Supabase-Stack (npx supabase start) – keine echten Daten.
 * Die App wird gebaut und mit denselben Sicherheits-Headern wie in Produktion ausgeliefert (e2e/serve.mjs).
 */
const supabase = localSupabase()
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Kamera für QR-Scanner und Fotos: künstliches Bild statt echter Kamera
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: [
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'smartphone', use: { ...devices['Pixel 7'] }, grep: /@mobil/ },
  ],
  webServer: {
    command: 'npm run build && node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/version.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      VITE_SUPABASE_URL: supabase.url,
      VITE_SUPABASE_ANON_KEY: supabase.publishableKey,
    },
  },
})
