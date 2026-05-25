export const APP_NAME = 'Higo Shop';

export const ORDER_STATUSES = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PREPARING: 'PREPARING',
  READY_TO_DISPATCH: 'READY_TO_DISPATCH',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED'
};

export const STORE_CATEGORIES = [
  { id: 'all', label: 'Todos', icon: 'grid' },
  { id: 'restaurant', label: 'Restaurantes', icon: 'utensils' },
  { id: 'pharmacy', label: 'Farmacias', icon: 'first-aid' },
  { id: 'bakery', label: 'Panaderías', icon: 'cake' },
  { id: 'grocery', label: 'Bodegones', icon: 'shopping-bag' },
  { id: 'cafe', label: 'Cafeterías', icon: 'coffee' }
];

export const DELIVERY_CONFIG = {
  baseFee: 1.50,
  perKmRate: 1.00,
  minFee: 2.00,
  maxFee: 10.00
};
