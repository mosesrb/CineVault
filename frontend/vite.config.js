import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: true,
    allowedHosts: 'all', // Support dynamic cloudflare tunnel URLs
    proxy: {
      '/api/v1/auth/exchange': {
        target: 'http://127.0.0.1:3000',
        xfwd: true
      },
      // Cloud administration binds CSRF to the PC browser's exact Host/Origin.
      '/api/v1/admin/control-plane': {
        target: 'http://localhost:3000',
        changeOrigin: false
      },
      // Proxy all /api and /stream calls to the Express backend
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
})
