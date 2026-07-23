import { supabase } from './supabase';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'web';

const getSessionId = () => {
    try {
        let value = sessionStorage.getItem('higo_analytics_session');
        if (!value) {
            value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            sessionStorage.setItem('higo_analytics_session', value);
        }
        return value;
    } catch {
        return null;
    }
};

const getPlatform = () => {
    try {
        if (window.Capacitor?.isNativePlatform?.()) return 'capacitor';
        return navigator.userAgentData?.mobile ? 'mobile-web' : 'web';
    } catch {
        return 'unknown';
    }
};

const sanitizeProperties = (properties = {}) => {
    const blocked = new Set([
        'password', 'token', 'access_token', 'refresh_token', 'raw_response',
        'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'phone', 'email',
    ]);
    return Object.fromEntries(
        Object.entries(properties || {})
            .filter(([key, value]) => !blocked.has(key) && value !== undefined)
            .slice(0, 50),
    );
};

export const trackEvent = async (eventName, {
    entityType = null,
    entityId = null,
    properties = {},
    route = typeof window !== 'undefined' ? window.location.hash || window.location.pathname : null,
} = {}) => {
    try {
        const { error } = await supabase.rpc('track_platform_event', {
            p_event_name: eventName,
            p_route: route,
            p_entity_type: entityType,
            p_entity_id: entityId == null ? null : String(entityId),
            p_properties: sanitizeProperties(properties),
            p_session_id: getSessionId(),
            p_app_version: APP_VERSION,
            p_platform: getPlatform(),
        });
        return !error;
    } catch {
        // Analytics is fire-and-forget and must never block a user flow.
        return false;
    }
};

export const trackEventLater = (eventName, options) => {
    queueMicrotask(() => { trackEvent(eventName, options); });
};
