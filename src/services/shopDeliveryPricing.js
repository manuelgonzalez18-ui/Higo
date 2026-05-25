import { DELIVERY_CONFIG } from '../utils/shopConstants.js';

/**
 * Calculate delivery fee based on distance.
 * Base fee + per-km rate, clamped between min and max.
 * @param {number} distanceKm - Distance in kilometers
 * @returns {number} Delivery fee in Bs.
 */
export function calculateDeliveryFee(distanceKm) {
  const { baseFee, perKmRate, minFee, maxFee } = DELIVERY_CONFIG;
  const rawFee = baseFee + distanceKm * perKmRate;
  return Math.min(maxFee, Math.max(minFee, Math.round(rawFee * 100) / 100));
}

/**
 * Format a number as Venezuelan Bolívares.
 * @param {number} amount
 * @returns {string} e.g. 'Bs. 3.50'
 */
export function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return 'Bs. 0.00';
  return `Bs. ${Number(amount).toFixed(2)}`;
}

/**
 * Calculate change to return to customer.
 * @param {number} total - Total amount owed
 * @param {number} paidWith - Amount paid by customer
 * @returns {number} Change amount (0 if paidWith < total)
 */
export function calculateChange(total, paidWith) {
  if (paidWith < total) return 0;
  return Math.round((paidWith - total) * 100) / 100;
}
