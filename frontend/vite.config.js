import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Backend target for the dev proxy. VITE_BACKEND_URL comes from the shell
  // or frontend/.env* (loadEnv merges both), so the proxy isn't pinned to :8000.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const backend = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
        },
        '/health': {
          target: backend,
          changeOrigin: true,
        },
      },
    },
  }
})
