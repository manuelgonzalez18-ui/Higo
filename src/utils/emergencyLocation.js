import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const LOCATION_CACHE_KEY = 'higo:last-known-location';
const DEFAULT_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

const validCoordinate = (value, min, max) => (
    Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max
);

export const normalizeEmergencyLocation = (value, fallbackSource = 'unknown') => {
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) return null;

    const accuracyNumber = Number(value?.accuracy);
    return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracyNumber) && accuracyNumber >= 0 ? accuracyNumber : null,
        capturedAt: value?.capturedAt || value?.timestamp || new Date().toISOString(),
        source: value?.source || fallbackSource,
        savedAt: Number(value?.savedAt || Date.now()),
    };
};

export const rememberEmergencyLocation = (value, source = 'app_location') => {
    const normalized = normalizeEmergencyLocation(value, source);
    if (!normalized || typeof window === 'undefined') return normalized;

    try {
        window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({
            ...normalized,
            savedAt: Date.now(),
        }));
    } catch {
        // Emergency location caching is best-effort.
    }
    return normalized;
};

export const readEmergencyLocation = (maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS) => {
    if (typeof window === 'undefined') return null;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(LOCATION_CACHE_KEY) || 'null');
        const normalized = normalizeEmergencyLocation(parsed, 'cached_app_location');
        if (!normalized) return null;
        if (Date.now() - Number(parsed?.savedAt || 0) > maxAgeMs) return null;
        return { ...normalized, source: parsed?.source || 'cached_app_location' };
    } catch {
        return null;
    }
};

const fromPosition = (position, source) => rememberEmergencyLocation({
    lat: position?.coords?.latitude,
    lng: position?.coords?.longitude,
    accuracy: position?.coords?.accuracy,
    capturedAt: position?.timestamp
        ? new Date(position.timestamp).toISOString()
        : new Date().toISOString(),
    source,
}, source);

const requestWebLocation = (timeoutMs) => new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => resolve(fromPosition(position, 'web_gps')),
        () => resolve(null),
        {
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 30000,
        },
    );
});

export const requestEmergencyLocation = async ({
    timeoutMs = 12000,
    requestPermission = false,
} = {}) => {
    if (!Capacitor.isNativePlatform()) {
        return requestWebLocation(timeoutMs);
    }

    try {
        let permission = await Geolocation.checkPermissions();
        if (
            requestPermission
            && permission.location !== 'granted'
            && permission.coarseLocation !== 'granted'
        ) {
            permission = await Geolocation.requestPermissions();
        }

        if (
            permission.location !== 'granted'
            && permission.coarseLocation !== 'granted'
        ) {
            return null;
        }

        const position = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 30000,
        });
        return fromPosition(position, 'native_gps');
    } catch (error) {
        console.warn('[SOS] native geolocation unavailable:', error);
        return null;
    }
};

export const prewarmEmergencyLocation = async () => {
    const cached = readEmergencyLocation();
    if (cached) return cached;
    return requestEmergencyLocation({ timeoutMs: 12000, requestPermission: false });
};
