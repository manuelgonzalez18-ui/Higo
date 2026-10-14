const toRad = (value) => Number(value) * Math.PI / 180;

export const pricingDistanceKm = (a, b) => {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const lat1 = Number(a.lat);
    const lng1 = Number(a.lng);
    const lat2 = Number(b.lat);
    const lng2 = Number(b.lng);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const sLat = Math.sin(dLat / 2);
    const sLng = Math.sin(dLng / 2);
    const h = sLat * sLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLng * sLng;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};

const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export const isGenericCurrentLocationLabel = (label) => {
    const value = normalize(label);
    return !value
        || value === 'ubicacion actual'
        || value === 'mi ubicacion'
        || value === 'current location';
};

export const nearestPricingLocation = (coords, locations, maxDistanceKm = 2.5) => {
    if (!coords || !Array.isArray(locations) || locations.length === 0) return null;
    let best = null;
    for (const location of locations) {
        const distanceKm = pricingDistanceKm(coords, location);
        if (!Number.isFinite(distanceKm)) continue;
        if (!best || distanceKm < best.distanceKm) {
            best = { ...location, distanceKm };
        }
    }
    return best && best.distanceKm <= maxDistanceKm ? best : null;
};

export const resolvePricingLocationLabel = async (label, coords, maxDistanceKm = 2.5) => {
    if (!isGenericCurrentLocationLabel(label)) return label;
    if (!coords) return label || '';

    try {
        const { MOCK_HIGUEROTE_LOCATIONS } = await import('../services/geminiService');
        const nearest = nearestPricingLocation(coords, MOCK_HIGUEROTE_LOCATIONS, maxDistanceKm);
        return nearest?.title || label || '';
    } catch {
        return label || '';
    }
};
