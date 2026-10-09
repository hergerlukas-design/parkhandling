/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Einzige Quelle der Version ist landing/package.json (unabhängig von der internen App)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
