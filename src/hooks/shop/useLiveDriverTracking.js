import { useEffect, useMemo, useState } from 'react';
import { subscribeToDriverLocations } from '../../services/shopTrackingService.js';
import { bearingBetween } from '../../services/shopGeolocation.js';

export function useLiveDriverTracking(orderId, fallbackPosition = null) {
  const [driverPos, setDriverPos] = useState(fallbackPosition);
  const [driverBearing, setDriverBearing] = useState(null);
  const [lastSignalAt, setLastSignalAt] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!orderId) return;
    let prev = null;
    const unsubscribe = subscribeToDriverLocations(orderId, (row) => {
      const next = { lat: Number(row.lat), lng: Number(row.lng) };
      setDriverPos(next);
      setLastSignalAt(row.recorded_at || new Date().toISOString());
      if (prev) setDriverBearing(bearingBetween(prev, next));
      prev = next;
    });

    return unsubscribe;
  }, [orderId]);

  useEffect(() => {
    if (!lastSignalAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lastSignalAt]);

  const signalAgeSec = useMemo(() => {
    if (!lastSignalAt) return null;
    return Math.max(0, Math.round((nowMs - new Date(lastSignalAt).getTime()) / 1000));
  }, [lastSignalAt, nowMs]);

  return { driverPos, driverBearing, signalAgeSec, lastSignalAt };
}
