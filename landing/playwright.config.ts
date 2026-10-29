import { defineConfig, devices } from '@playwright/test'

// E2E auf Smartphone-Breite (Hochformat). Die Edge Function wird im Test abgefangen,
// es werden keine echten Daten an Supabase gesendet.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'smartphone',
      use: {
        ...devices['Pixel 7'],
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
