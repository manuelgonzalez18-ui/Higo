export const FALLBACK_RATES = Object.freeze({
    moto: Object.freeze({ base: 1.00, perKm: 0.25, deliveryFee: 0.50, waitPerMin: 0.05, stopFee: 0.50 }),
    standard: Object.freeze({ base: 1.50, perKm: 0.40, deliveryFee: 1.50, waitPerMin: 0.08, stopFee: 1.00 }),
    van: Object.freeze({ base: 1.70, perKm: 0.60, deliveryFee: 2.00, waitPerMin: 0.10, stopFee: 1.00 }),
});

export const canonicalVehicleType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['moto', 'motorcycle', 'motocicleta'].includes(normalized)) return 'moto';
    if (['van', 'camioneta', 'pickup'].includes(normalized)) return 'van';
    return 'standard';
};

export const haversineKm = (origin, destination) => {
    if (!origin || !destination) return 0;
    const { lat: lat1, lng: lng1 } = origin;
    const { lat: lat2, lng: lng2 } = destination;
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;

    const radians = (degrees) => degrees * Math.PI / 180;
    const dLat = radians(lat2 - lat1);
    const dLng = radians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const safeRouteDistanceKm = ({ origin, destination, routeDistanceKm }) => {
    const minimum = haversineKm(origin, destination);
    const clientDistance = Number(routeDistanceKm);
    if (!Number.isFinite(clientDistance) || clientDistance <= 0) return minimum;
    const maximum = Math.max(minimum * 4, minimum + 5);
    return Math.max(minimum, Math.min(clientDistance, maximum));
};

export const computeFallbackQuote = ({
    origin,
    destination,
    routeDistanceKm,
    vehicleType,
    serviceType = 'ride',
    stopsCount = 0,
    surgeMultiplier = 1,
    rates = FALLBACK_RATES,
}) => {
    const type = canonicalVehicleType(vehicleType);
    const selectedRates = rates[type] || FALLBACK_RATES[type];
    const distanceKm = safeRouteDistanceKm({ origin, destination, routeDistanceKm });
    const safeStops = Math.max(0, Math.min(Number(stopsCount) || 0, 5));
    const safeSurge = Math.max(1, Math.min(Number(surgeMultiplier) || 1, 5));

    const subtotal = (
        selectedRates.base
        + Math.max(0, distanceKm - 1) * selectedRates.perKm
        + safeStops * selectedRates.stopFee
        + (serviceType === 'delivery' ? selectedRates.deliveryFee : 0)
    ) * safeSurge;

    return {
        vehicleType: type,
        serviceType,
        distanceKm,
        stopsCount: safeStops,
        surgeMultiplier: safeSurge,
        subtotal: Number(Math.max(selectedRates.base, subtotal).toFixed(2)),
    };
};

export const computeWaitFee = ({ vehicleType, elapsedSeconds, rates = FALLBACK_RATES, freeMinutes = 3 }) => {
    const type = canonicalVehicleType(vehicleType);
    const rate = rates[type]?.waitPerMin ?? FALLBACK_RATES.standard.waitPerMin;
    const billableMinutes = Math.max(0, (Number(elapsedSeconds) || 0) / 60 - freeMinutes);
    return Number((billableMinutes * rate).toFixed(2));
};
