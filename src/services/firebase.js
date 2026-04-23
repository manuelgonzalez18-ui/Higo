import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Web SDK config. Estos valores no son secretos: Firebase los expone
// deliberadamente y la seguridad real vive en Security Rules. Si .env está,
// prevalece; si no, usamos los valores hardcoded.
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAcoBzdfPRJ76luR-bTjW4Kxen3dWZ0Xn4',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'higo-app-26a19.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'higo-app-26a19',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'higo-app-26a19.firebasestorage.app',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '402695441944',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:402695441944:web:104db3fe36029e2c36bd6d',
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-0N2ZDGDGNT'
};

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
