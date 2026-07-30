import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
      '/health': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    emptyOutDir: false,
    minify: true,
    cssCodeSplit: false, // Ensure CSS is inlined
    assetsInlineLimit: 100000000, // Large limit to ensure assets are inlined
  }
})
