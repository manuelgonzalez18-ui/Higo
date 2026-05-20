import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';
import { logger } from '../utils/logger';

// Firebase Web SDK config. Los valores NO son secretos en el sentido
// criptográfico (Firebase los expone deliberadamente al cliente y la
// seguridad real vive en Security Rules), pero los pusheamos a .env
// para tener UNA fuente de verdad y poder rotar el proyecto sin
// recompilar. En dev, si falta el .env tiramos warning para que se
// detecte temprano; en prod, si falta no tiramos error fatal, simplemente
// desactivamos las notificaciones de manera defensiva.
const env = import.meta.env;
const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const missing = required.filter(k => !env[k]);

let app = null;
let auth = null;
let db = null;
let messaging = null;

if (missing.length === 0) {
    const firebaseConfig = {
        apiKey:            env.VITE_FIREBASE_API_KEY,
        authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId:         env.VITE_FIREBASE_PROJECT_ID,
        storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId:             env.VITE_FIREBASE_APP_ID,
        measurementId:     env.VITE_FIREBASE_MEASUREMENT_ID,
    };

    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            messaging = getMessaging(app);
        }
    } catch (error) {
        logger.debug("Firebase Messaging not supported in this environment", error);
    }
} else {
    const msg = `Firebase config faltante: ${missing.join(', ')}. Notificaciones push desactivadas de forma defensiva.`;
    console.warn('[firebase]', msg);
}

export { app, auth, db, messaging };

export const getAppId = () => {
    const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'higo-v1';
    return rawAppId.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export default app;

