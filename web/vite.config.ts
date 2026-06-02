import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '3434'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${BACKEND_PORT}`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts']
  }
})
