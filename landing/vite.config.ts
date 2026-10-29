/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { reviewNotes } from './vite-plugin-review.ts'

// Einzige Quelle der Version ist landing/package.json (unabhängig von der internen App)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // reviewNotes: Markier-Werkzeug, nur im Dev-Server (apply: 'serve')
  plugins: [react(), tailwindcss(), reviewNotes(pkg.version)],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
