import { apiUrl } from '../utils/apiUrl';
import { normalizeRouteWaypoints } from '../utils/routeWaypoints';
import { supabase } from './supabase';
import { trackEventLater } from './analytics';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const createClientRequestId = () => globalThis.crypto.randomUUID();

export const recoverRideRequest = async (clientRequestId, userId) => {
    const row = unwrap(await supabase.from('rides')
        .select('id,price,status,pricing_snapshot')
        .eq('user_id', userId).eq('client_request_id', clientRequestId).maybeSingle());
    return row ? { rideId: row.id, price: row.price, status: row.status, quote: row.pricing_snapshot, idempotentReplay: true } : null;
};

export const quoteRide = async ({ pickupCoords, dropoffCoords, vehicleType, serviceType = 'ride', stops = [], promoCode = null }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('authentication_required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(apiUrl('/api/ride-quote.php'), {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ pickupCoords, dropoffCoords, vehicleType, serviceType, stops: normalizeRouteWaypoints(stops), promoCode }),
            signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || !result.quoteId) throw new Error(result.message || result.error || 'quote_unavailable');
        return result;
    } finally { clearTimeout(timer); }
};

export const createRideRequest = async ({ quoteId, clientRequestId, pickup, dropoff, passengerPhone = null, deliveryInfo = null, payer = null, codAmount = null, termsVersion = null }) => {
    const result = unwrap(await supabase.rpc('create_ride_from_quote', {
        p_quote_id: quoteId, p_client_request_id: clientRequestId, p_pickup: pickup, p_dropoff: dropoff,
        p_passenger_phone: passengerPhone || null, p_delivery_info: deliveryInfo,
        p_payer: payer, p_cod_amount: codAmount == null || codAmount === '' ? null : Number(codAmount), p_terms_version: termsVersion,
    }));
    trackEventLater('ride.requested', { entityType: 'ride', entityId: result?.rideId, properties: { idempotent_replay: Boolean(result?.idempotentReplay) } });
    return result;
};

export const listDirectedRideOffers = async (limit = 20) => {
    const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const rows = unwrap(await supabase.rpc('driver_list_ride_offers', { p_limit: boundedLimit })) || [];
    return rows.map((row) => ({
        offerId: row.offer_id,
        expiresAt: row.expires_at,
        distanceKm: row.distance_km,
        score: row.score,
        ...(row.ride || {}),
    }));
};

export const getDirectedRideOfferForRide = async (rideId) => {
    const normalizedRideId = String(rideId ?? '').trim();
    if (!normalizedRideId) return null;

    const offers = await listDirectedRideOffers(50);
    return offers.find((offer) => String(offer.id) === normalizedRideId) || null;
};

export const areDirectedRideOffersEnabled = async () => {
    const value = unwrap(await supabase.rpc('higo_directed_offers_enabled'));
    return value === true || value === 'true' || value === 1;
};

export const acceptRide = async (rideId) => {
    const result = unwrap(await supabase.rpc('driver_accept_ride_v2', { p_ride_id: rideId }));
    trackEventLater('ride.accepted', { entityType: 'ride', entityId: rideId });
    return result;
};

export const markPickupArrival = async (rideId) => {
    const result = unwrap(await supabase.rpc('driver_mark_arrival_v2', { p_ride_id: rideId }));
    trackEventLater('ride.pickup_arrived', { entityType: 'ride', entityId: rideId });
    return result;
};

export const startRide = async (rideId) => {
    const result = unwrap(await supabase.rpc('driver_start_ride_v2', { p_ride_id: rideId }));
    trackEventLater('ride.started', { entityType: 'ride', entityId: rideId });
    return result;
};

export const markDropoffArrival = async (rideId) => {
    const result = unwrap(await supabase.rpc('driver_mark_dropoff_arrival_v2', { p_ride_id: rideId }));
    trackEventLater('ride.dropoff_arrived', { entityType: 'ride', entityId: rideId });
    return result;
};

export const completeRide = async (rideId) => {
    const result = unwrap(await supabase.rpc('driver_complete_ride_v2', { p_ride_id: rideId }));
    trackEventLater('ride.completed', { entityType: 'ride', entityId: rideId });
    return result;
};

export const confirmRidePayment = async (rideId) => {
    const result = unwrap(await supabase.rpc('ride_confirm_payment_v2', { p_ride_id: rideId }));
    trackEventLater('ride.payment_confirmed', { entityType: 'ride', entityId: rideId });
    return result;
};

export const cancelRide = async (rideId, reason) => {
    const result = unwrap(await supabase.rpc('passenger_cancel_ride_v2', {
        p_ride_id: rideId,
        p_reason: reason,
    }));
    trackEventLater('ride.cancelled', {
        entityType: 'ride',
        entityId: rideId,
        properties: { reason_code: String(reason || '').slice(0, 80) },
    });
    return result;
};
