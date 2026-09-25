import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works from any host path (GitHub Pages, Firebase, a subfolder).
export default defineConfig({
  plugins: [react()],
  base: './',
})
