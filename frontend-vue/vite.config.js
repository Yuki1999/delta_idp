import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev proxies /api to the single-port backend. In production the SPA is served
// same-origin by that backend, so this only affects `vite` dev. Point at a live
// backend via DEV_API_TARGET and inject Basic auth via DEV_API_AUTH.
const API_TARGET = process.env.DEV_API_TARGET || 'http://localhost:16005'
const DEV_AUTH = process.env.DEV_API_AUTH || ''
const authHeader = DEV_AUTH ? 'Basic ' + Buffer.from(DEV_AUTH).toString('base64') : ''

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 2500,
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    },
  },
})
