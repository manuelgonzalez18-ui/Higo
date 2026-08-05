// Contrato de disponibilidad para Higo Driver 1.5.17: solo ofertas activas,
// no asignadas y dentro de la vigencia emitida por el despacho progresivo.
const asTimestamp = (value) => {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
};

export const getRideOfferExpiry = (request = {}) => (
    request.expiresAt
    ?? request.expires_at
    ?? request.offer_expires_at
    ?? null
);

export const isDriverRideRequestAvailable = (request = {}, nowMs = Date.now()) => {
    if (!request?.id) return false;

    const status = String(request.status || 'requested').trim().toLowerCase();
    if (status !== 'requested') return false;

    if (request.driver_id != null && String(request.driver_id).trim() !== '') return false;

    const expiry = asTimestamp(getRideOfferExpiry(request));
    if (expiry != null && expiry <= nowMs) return false;

    return true;
};

export const hasActiveDirectedRideOffer = (request = {}, nowMs = Date.now()) => {
    const offerId = request.offerId ?? request.offer_id ?? null;
    if (offerId == null || String(offerId).trim() === '') return false;
    return isDriverRideRequestAvailable(request, nowMs);
};

export const resolveRideRequestDeadline = (
    request = {},
    nowMs = Date.now(),
    fallbackSeconds = 25,
) => {
    const expiry = asTimestamp(getRideOfferExpiry(request));
    if (expiry != null) return expiry;
    return nowMs + Math.max(1, Number(fallbackSeconds) || 25) * 1000;
};

export const secondsUntilRideRequestDeadline = (deadlineMs, nowMs = Date.now()) => {
    const deadline = Number(deadlineMs);
    if (!Number.isFinite(deadline)) return 0;
    return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
};
