import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Web SDK config. Los valores NO son secretos en el sentido
// criptográfico (Firebase los expone deliberadamente al cliente y la
// seguridad real vive en Security Rules), pero los pusheamos a .env
// para tener UNA fuente de verdad y poder rotar el proyecto sin
// recompilar. En dev, si falta el .env tiramos warning para que se
// detecte temprano; en prod, throw — preferimos build roto a deploy
// con config inconsistente.
const env = import.meta.env;
const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const missing = required.filter(k => !env[k]);
if (missing.length) {
    const msg = `Firebase config faltante: ${missing.join(', ')}. Revisá .env / GitHub Actions secrets.`;
    if (env.PROD) throw new Error(msg);
    console.warn('[firebase]', msg);
}

const firebaseConfig = {
    apiKey:            env.VITE_FIREBASE_API_KEY,
    authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             env.VITE_FIREBASE_APP_ID,
    measurementId:     env.VITE_FIREBASE_MEASUREMENT_ID,
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
