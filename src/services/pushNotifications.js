// pushNotifications.js — registro FCM platform-aware.
//
// Web (navegador):
//   Usa Firebase Web SDK + service worker (public/firebase-messaging-sw.js)
//   para registrar el token y recibir mensajes foreground.
//
// Native (Android/iOS via Capacitor):
//   Usa @capacitor/push-notifications con FCM nativo. Soporta
//   notificaciones en background (la app esta cerrada o minimizada);
//   Android las muestra automaticamente en la tray del sistema.
//   Requiere android/app/google-services.json con la config de Firebase.
//
// Contrato (identico al original, App.jsx no necesita cambiar):
//   ensureFcmRegistration() → registra el token en profiles.fcm_token.
//   subscribeForegroundMessages(handler) → handler(payload) cuando llega
//                                          un push estando la app abierta.

import { Capacitor } from '@capacitor/core';
import { getToken, onMessage } from 'firebase/messaging';
import { messaging } from './firebase';
import { supabase } from './supabase';

// VAPID key de Firebase Console (Project settings → Cloud Messaging →
// Web Push certificates). Solo se usa en web.
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY || '';

let lastSyncedToken = null;
let nativeInitialized = false;
const nativeHandlers = new Set();

const isNative = () => {
    try { return Capacitor.isNativePlatform(); }
    catch { return false; }
};

// Persiste el token en profiles.fcm_token. Idempotente:
// si el token ya esta sincronizado, no hace UPDATE.
async function persistToken(token) {
    if (!token) return null;
    try {
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
        console.warn('[push] persistToken error:', err?.message || err);
        return null;
    }
}

// ─── PATH NATIVO ──────────────────────────────────────────────────────
// El plugin lo importamos dinamicamente para que no entre al bundle web.
async function ensureFcmRegistrationNative() {
    try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // 1. Permiso del usuario.
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
            perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') {
            console.warn('[push native] permiso denegado');
            return null;
        }

        // 2. Listeners — solo una vez por sesion.
        if (!nativeInitialized) {
            // Token recibido tras register(). Llega async (no es retorno
            // directo de register()) — por eso persistTokenInProfile() esta
            // aca y no en el return de ensureFcmRegistrationNative().
            PushNotifications.addListener('registration', async (token) => {
                await persistToken(token.value);
            });

            // Error en registracion (FCM mal configurado, falta
            // google-services.json, SHA-1 incorrecto en Firebase Console, etc).
            PushNotifications.addListener('registrationError', (err) => {
                console.warn('[push native] registrationError:', err);
            });

            // Notificacion llegada con app en foreground. Reenviamos al mismo
            // handler que usa el path web — el caller no nota la diferencia.
            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                const payload = {
                    notification: { title: notification.title, body: notification.body },
                    data: notification.data || {},
                };
                nativeHandlers.forEach((h) => {
                    try { h(payload); } catch (e) { console.warn('[push native] handler error:', e); }
                });
            });

            // Usuario toco la notificacion (puede venir de background o killed).
            // Misma forma de payload — el handler ve el ride_request y dispara
            // el IncomingRequestCard.
            PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                const payload = {
                    notification: { title: action.notification.title, body: action.notification.body },
                    data: action.notification.data || {},
                };
                nativeHandlers.forEach((h) => {
                    try { h(payload); } catch (e) { console.warn('[push native] action error:', e); }
                });
            });

            nativeInitialized = true;
        }

        // 3. register() → dispara el evento 'registration' con el token FCM.
        await PushNotifications.register();
        return 'native-pending';
    } catch (err) {
        console.warn('[push native] ensureFcmRegistration falló:', err?.message || err);
        return null;
    }
}

// ─── PATH WEB ─────────────────────────────────────────────────────────
async function ensureFcmRegistrationWeb() {
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

        return await persistToken(token);
    } catch (err) {
        console.warn('[push] registro FCM falló:', err?.message || err);
        return null;
    }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────
export async function ensureFcmRegistration() {
    if (isNative()) return ensureFcmRegistrationNative();
    return ensureFcmRegistrationWeb();
}

export function subscribeForegroundMessages(handler) {
    if (isNative()) {
        nativeHandlers.add(handler);
        return () => nativeHandlers.delete(handler);
    }
    if (!messaging) return () => {};
    return onMessage(messaging, handler);
}
