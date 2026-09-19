import process from 'node:process'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { RELEASE_FLAGS, validateEnvironment } from './src/config/releaseProfile.js'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const booleanFlag = (value, fallback = 'false') => {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase()
}

// Nota: antes había acá un hotfix de build que reemplazaba el copy histórico
// de "llegada" en la transición `in_progress` de RideStatusPage por "¡Tu viaje
// ha comenzado!". Ese arreglo ya está aplicado directamente en la fuente
// (RideStatusPage.jsx), y además la llegada real al origen se detecta y anuncia
// vía `arrived_at_pickup_at`, así que el hotfix se eliminó por redundante.

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const gitSha = env.VITE_GIT_SHA || execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  env.VITE_GIT_SHA = gitSha
  validateEnvironment(env, { release: command === 'build' })
  const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version
  const workerConfig = env.VITE_FIREBASE_PROJECT_ID ? {
    apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
  } : null
  const workerConfigSource = `self.HIGO_FIREBASE_CONFIG = ${JSON.stringify(workerConfig)};\n`

  return {
    plugins: [react(), tailwindcss(), {
      name: 'higo-firebase-worker-config',
      configureServer(server) {
        server.middlewares.use('/firebase-config.js', (_request, response) => {
          response.setHeader('Content-Type', 'application/javascript')
          response.setHeader('Cache-Control', 'no-store')
          response.end(workerConfigSource)
        })
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'firebase-config.js', source: workerConfigSource })
      },
    }],
    base: './',
    define: {
      ...Object.fromEntries(Object.entries(RELEASE_FLAGS).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(String(value))])),
      'import.meta.env.VITE_DIRECTED_RIDE_OFFERS': JSON.stringify(booleanFlag(env.VITE_DIRECTED_RIDE_OFFERS)),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
      'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
      'import.meta.env.VITE_MAP_ENGINE': JSON.stringify('google'),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (info) => {
            if (/\.(woff2?|ttf|eot|png|jpe?g|gif|svg)$/.test(info.name || '')) {
              return 'assets/[name]-[hash][extname]'
            }
            return 'assets/[name][extname]'
          },
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            maps: ['@vis.gl/react-google-maps'],
            capacitor: [
              '@capacitor/core',
              '@capacitor/app',
              '@capacitor/geolocation',
              '@capacitor/local-notifications',
              '@capacitor-community/text-to-speech',
            ],
          },
        },
      },
    },
  }
})
