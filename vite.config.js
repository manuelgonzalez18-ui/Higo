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
        // Nombres estables (sin hash) para que lftp siempre haga overwrite
        // en vez de crear archivos nuevos (Hostinger FTP falla con archivos
        // nuevos grandes). El cache-busting lo hace el .htaccess con
        // Cache-Control: no-cache para HTML.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (info) => {
          // Fuentes y binarios con [hash] para mejor caching (rara vez cambian)
          if (/\.(woff2?|ttf|eot|png|jpe?g|gif|svg)$/.test(info.name || '')) {
            return 'assets/[name]-[hash][extname]';
          }
          return 'assets/[name][extname]';
        },
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
