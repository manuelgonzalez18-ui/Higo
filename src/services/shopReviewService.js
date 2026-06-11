import { supabase } from './supabase.js';

function assertValidOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    throw new Error('reviewService: orderId inválido');
  }
}

export function mapReviewRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    storeId: row.store_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export async function fetchReviewForOrder(orderId) {
  assertValidOrderId(orderId);

  const { data, error } = await supabase
    .from('shop_store_reviews')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) throw error;
  return mapReviewRow(data);
}

export async function submitStoreReview({ orderId, rating, comment = null }) {
  assertValidOrderId(orderId);
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('reviewService: rating debe estar entre 1 y 5');
  }

  const { data, error } = await supabase.rpc('submit_store_review', {
    p_order_id: orderId,
    p_rating: value,
    p_comment: comment,
  });

  if (error) throw error;
  return mapReviewRow(Array.isArray(data) ? data[0] : data);
}
