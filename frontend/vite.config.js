import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/entries': 'http://localhost:8000',
      '/analytics': 'http://localhost:8000',
      '/tags': 'http://localhost:8000',
    },
  },
})
