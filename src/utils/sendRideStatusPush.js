import { supabase } from '../services/supabase';
import { apiUrl } from './apiUrl';

export const sendRideStatusPush = async ({ rideId, milestone }) => {
    if (!rideId || !milestone) return { ok: false, skipped: true };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, skipped: true };

    const response = await fetch(apiUrl('/api/send-ride-status-push.php'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            ride_id: rideId,
            milestone,
        }),
    });

    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* non-JSON response */ }

    if (!response.ok) {
        throw new Error(`ride status push ${response.status}: ${text.slice(0, 240)}`);
    }
    return payload || { ok: true };
};

export const queueRideStatusPush = (args) => {
    void sendRideStatusPush(args).catch((error) => {
        console.warn('[ride-status-push] delivery failed:', error);
    });
};
