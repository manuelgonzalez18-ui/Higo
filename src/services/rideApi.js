import { supabase } from './supabase';
import { trackEventLater } from './analytics';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

const isMissingRpc = (error) => {
    const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
    return error?.code === 'PGRST202'
        || error?.code === '42883'
        || /could not find the function|function .* does not exist/i.test(text);
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
    routeDurationMin = null,
    stopsCount = 0,
    promoCode = null,
    clientSubtotalFloor = null,
}) => {
    const common = {
        p_pickup_lat: pickupCoords?.lat,
        p_pickup_lng: pickupCoords?.lng,
        p_dropoff_lat: dropoffCoords?.lat,
        p_dropoff_lng: dropoffCoords?.lng,
        p_vehicle_type: vehicleType,
        p_service_type: serviceType,
        p_route_distance_km: routeDistanceKm,
        p_stops_count: stopsCount,
        p_promo_code: promoCode || null,
        p_client_subtotal_floor: clientSubtotalFloor == null || clientSubtotalFloor === '' ? null : Number(clientSubtotalFloor),
    };

    const v4 = await supabase.rpc('higo_quote_ride_v4', {
        ...common,
        p_route_duration_min: routeDurationMin,
    });
    if (!v4.error) return v4.data;
    if (!isMissingRpc(v4.error)) throw v4.error;

    // Compatibilidad durante la promoción de la migración: una web nueva no
    // debe romperse si el esquema remoto todavía expone únicamente V3.
    return unwrap(await supabase.rpc('higo_quote_ride_v3', common));
};

export const createRideRequest = async ({
    clientRequestId,
    pickup,
    dropoff,
    pickupCoords,
    dropoffCoords,
    vehicleType,
    serviceType = 'ride',
    routeDistanceKm = null,
    routeDurationMin = null,
    stops = [],
    promoCode = null,
    passengerPhone = null,
    deliveryInfo = null,
    payer = null,
    codAmount = null,
    termsVersion = null,
    clientSubtotalFloor = null,
}) => {
    const common = {
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
        p_client_subtotal_floor: clientSubtotalFloor == null || clientSubtotalFloor === '' ? null : Number(clientSubtotalFloor),
    };

    const v5 = await supabase.rpc('create_ride_request_v5', {
        ...common,
        p_route_duration_min: routeDurationMin,
    });
    let result;
    if (!v5.error) {
        result = v5.data;
    } else if (isMissingRpc(v5.error)) {
        result = unwrap(await supabase.rpc('create_ride_request_v4', common));
    } else {
        throw v5.error;
    }

    trackEventLater('ride.requested', {
        entityType: 'ride',
        entityId: result?.rideId,
        properties: {
            vehicle_type: vehicleType,
            service_type: serviceType,
            stops_count: Array.isArray(stops) ? stops.length : 0,
            promo_applied: Boolean(promoCode),
            idempotent_replay: Boolean(result?.idempotentReplay),
            pricing_version: result?.quote?.pricingVersion || null,
            pricing_rollout_mode: result?.quote?.rolloutMode || null,
            pricing_model_applied: Boolean(result?.quote?.modelApplied),
            route_duration_min: routeDurationMin,
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
