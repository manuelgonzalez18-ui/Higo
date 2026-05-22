// directionsService.js — Anexo C / M3.
//
// Wrapper sobre Mapbox Directions API (driving-traffic) con fallback
// Haversine si Mapbox falla (red, 429, 5xx, sin token). Cliente
// directo — el token pk.* es público por diseño Mapbox; la seguridad
// real está en URL/Bundle restriction del dashboard.
//
// CONTRATO: la respuesta respeta el shape Google para que
// RequestRidePage.jsx (cálculo de tarifa) NO se toque.
//   {
//     distance: { value: meters, text: "X km" },
//     duration: { value: seconds, text: "X min" },
//     polyline: [[lng,lat], ...]  // GeoJSON LineString coords
//     degraded?: true  // solo si cayó al fallback Haversine
//   }

import { getDistanceFromLatLonInKm } from '../utils/geoUtils';
import { reportError } from '../utils/reportError';

const MAPBOX_TOKEN = (typeof import.meta !== 'undefined'
    && import.meta.env?.VITE_MAPBOX_TOKEN) || '';

const fmtKm = (meters) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
};
const fmtMin = (seconds) => {
    const min = Math.max(1, Math.round(seconds / 60));
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
};

const haversineFallback = (origin, destination) => {
    const km = getDistanceFromLatLonInKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const meters = km * 1000;
    // Estimación de duración: 30 km/h urbano (Higuerote tiene tráfico bajo
    // pero calles angostas). Suficientemente realista para pricing fallback.
    const seconds = (km / 30) * 3600;
    return {
        distance: { value: meters, text: fmtKm(meters) },
        duration: { value: seconds, text: fmtMin(seconds) },
        polyline: [[origin.lng, origin.lat], [destination.lng, destination.lat]],
        degraded: true,
    };
};

/**
 * Obtener ruta entre dos puntos lat/lng.
 *
 * @param {{lat:number,lng:number}} origin
 * @param {{lat:number,lng:number}} destination
 * @param {string} [profile]  'driving-traffic' | 'driving' | 'walking' | 'cycling'
 * @returns {Promise<{distance, duration, polyline, degraded?}>}
 */
export const getRoute = async (origin, destination, profile = 'driving-traffic') => {
    if (!origin?.lat || !destination?.lat) {
        return haversineFallback(origin || {}, destination || {});
    }
    if (!MAPBOX_TOKEN) {
        // Sin token = fallback silencioso. Reportamos UNA vez para que el
        // admin vea que falta config (reportError tiene dedupe).
        reportError(new Error('Mapbox token missing — falling back to Haversine'), {
            source: 'directionsService',
        });
        return haversineFallback(origin, destination);
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/`
        + `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
        + `?geometries=geojson&overview=full&language=es&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);

        if (!res.ok) {
            throw new Error(`Mapbox Directions HTTP ${res.status}`);
        }
        const data = await res.json();
        const route = data?.routes?.[0];
        if (!route) {
            throw new Error('Mapbox Directions: no routes in response');
        }
        const meters = route.distance || 0;
        const seconds = route.duration || 0;
        return {
            distance: { value: meters, text: fmtKm(meters) },
            duration: { value: seconds, text: fmtMin(seconds) },
            polyline: route.geometry?.coordinates || [],
        };
    } catch (err) {
        // Cualquier fallo cae a Haversine. Reportamos para visibility.
        reportError(err, {
            source: 'directionsService.getRoute',
            origin, destination, profile,
        });
        return haversineFallback(origin, destination);
    }
};

export default getRoute;
