import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const booleanFlag = (value, fallback = 'false') => {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase()
}

// Hotfix acotado: RideStatusPage todavía contiene el copy histórico de
// "llegada" dentro de la transición `in_progress`. La llegada real ahora se
// persiste y anuncia mediante `arrived_at_pickup_at`, por lo que al comenzar el
// viaje el mensaje correcto es "¡Tu viaje ha comenzado!". Transformamos las
// dos cadenas exactas durante el build web/Android y fallamos si el archivo
// cambia, evitando un reemplazo silencioso o accidental.
const passengerTripStartedCopyHotfix = {
  name: 'higo-passenger-trip-started-copy-hotfix',
  enforce: 'pre',
  transform(code, id) {
    const normalizedId = id.replaceAll('\\', '/')
    if (!normalizedId.endsWith('/src/pages/RideStatusPage.jsx')) return null

    const replacements = [
      [
        'body: "🚗 ¡Tu Higo Driver ha llegado!",',
        'body: "🚗 ¡Tu viaje ha comenzado!",',
      ],
      [
        'toast.success("🔔 ¡Tu Higo Driver ha llegado!");',
        'toast.success("🚗 ¡Tu viaje ha comenzado!");',
      ],
    ]

    let transformed = code
    for (const [legacyText, currentText] of replacements) {
      const matches = transformed.split(legacyText).length - 1
      if (matches !== 1) {
        throw new Error(`[passenger-trip-started-copy-hotfix] Se esperaba 1 coincidencia de: ${legacyText}; encontradas: ${matches}`)
      }
      transformed = transformed.replace(legacyText, currentText)
    }

    return { code: transformed, map: null }
  },
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [passengerTripStartedCopyHotfix, react(), tailwindcss()],
    base: './',
    define: {
      'import.meta.env.VITE_SHOP_ENABLED': JSON.stringify(booleanFlag(env.VITE_SHOP_ENABLED)),
      'import.meta.env.VITE_SERVER_SIDE_RIDE_PRICING': JSON.stringify(booleanFlag(env.VITE_SERVER_SIDE_RIDE_PRICING)),
      'import.meta.env.VITE_SERVER_SIDE_RIDE_STATE': JSON.stringify(booleanFlag(env.VITE_SERVER_SIDE_RIDE_STATE)),
      'import.meta.env.VITE_UNIFIED_MEMBERSHIP_CHECKOUT': JSON.stringify(booleanFlag(env.VITE_UNIFIED_MEMBERSHIP_CHECKOUT)),
      'import.meta.env.VITE_DIRECTED_RIDE_OFFERS': JSON.stringify(booleanFlag(env.VITE_DIRECTED_RIDE_OFFERS)),
      'import.meta.env.VITE_ADMIN_MFA_UI': JSON.stringify(booleanFlag(env.VITE_ADMIN_MFA_UI, 'true')),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
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
