import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }
import thirdPartyLicenses from './scripts/third-party-licenses.mjs'

export default defineConfig({
  main: {
    build: { rollupOptions: { external: ['node:sqlite'] } },
    plugins: [thirdPartyLicenses({ includeProduction: true })]
  },
  preload: {
    plugins: [thirdPartyLicenses()]
  },
  renderer: {
    // single source of truth for the version: package.json
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), thirdPartyLicenses()]
  }
})
