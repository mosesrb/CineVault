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
  }
})
