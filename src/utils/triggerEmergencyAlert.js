import { supabase } from '../services/supabase';

// Dispara una alerta SOS al backend send-emergency.php. Encapsulado
// como util para reusar entre RideStatusPage (pasajero) y DriverDashboard
// (cuando agreguemos SOS chofer en Fase 10 D.C3).
//
// Hace una sola cosa: POST con ubicación actual + ride context.
// El usuario llamante (RideStatusPage / DriverDashboard) decide qué
// hacer DESPUÉS — típicamente continuar al tel:911 sin esperar la
// respuesta de la red. El alert no debe bloquear el path hacia el
// 911 en una emergencia real.
//
// API: triggerEmergencyAlert({ rideId, triggeredBy }) → Promise
//   triggeredBy: 'passenger' | 'driver'
//   Resuelve con { ok, sos_id, email_ok, contacts } del endpoint, o
//   rechaza con Error si la red falla.
//
// La ubicación se intenta del navegador (geolocation API) con timeout
// corto (2.5s). Si falla, se manda lat/lng null y el backend usa el
// resto del contexto (ride, contraparte, contactos) para igual
// alertar al admin con valor parcial.

const GEO_TIMEOUT_MS = 2500;

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
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 30000 }
    );
});

export const triggerEmergencyAlert = async ({ rideId, triggeredBy }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No session token for emergency alert');

    const { lat, lng } = await getLocation();

    const res = await fetch('/api/send-emergency.php', {
        method: 'POST',
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
    if (!res.ok) {
        throw new Error(`Emergency endpoint returned ${res.status}`);
    }
    return res.json();
};
