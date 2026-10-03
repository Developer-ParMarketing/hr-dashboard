import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Keep in sync with backend ATTENDANCE_API_PORT (default 8787). */
const apiTarget =
  process.env.VITE_API_PROXY_TARGET ??
  `http://localhost:${process.env.ATTENDANCE_API_PORT ?? '8787'}`

const apiProxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
  '/health': {
    target: apiTarget,
    changeOrigin: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
})
