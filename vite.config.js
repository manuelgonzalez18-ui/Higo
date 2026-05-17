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
        // Entry (index.js) sin hash: el .htaccess sirve HTML con no-cache,
        // así el browser siempre lo refetchea y referencia los chunks
        // nuevos. El index.js sí se sobreescribe en cada deploy lftp.
        entryFileNames: 'assets/[name].js',
        // Chunks SÍ con hash: cada lazy chunk + manualChunk tiene un
        // nombre único por build. Esto resuelve el riesgo histórico de
        // exports desincronizados entre index.js nuevo y chunk viejo
        // (que era el motivo para mantener gemini en el main bundle).
        // Ahora podemos sacar Gemini afuera y hacer lazy de rutas sin
        // miedo a stale chunks: si el deploy lftp todavía no subió un
        // chunk, el index.js nuevo tira "Failed to load chunk" visible
        // (recuperable con reload) en vez de corrupción silenciosa.
        chunkFileNames: 'assets/[name]-[hash].js',
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
          // Gemini ya no entra en main: los dos consumers (LocationInput
          // y DriverDashboard) hacen `await import('./geminiService')`,
          // así que Vite arma un chunk lazy `geminiService-<hash>.js`
          // que incluye @google/genai SDK. Sin entry acá: deduplica
          // automáticamente entre los dos consumers.
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
