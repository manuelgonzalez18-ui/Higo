import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// --- CONFIGURACIÓN GOOGLE MAPS ---
export const GOOGLE_MAPS_API_KEY = "AIzaSyA4XDsb86YpzroZgdr9Bz5vAcesSDLJtX4";

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyAcoBzdfPRJ76luR-bTjW4Kxen3dWZ0Xn4",
    authDomain: "higo-app-26a19.firebaseapp.com",
    projectId: "higo-app-26a19",
    storageBucket: "higo-app-26a19.firebasestorage.app",
    messagingSenderId: "402695441944",
    appId: "1:402695441944:web:104db3fe36029e2c36bd6d",
    measurementId: "G-0N2ZDGDGNT"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Inicializar Messaging (Solo si el navegador lo soporta)
let messaging;
try {
    // Verificamos si window está definido (entorno del navegador) y si 'serviceWorker' está en navigator
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        const { getMessaging } = require("firebase/messaging"); // Dynamic import to avoid SSR/build issues if any
        messaging = getMessaging(app);
    }
} catch (error) {
    console.log("Firebase Messaging not supported/enabled in this environment", error);
}

export { messaging };

// Helper para App ID seguro
export const getAppId = () => {
    const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'higo-v1';
    return rawAppId.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export default app;
