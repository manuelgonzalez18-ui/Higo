import { getToken, onMessage } from 'firebase/messaging';
import { messaging } from './firebase';
import { supabase } from './supabase';

// VAPID key del proyecto Firebase. Se saca de
// Firebase Console → Project settings → Cloud Messaging → Web Push certificates.
// Sin esto getToken() falla en web (no afecta a Android nativo).
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY || '';

let lastSyncedToken = null;

// Pide permiso (si no está decidido), saca el token FCM y lo persiste en
// profiles.fcm_token. Idempotente: si el token no cambió desde la última
// llamada, no hace UPDATE. Devuelve el token o null si no se pudo registrar.
export async function ensureFcmRegistration() {
    if (!messaging) return null;
    if (typeof Notification === 'undefined') return null;
    if (!VAPID_KEY) {
        console.warn('[push] VITE_FCM_VAPID_KEY no configurado; no se registra token');
        return null;
    }

    try {
        let permission = Notification.permission;
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }
        if (permission !== 'granted') return null;

        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (!token) return null;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return token;

        if (lastSyncedToken === token) return token;

        const { data: profile } = await supabase
            .from('profiles')
            .select('fcm_token')
            .eq('id', user.id)
            .maybeSingle();

        if (profile?.fcm_token !== token) {
            const { error } = await supabase
                .from('profiles')
                .update({ fcm_token: token, fcm_updated_at: new Date().toISOString() })
                .eq('id', user.id);
            if (error) {
                console.warn('[push] no se pudo persistir el token FCM:', error.message);
                return null;
            }
        }
        lastSyncedToken = token;
        return token;
    } catch (err) {
        console.warn('[push] registro FCM falló:', err?.message || err);
        return null;
    }
}

export function subscribeForegroundMessages(handler) {
    if (!messaging) return () => {};
    return onMessage(messaging, handler);
}
