import { supabase } from './supabase';
import { trackEventLater } from './analytics';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const createClientRequestId = () => {
    try {
        return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    } catch {
        return `${Date.now()}-${Math.random()}`;
    }
};

export const quoteRide = async ({
    pickupCoords,
    dropoffCoords,
    vehicleType,
    serviceType = 'ride',
    routeDistanceKm = null,
    stopsCount = 0,
    promoCode = null,
}) => unwrap(await supabase.rpc('higo_quote_ride_v2', {
    p_pickup_lat: pickupCoords?.lat,
    p_pickup_lng: pickupCoords?.lng,
    p_dropoff_lat: dropoffCoords?.lat,
    p_dropoff_lng: dropoffCoords?.lng,
    p_vehicle_type: vehicleType,
    p_service_type: serviceType,
    p_route_distance_km: routeDistanceKm,
    p_stops_count: stopsCount,
    p_promo_code: promoCode || null,
}));

export const createRideRequest = async ({
    clientRequestId,
    pickup,
    dropoff,
    pickupCoords,
    dropoffCoords,
    vehicleType,
    serviceType = 'ride',
    routeDistanceKm = null,
    stops = [],
    promoCode = null,
    passengerPhone = null,
    deliveryInfo = null,
    payer = null,
    codAmount = null,
    termsVersion = null,
    clientPriceFloor = null,
}) => {
    const result = unwrap(await supabase.rpc('create_ride_request_v3', {
        p_client_request_id: clientRequestId,
        p_pickup: pickup,
        p_dropoff: dropoff,
        p_pickup_lat: pickupCoords?.lat,
        p_pickup_lng: pickupCoords?.lng,
        p_dropoff_lat: dropoffCoords?.lat,
        p_dropoff_lng: dropoffCoords?.lng,
        p_vehicle_type: vehicleType,
        p_service_type: serviceType,
        p_route_distance_km: routeDistanceKm,
        p_stops: stops || [],
        p_promo_code: promoCode || null,
        p_passenger_phone: passengerPhone || null,
        p_delivery_info: deliveryInfo || null,
        p_payer: payer || null,
        p_cod_amount: codAmount == null || codAmount === '' ? null : Number(codAmount),
        p_terms_version: termsVersion || null,
        p_client_price_floor: clientPriceFloor == null || clientPriceFloor === '' ? null : Number(clientPriceFloor),
    }));
    trackEventLater('ride.requested', {
        entityType: 'ride',
        entityId: result?.rideId,
        properties: {
            vehicle_type: vehicleType,
            service_type: serviceType,
            stops_count: Array.isArray(stops) ? stops.length : 0,
            promo_applied: Boolean(promoCode),
            idempotent_replay: Boolean(result?.idempotentReplay),
        },
    });
    return result;
};

export const listDirectedRideOffers = async (limit = 20) => {
    const rows = unwrap(await supabase.rpc('driver_list_ride_offers', { p_limit: limit })) || [];
    return rows.map((row) => ({
        offerId: row.offer_id,
        expiresAt: row.expires_at,
        distanceKm: row.distance_km,
        score: row.score,
        ...(row.ride || {}),
    }));
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
