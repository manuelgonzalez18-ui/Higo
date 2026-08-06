import { supabase } from '../services/supabase';
import { logger } from './logger';
import { apiUrl } from './apiUrl';

const GEO_SOFT_TIMEOUT_MS = 700;
const GEO_FOLLOW_UP_TIMEOUT_MS = 12000;
const LOCATION_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const LOCATION_CACHE_KEY = 'higo:last-known-location';

const validCoordinate = (value, min, max) => (
    Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max
);

const normalizeLocation = (value) => {
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) return null;
    return { lat, lng };
};

const readCachedLocation = () => {
    if (typeof window === 'undefined') return null;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(LOCATION_CACHE_KEY) || 'null');
        if (!parsed || Date.now() - Number(parsed.savedAt || 0) > LOCATION_CACHE_MAX_AGE_MS) return null;
        return normalizeLocation(parsed);
    } catch {
        return null;
    }
};

const cacheLocation = (location) => {
    if (typeof window === 'undefined' || !location) return;
    try {
        window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({
            ...location,
            savedAt: Date.now(),
        }));
    } catch {
        // Storage is best-effort; the emergency request must never depend on it.
    }
};

const requestLocation = (timeoutMs) => new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
    }

    let settled = false;
    const finish = (value) => {
        if (settled) return;
        settled = true;
        const normalized = normalizeLocation(value);
        if (normalized) cacheLocation(normalized);
        resolve(normalized);
    };

    const timer = setTimeout(() => finish(null), timeoutMs + 250);
    navigator.geolocation.getCurrentPosition(
        (position) => {
            clearTimeout(timer);
            finish({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            });
        },
        () => {
            clearTimeout(timer);
            finish(null);
        },
        {
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 60000,
        },
    );
});

const wait = (ms, value = null) => new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
});

const locationsMatch = (left, right) => (
    left && right
    && Math.abs(left.lat - right.lat) < 0.00001
    && Math.abs(left.lng - right.lng) < 0.00001
);

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

export const triggerEmergencyAlert = async ({ rideId, triggeredBy }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No session token for emergency alert');

    // Start a longer high-accuracy lookup immediately, but never delay the
    // initial SOS by more than 700 ms. A fresh cached point is preferable to
    // sending null while the GPS warms up.
    const locationPromise = requestLocation(GEO_FOLLOW_UP_TIMEOUT_MS);
    const fastLocation = await Promise.race([
        locationPromise,
        wait(GEO_SOFT_TIMEOUT_MS),
    ]);
    const initialLocation = fastLocation || readCachedLocation();

    const payload = await postJson('/api/send-emergency.php', token, {
        ride_id: rideId || null,
        lat: initialLocation?.lat ?? null,
        lng: initialLocation?.lng ?? null,
        triggered_by: triggeredBy || 'passenger',
    });

    // The emergency is already persisted. Continue resolving GPS in the
    // background and append the precise coordinates to the SOS/admin thread.
    void locationPromise.then(async (preciseLocation) => {
        if (!preciseLocation || !payload?.sos_id || locationsMatch(initialLocation, preciseLocation)) return;
        try {
            await postJson('/api/update-emergency-location.php', token, {
                sos_id: payload.sos_id,
                support_thread_id: payload.support_thread_id || null,
                lat: preciseLocation.lat,
                lng: preciseLocation.lng,
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
