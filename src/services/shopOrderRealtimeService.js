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
