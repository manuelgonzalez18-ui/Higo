import { supabase } from '../services/supabase';

// Dispara una alerta SOS al backend send-emergency.php.
//
// CRÍTICO: el caller invoca tel:911 sincrónicamente DESPUÉS de esta
// función. En la mayoría de browsers el cambio de window.location
// cancela los fetch in-flight ANTES de que salgan al wire. Esto causaba
// que el SOS se "perdiera" silenciosamente. Dos defensas:
//
//   1. Geo timeout cortísimo (700ms). Mejor mandar lat/lng=null que
//      perder la alerta entera porque el navegador tardó 2.5s en
//      preguntarnos los permisos.
//   2. fetch con `keepalive: true` — el browser garantiza que la
//      request termina aunque la página se descargue (límite 64KB,
//      el body son ~150B). Compatible con Chrome, Edge, Safari, FF
//      y WebView de Capacitor (Android 87+ / iOS 13.4+).
//
// API: triggerEmergencyAlert({ rideId, triggeredBy }) → Promise
//   triggeredBy: 'passenger' | 'driver'
//   Resuelve con { ok, sos_id, ... } del endpoint, o rechaza con Error.

const GEO_TIMEOUT_MS = 700;

const getLocation = () => new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve({ lat: null, lng: null });
        return;
    }
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    const timer = setTimeout(() => done({ lat: null, lng: null }), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            clearTimeout(timer);
            done({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
            clearTimeout(timer);
            done({ lat: null, lng: null });
        },
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 }
    );
});

export const triggerEmergencyAlert = async ({ rideId, triggeredBy }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No session token for emergency alert');

    const { lat, lng } = await getLocation();

    const res = await fetch('/api/send-emergency.php', {
        method: 'POST',
        // keepalive: la request sigue viva aunque navegue a tel:911
        keepalive: true,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
            ride_id: rideId || null,
            lat,
            lng,
            triggered_by: triggeredBy || 'passenger',
        }),
    });

    // Log explícito del resultado para diagnosticar fallos silenciosos
    // en producción. El SOS es crítico — necesitamos que cualquier
    // problema sea visible inmediatamente en DevTools.
    const text = await res.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (_) { /* respuesta no-JSON */ }

    if (!res.ok) {
        console.error('[SOS] endpoint failed', res.status, payload || text);
        throw new Error(`Emergency endpoint returned ${res.status}: ${text.slice(0, 200)}`);
    }

    if (payload?.support_error) {
        // El email + sos_event funcionaron pero el chat de soporte falló.
        // El admin NO va a recibir la alerta visual en /admin/support.
        console.warn('[SOS] support chat integration failed:', payload.support_error);
    } else if (payload?.support_thread_id) {
        console.log('[SOS] OK · thread #' + payload.support_thread_id);
    } else {
        console.log('[SOS] OK · response:', payload);
    }

    return payload || {};
};
