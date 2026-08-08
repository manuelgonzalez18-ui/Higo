import { supabase } from '../services/supabase';
import { logger } from './logger';
import { apiUrl } from './apiUrl';
import {
    prewarmEmergencyLocation,
    readEmergencyLocation,
    requestEmergencyLocation,
} from './emergencyLocation';

const GEO_FOLLOW_UP_TIMEOUT_MS = 15000;

const locationsMatch = (left, right) => (
    left && right
    && Math.abs(left.lat - right.lat) < 0.00001
    && Math.abs(left.lng - right.lng) < 0.00001
);

const locationPayload = (location) => ({
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    location_accuracy: location?.accuracy ?? null,
    location_captured_at: location?.capturedAt ?? null,
    location_source: location?.source ?? null,
});

const postJson = async (path, token, body, keepalive = true) => {
    const response = await fetch(apiUrl(path), {
        method: 'POST',
        keepalive,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* non-JSON response */ }

    if (!response.ok) {
        throw new Error(`${path} returned ${response.status}: ${text.slice(0, 200)}`);
    }
    return payload || {};
};

// Warm the last-known position as soon as a ride screen imports this module.
// It never opens a permission prompt; it only refreshes when permission was
// already granted. The SOS button can then send coordinates immediately.
if (typeof window !== 'undefined') {
    window.setTimeout(() => {
        void prewarmEmergencyLocation();
    }, 0);
}

export const triggerEmergencyAlert = async ({ rideId, triggeredBy }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No session token for emergency alert');

    // Persist the SOS immediately with the fresh app cache (when available).
    // Do not wait for a cold GPS fix before the phone dialer opens.
    const initialLocation = readEmergencyLocation();
    const locationPromise = requestEmergencyLocation({
        timeoutMs: GEO_FOLLOW_UP_TIMEOUT_MS,
        requestPermission: true,
    });

    const payload = await postJson('/api/send-emergency.php', token, {
        ride_id: rideId || null,
        triggered_by: triggeredBy || 'passenger',
        ...locationPayload(initialLocation),
    });

    // The SOS already exists. Attach a fresh native GPS point when it arrives.
    void locationPromise.then(async (preciseLocation) => {
        if (!preciseLocation || !payload?.sos_id || locationsMatch(initialLocation, preciseLocation)) return;
        try {
            await postJson('/api/update-emergency-location.php', token, {
                sos_id: payload.sos_id,
                support_thread_id: payload.support_thread_id || null,
                ...locationPayload(preciseLocation),
            });
            logger.debug('[SOS] precise location attached to event #' + payload.sos_id);
        } catch (error) {
            console.warn('[SOS] precise location follow-up failed:', error);
        }
    });

    if (payload?.support_ok === false) {
        console.warn('[SOS] support chat integration failed. Request ID: ' + (payload.request_id || '?'));
    } else if (payload?.support_thread_id) {
        logger.debug('[SOS] OK · thread #' + payload.support_thread_id + ' · req=' + (payload.request_id || '?'));
    } else {
        logger.debug('[SOS] OK · response:', payload);
    }

    return payload;
};
