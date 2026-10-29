import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  main: {
    build: { rollupOptions: { external: ['node:sqlite'] } }
  },
  preload: {},
  renderer: {
    // single source of truth for the version: package.json
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
