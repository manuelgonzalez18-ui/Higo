// Shared by Node build tooling and Vitest. Never inherit live service settings.
export const TEST_ENVIRONMENT = Object.freeze({
    ...Object.fromEntries([
        'GOOGLE_MAPS_API_KEY', 'MAPBOX_TOKEN', 'GEMINI_API_KEY', 'FIREBASE_API_KEY',
        'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET',
        'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID', 'FIREBASE_MEASUREMENT_ID', 'FCM_VAPID_KEY',
    ].map(key => [`VITE_${key}`, ''])),
    VITE_APP_ENV: 'test', VITE_API_BASE_URL: 'http://127.0.0.1:8080',
    VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
    VITE_SUPABASE_ANON_KEY: 'test-publishable-placeholder', VITE_DIRECTED_RIDE_OFFERS: 'true',
});
