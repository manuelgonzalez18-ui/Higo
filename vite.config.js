import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Separar dependencias pesadas en chunks propios para mejor caching
        // y first-paint más rápido (cada chunk se descarga/parsea en paralelo).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'maps': ['@vis.gl/react-google-maps'],
          'gemini': ['@google/genai'],
          'capacitor': [
            '@capacitor/core',
            '@capacitor/app',
            '@capacitor/geolocation',
            '@capacitor/local-notifications',
            '@capacitor-community/text-to-speech'
          ]
        }
      }
    }
  }
})
