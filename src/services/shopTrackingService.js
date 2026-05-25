import { supabase } from './supabase.js';

const ACTOR_TYPES = new Set(['system', 'customer', 'merchant', 'driver']);

function assertValidOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    throw new Error('trackingService: orderId inválido');
  }
}

function assertValidCoordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('trackingService: lat/lng inválidos');
  }
}

export async function pushDriverLocation({ orderId, driverId, lat, lng, bearing = null, speedKmh = null, accuracyM = null }) {
  assertValidOrderId(orderId);
  assertValidCoordinates(lat, lng);
  if (!driverId || typeof driverId !== 'string') {
    throw new Error('trackingService: driverId inválido');
  }

  const { error } = await supabase.from('driver_locations').insert({
    order_id: orderId,
    driver_id: driverId,
    lat,
    lng,
    bearing,
    speed_kmh: speedKmh,
    accuracy_m: accuracyM,
  });
  if (error) throw error;
}

export async function pushOrderEvent({ orderId, eventType, actorType = 'system', actorId = null, payload = {} }) {
  assertValidOrderId(orderId);
  if (!eventType || typeof eventType !== 'string') {
    throw new Error('trackingService: eventType inválido');
  }
  if (!ACTOR_TYPES.has(actorType)) {
    throw new Error(`trackingService: actorType inválido (${actorType})`);
  }

  const { error } = await supabase.from('order_events').insert({
    order_id: orderId,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    payload,
  });
  if (error) throw error;
}

export function subscribeToDriverLocations(orderId, onLocation) {
  assertValidOrderId(orderId);
  if (typeof onLocation !== 'function') {
    throw new Error('trackingService: onLocation debe ser una función');
  }

  const channel = supabase
    .channel(`driver-locations-${orderId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'driver_locations',
        filter: `order_id=eq.${orderId}`,
      },
      (payload) => onLocation(payload.new),
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
