import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Vite + React 19 + Tailwind v4. The contract package is consumed via Bundler
// resolution straight from its `./src` (workspace:*) — no `tsc -b`, no composite
// (the whole repo is noEmit:true; see M2 plan P0 sub-decision #1).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev proxy → local engine-api (PORT defaults to 8787, see engine-api/src/index.ts).
      '/v1': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
