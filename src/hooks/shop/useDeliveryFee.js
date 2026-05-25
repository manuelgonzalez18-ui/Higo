import { useMemo } from 'react';
import { useLocationStore } from '../../stores/shop/useLocationStore.js';
import {
  calculateDistance,
  formatDistance,
  estimateDeliveryTime,
  formatEtaFromSeconds,
} from '../../services/shopGeolocation.js';
import { calculateDeliveryFee, formatCurrency } from '../../services/shopDeliveryPricing.js';

// When liveDistanceMeters / liveDurationSeconds are provided (from a Google
// Directions response) the hook uses those for fee + ETA so pricing matches
// the actual driving route. Otherwise it falls back to haversine + speed
// heuristic — keeping consumers without map context working.
export function useDeliveryFee(storeLat, storeLon, options = {}) {
  const { userLocation } = useLocationStore();
  const { liveDistanceMeters, liveDurationSeconds } = options;

  return useMemo(() => {
    if (!userLocation || storeLat == null || storeLon == null) {
      return {
        distance: 0,
        distanceText: '-- km',
        fee: 0,
        feeText: 'Bs. 0.00',
        estimatedTime: '--',
        isLive: false,
      };
    }

    const distance = liveDistanceMeters != null
      ? liveDistanceMeters / 1000
      : calculateDistance(userLocation.lat, userLocation.lng, storeLat, storeLon);

    const fee = calculateDeliveryFee(distance);

    const estimatedTime = liveDurationSeconds != null
      ? formatEtaFromSeconds(liveDurationSeconds)
      : estimateDeliveryTime(distance);

    return {
      distance,
      distanceText: formatDistance(distance),
      fee,
      feeText: formatCurrency(fee),
      estimatedTime,
      isLive: liveDistanceMeters != null,
    };
  }, [userLocation, storeLat, storeLon, liveDistanceMeters, liveDurationSeconds]);
}
