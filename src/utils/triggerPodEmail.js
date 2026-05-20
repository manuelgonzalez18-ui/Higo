import { supabase } from '../services/supabase';

/**
 * Dispara el envío de correo de notificación al cliente cuando el chofer
 * sube una foto de recogida (pickup) o entrega (delivery).
 * Ejecución asíncrona "fire-and-forget" con timeout de 5 segundos
 * para no colgar ni interferir con la navegación o flujo del conductor.
 * 
 * @param {Object} params
 * @param {string} params.rideId - ID del viaje
 * @param {string} params.kind - Tipo de foto ('pickup' o 'delivery')
 * @param {string} params.podPath - Ruta de la imagen en Supabase Storage (ej: 'id-del-viaje/pickup.jpg')
 */
export const triggerPodEmail = async ({ rideId, kind, podPath }) => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || !rideId || !kind || !podPath) return;

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);

        const res = await fetch('/api/send-delivery-pod-email.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
            },
            body: JSON.stringify({
                ride_id: rideId,
                kind,
                pod_path: podPath
            }),
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            console.warn('[trigger-pod-email] HTTP ' + res.status);
        }
    } catch (err) {
        console.warn('[trigger-pod-email] failed:', err?.message || err);
    }
};
