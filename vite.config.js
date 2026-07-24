import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const booleanFlag = (value, fallback = 'false') => {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase()
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
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
