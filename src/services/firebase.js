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

// Helper para App ID seguro
export const getAppId = () => {
    const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'higo-v1';
    return rawAppId.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export default app;
