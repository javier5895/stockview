import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    proxy: {
      // Forward /api/* to the local FastAPI server during development
      '/api': 'http://localhost:8000',
    },
  },
})
