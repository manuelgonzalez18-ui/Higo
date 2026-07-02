import { supabase } from './supabase.js';
import { assertValidOrderStatus } from './shopOrderStatus.js';

function assertValidOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    throw new Error('orderRealtimeService: orderId inválido');
  }
}

export async function syncOrderStatus(orderId, status, driverId = null) {
  assertValidOrderId(orderId);
  assertValidOrderStatus(status);

  const patch = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (driverId) patch.driver_id = driverId;

  const { error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', orderId)
    .select('id')
    .single();

  if (error) throw error;
}

/**
 * Reclama (acepta) un pedido para un driver de forma ATÓMICA: el UPDATE solo
 * tiene éxito si `driver_id` sigue en NULL, así dos drivers que aceptan la
 * misma orden en difusión no pueden pisarse (el segundo obtiene 0 filas).
 *
 * @returns {Promise<boolean>} true si lo reclamó este driver; false si otro
 *   driver ya lo había tomado.
 */
export async function claimDeliveryOrder(orderId, driverId, status) {
  assertValidOrderId(orderId);
  assertValidOrderStatus(status);
  if (!driverId || typeof driverId !== 'string') {
    throw new Error('orderRealtimeService: driverId requerido para reclamar el pedido');
  }

  const { data, error } = await supabase
    .from('orders')
    .update({
      status,
      driver_id: driverId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .is('driver_id', null) // guarda atómica: solo si nadie lo tomó todavía
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export function subscribeToOrder(orderId, onChange) {
  assertValidOrderId(orderId);
  if (typeof onChange !== 'function') {
    throw new Error('orderRealtimeService: onChange debe ser una función');
  }

  const channel = supabase
    .channel(`order-status-${orderId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: `id=eq.${orderId}`,
    }, (payload) => onChange(payload.new))
    .subscribe();

  return () => supabase.removeChannel(channel);
}
