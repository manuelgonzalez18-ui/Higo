export const FALLBACK_RATES = Object.freeze({
    // perMinute inicia en 0 para que el despliegue en modo shadow no altere
    // precios. El administrador lo activa después de analizar el simulador.
    moto: Object.freeze({
        base: 1.00,
        minimumFare: 1.00,
        perKm: 0.25,
        perMinute: 0,
        includedKm: 1,
        deliveryFee: 0.50,
        waitPerMin: 0.05,
        freeWaitMinutes: 3,
        stopFee: 0.50,
        maximumMultiplier: 1.30,
    }),
    standard: Object.freeze({
        base: 1.50,
        minimumFare: 1.50,
        perKm: 0.40,
        perMinute: 0,
        includedKm: 1,
        deliveryFee: 1.50,
        waitPerMin: 0.08,
        freeWaitMinutes: 3,
        stopFee: 1.00,
        maximumMultiplier: 1.30,
    }),
    van: Object.freeze({
        base: 1.70,
        minimumFare: 1.70,
        perKm: 0.60,
        perMinute: 0,
        includedKm: 1,
        deliveryFee: 2.00,
        waitPerMin: 0.10,
        freeWaitMinutes: 3,
        stopFee: 1.00,
        maximumMultiplier: 1.30,
    }),
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

export const safeRouteDurationMin = ({ distanceKm, routeDurationMin }) => {
    const duration = Number(routeDurationMin);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    // Misma defensa que el servidor: 30 minutos fijos + hasta 12 min por km.
    const maximum = Math.max(30, Math.max(0, Number(distanceKm) || 0) * 12 + 30);
    return Math.min(duration, maximum);
};

export const normalizePricingRates = (rates = {}) => {
    const base = Math.max(0, Number(rates.base) || 0);
    return {
        base,
        minimumFare: Math.max(base, Number(rates.minimumFare ?? rates.minimum_fare ?? base) || 0),
        perKm: Math.max(0, Number(rates.perKm ?? rates.per_km) || 0),
        perMinute: Math.max(0, Number(rates.perMinute ?? rates.per_minute) || 0),
        includedKm: Math.max(0, Number(rates.includedKm ?? rates.included_km ?? 1) || 0),
        deliveryFee: Math.max(0, Number(rates.deliveryFee ?? rates.delivery_fee) || 0),
        waitPerMin: Math.max(0, Number(rates.waitPerMin ?? rates.wait_per_min) || 0),
        freeWaitMinutes: Math.max(0, Number(rates.freeWaitMinutes ?? rates.free_wait_minutes ?? 3) || 0),
        stopFee: Math.max(0, Number(rates.stopFee ?? rates.stop_fee) || 0),
        maximumMultiplier: Math.max(1, Math.min(Number(rates.maximumMultiplier ?? rates.maximum_multiplier ?? 1.30) || 1.30, 3)),
    };
};

export const computeFallbackQuote = ({
    origin,
    destination,
    routeDistanceKm,
    routeDurationMin = 0,
    vehicleType,
    serviceType = 'ride',
    stopsCount = 0,
    surgeMultiplier = 1,
    rates = FALLBACK_RATES,
}) => {
    const type = canonicalVehicleType(vehicleType);
    const selectedRates = normalizePricingRates(rates[type] || FALLBACK_RATES[type]);
    const distanceKm = safeRouteDistanceKm({ origin, destination, routeDistanceKm });
    const durationMin = safeRouteDurationMin({ distanceKm, routeDurationMin });
    const safeStops = Math.max(0, Math.min(Number(stopsCount) || 0, 5));
    const safeSurge = Math.max(
        1,
        Math.min(Number(surgeMultiplier) || 1, selectedRates.maximumMultiplier),
    );

    const distanceAmount = Math.max(0, distanceKm - selectedRates.includedKm) * selectedRates.perKm;
    const timeAmount = durationMin * selectedRates.perMinute;
    const stopsAmount = safeStops * selectedRates.stopFee;
    const extrasAmount = serviceType === 'delivery' ? selectedRates.deliveryFee : 0;
    const beforeMultiplier = selectedRates.base + distanceAmount + timeAmount + stopsAmount + extrasAmount;
    const subtotal = Math.max(selectedRates.minimumFare, beforeMultiplier * safeSurge);

    return {
        pricingVersion: 4,
        pricingModel: 'distance_time_minimum_v4',
        vehicleType: type,
        serviceType,
        distanceKm,
        durationMin,
        stopsCount: safeStops,
        surgeMultiplier: safeSurge,
        baseAmount: Number(selectedRates.base.toFixed(2)),
        distanceAmount: Number(distanceAmount.toFixed(2)),
        timeAmount: Number(timeAmount.toFixed(2)),
        stopsAmount: Number(stopsAmount.toFixed(2)),
        extrasAmount: Number(extrasAmount.toFixed(2)),
        minimumFare: Number(selectedRates.minimumFare.toFixed(2)),
        subtotal: Number(subtotal.toFixed(2)),
    };
};

export const computeWaitFee = ({ vehicleType, elapsedSeconds, rates = FALLBACK_RATES, freeMinutes = null }) => {
    const type = canonicalVehicleType(vehicleType);
    const selectedRates = normalizePricingRates(rates[type] || FALLBACK_RATES[type]);
    const includedMinutes = freeMinutes == null
        ? selectedRates.freeWaitMinutes
        : Math.max(0, Number(freeMinutes) || 0);
    const billableMinutes = Math.max(0, (Number(elapsedSeconds) || 0) / 60 - includedMinutes);
    return Number((billableMinutes * selectedRates.waitPerMin).toFixed(2));
};
