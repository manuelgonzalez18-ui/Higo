import { supabase } from '../services/supabase';
import { apiUrl } from './apiUrl';

// Dispara un push al remitente cuando el chofer cambia el status de un envío.
// Fire-and-forget desde DriverDashboard: el chofer ya hizo el UPDATE en
// rides, esto solo notifica al remitente que su paquete se movió.
//
// No bloquea el flow del chofer ni propaga errores — si el push falla
// (red, FCM token muerto, etc.) lo loggeamos en consola y el chofer
// sigue operando. El remitente igualmente verá el cambio en realtime
// cuando abra RideStatusPage.
//
// API: sendDeliveryMilestone({ rideId, status }) → void

export const sendDeliveryMilestone = async ({ rideId, status }) => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || !rideId || !status) return;

        // No bloquear el UI — fire-and-forget. Timeout de 5s para no
        // colgar el ride si Hostinger está lento.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);

        const res = await fetch(apiUrl('/api/send-delivery-milestone.php'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
            },
            body: JSON.stringify({ ride_id: rideId, status }),
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            console.warn('[delivery-milestone] HTTP ' + res.status);
        }
    } catch (err) {
        // No interrumpir el flow del chofer. El status ya está en DB.
        console.warn('[delivery-milestone] failed:', err?.message || err);
    }
};
