import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'

// Minimal test config: the shared alias the renderer uses, and JSX support so
// components can be rendered to static markup without a browser.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./desktop-shared', import.meta.url))
    }
  },
  plugins: [react()]
})
