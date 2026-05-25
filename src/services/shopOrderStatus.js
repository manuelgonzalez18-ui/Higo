export const ORDER_STATUSES = Object.freeze([
  'PENDING_PRODUCT_PAYMENT',
  'PRODUCT_PAYMENT_REPORTED',
  'PRODUCT_PAYMENT_VERIFIED',
  'PREPARING',
  'READY_FOR_DRIVER_MATCH',
  'DRIVER_CANDIDATE_BROADCASTED',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE_TO_STORE',
  'PICKED_UP',
  'DRIVER_EN_ROUTE_TO_CUSTOMER',
  'DELIVERY_PAYMENT_PENDING',
  'DELIVERY_PAYMENT_REPORTED',
  'DELIVERY_PAYMENT_CONFIRMED',
  'DELIVERED',
  'CANCELLED',
  // Legacy compatibility
  'PENDING_PAYMENT',
  'PAYMENT_VERIFIED',
  'READY_TO_DISPATCH',
]);

export const ORDER_STATUS_LABELS = Object.freeze({
  PENDING_PRODUCT_PAYMENT: 'Pago de productos pendiente',
  PRODUCT_PAYMENT_REPORTED: 'Pago reportado (comercio)',
  PRODUCT_PAYMENT_VERIFIED: 'Pago de productos verificado',
  PENDING_PAYMENT: 'Pago pendiente',
  PAYMENT_VERIFIED: 'Pago verificado',
  PREPARING: 'Preparando pedido',
  READY_FOR_DRIVER_MATCH: 'Listo para buscar driver',
  DRIVER_CANDIDATE_BROADCASTED: 'Buscando driver cercano',
  READY_TO_DISPATCH: 'Listo para despachar',
  DRIVER_ASSIGNED: 'Driver asignado',
  DRIVER_EN_ROUTE_TO_STORE: 'Driver en camino al comercio',
  PICKED_UP: 'En camino',
  DRIVER_EN_ROUTE_TO_CUSTOMER: 'Driver en camino al cliente',
  DELIVERY_PAYMENT_PENDING: 'Pago de envío pendiente',
  DELIVERY_PAYMENT_REPORTED: 'Pago de envío reportado',
  DELIVERY_PAYMENT_CONFIRMED: 'Pago de envío confirmado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
});

export function assertValidOrderStatus(status) {
  if (!status || typeof status !== 'string' || !ORDER_STATUSES.includes(status)) {
    throw new Error(`orderStatus: status inválido (${status ?? 'null'})`);
  }
}

export function formatOrderStatus(status) {
  return ORDER_STATUS_LABELS[status] || status || 'Sin estado';
}

const ORDER_EVENT_LABELS = Object.freeze({
  ORDER_CREATED: 'Pedido creado',
  PRODUCT_PAYMENT_REPORTED: 'Pago de productos reportado',
  PRODUCT_PAYMENT_VERIFIED: 'Pago de productos verificado',
  PAYMENT_VERIFIED: 'Pago verificado',
  PREPARING: 'Preparando pedido',
  ORDER_READY_FOR_DRIVER_MATCH: 'Listo para buscar driver',
  DRIVER_CANDIDATE_BROADCASTED: 'Buscando driver cercano',
  DRIVER_EN_ROUTE_TO_STORE: 'Driver en camino al comercio',
  READY_TO_DISPATCH: 'Listo para despacho',
  DRIVER_ASSIGNED: 'Driver asignado',
  ORDER_PICKED_UP: 'Pedido retirado',
  PICKED_UP: 'Pedido retirado',
  DRIVER_EN_ROUTE_TO_CUSTOMER: 'Driver en camino al cliente',
  DELIVERY_PAYMENT_REPORTED: 'Pago de envío reportado',
  DELIVERY_PAYMENT_CONFIRMED: 'Pago de envío confirmado',
  ORDER_DELIVERED: 'Pedido entregado',
  DELIVERED: 'Pedido entregado',
  ORDER_CANCELLED: 'Pedido cancelado',
});

export function formatOrderEventType(eventType) {
  return ORDER_EVENT_LABELS[eventType] || eventType || 'Evento';
}
