import { supabase } from '../services/supabase';
import { apiUrl } from './apiUrl';

const RETRY_DELAYS_MS = [0, 800, 2500];
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const sendRideStatusPush = async ({ rideId, milestone }) => {
    if (!rideId || !milestone) return { ok: false, skipped: true };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('ride status push: missing session');

    const response = await fetch(apiUrl('/api/send-ride-status-push.php'), {
        method: 'POST',
        keepalive: true,
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
    void (async () => {
        let lastError = null;
        for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
            const delay = RETRY_DELAYS_MS[index];
            if (delay > 0) await sleep(delay);
            try {
                const result = await sendRideStatusPush(args);
                if (result?.sent === 0) {
                    console.warn('[ride-status-push] accepted but not delivered:', result);
                }
                return result;
            } catch (error) {
                lastError = error;
                console.warn(`[ride-status-push] attempt ${index + 1} failed:`, error);
            }
        }
        console.error('[ride-status-push] delivery exhausted retries:', args, lastError);
        return null;
    })();
};
