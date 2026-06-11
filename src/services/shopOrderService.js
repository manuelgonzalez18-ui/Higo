import { supabase } from './supabase.js';
import { ORDER_STATUSES } from './shopOrderStatus.js';

function assertNonEmptyId(value, fieldName) {
  if (!value || typeof value !== 'string') {
    throw new Error(`orderService: ${fieldName} inválido`);
  }
}

export function mapOrderRow(row) {
  if (!row) return null;
  const items = Array.isArray(row.items) ? row.items : [];
  const grandTotal = Number(row.total || 0);
  const deliveryFee = Number(row.delivery_fee || 0);
  const productTotal = Math.max(0, grandTotal - deliveryFee);

  const status = ORDER_STATUSES.includes(row.status) ? row.status : 'PENDING_PAYMENT';

  return {
    id: row.id,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    driverId: row.driver_id,
    storeId: row.store_id,
    items,
    productTotal,
    grandTotal,
    deliveryFee,
    deliveryAddress: row.delivery_address,
    userLocation: row.delivery_latitude != null && row.delivery_longitude != null
      ? { lat: Number(row.delivery_latitude), lng: Number(row.delivery_longitude) }
      : null,
  };
}

export async function createOrderRemote(orderPayload) {
  const { data, error } = await supabase
    .from('orders')
    .insert(orderPayload)
    .select('*')
    .single();

  if (error) throw error;
  return mapOrderRow(data);
}


export async function fetchOrdersByCustomerRemote(customerId, { limit = 50, offset = 0 } = {}) {
  assertNonEmptyId(customerId, 'customerId');

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return (data || []).map(mapOrderRow);
}


export async function fetchOrderByIdRemote(orderId) {
  assertNonEmptyId(orderId, 'orderId');

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error) throw error;
  return mapOrderRow(data);
}


export async function fetchDispatchableOrdersRemote({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['READY_TO_DISPATCH', 'DRIVER_ASSIGNED', 'PICKED_UP'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(mapOrderRow);
}

export async function fetchStoreOrdersRemote(storeId, { limit = 100, offset = 0 } = {}) {
  assertNonEmptyId(storeId, 'storeId');

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return (data || []).map(mapOrderRow);
}
