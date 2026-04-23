import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Web SDK config — los valores se inyectan en build vía Vite/.env.
// Aunque el config de Firebase web no es realmente "secreto" (Firebase lo
// expone deliberadamente y depende de Security Rules), lo mantenemos en .env
// para no commitearlo y poder rotarlo si fuera necesario.
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

if (!firebaseConfig.apiKey) {
    console.warn("Missing VITE_FIREBASE_* en .env. Firebase no se inicializará.");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

let messaging;
try {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        const { getMessaging } = require("firebase/messaging");
        messaging = getMessaging(app);
    }
} catch (error) {
    console.log("Firebase Messaging not supported in this environment", error);
}

export { messaging };

export const getAppId = () => {
    const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'higo-v1';
    return rawAppId.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export default app;
