import { useEffect, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

// Module-level LRU cache for Directions responses. Coords are rounded to ~5
// decimals (~1 m) so semantically identical requests collapse to one entry.
// Keeps the Maps Platform bill predictable when many components mount with
// overlapping origin/destination pairs (tracking + checkout overlap a lot).
const DIRECTIONS_CACHE = new Map();
const DIRECTIONS_CACHE_MAX = 50;

function cacheKey(origin, destination, travelMode) {
  const r = (n) => Math.round(n * 1e5) / 1e5;
  return `${r(origin.lat)},${r(origin.lng)}|${r(destination.lat)},${r(destination.lng)}|${travelMode}`;
}

function cacheGet(key) {
  if (!DIRECTIONS_CACHE.has(key)) return null;
  const value = DIRECTIONS_CACHE.get(key);
  // LRU touch: re-insert to mark as most-recently used.
  DIRECTIONS_CACHE.delete(key);
  DIRECTIONS_CACHE.set(key, value);
  return value;
}

function cacheSet(key, value) {
  DIRECTIONS_CACHE.set(key, value);
  if (DIRECTIONS_CACHE.size > DIRECTIONS_CACHE_MAX) {
    const oldest = DIRECTIONS_CACHE.keys().next().value;
    DIRECTIONS_CACHE.delete(oldest);
  }
}

// Calls Google Directions API and returns the decoded polyline path so the
// caller can draw a RoutePolyline along the real road network. Falls back to
// the straight-line origin→destination pair if the API is unavailable.
export function useDirections(origin, destination, travelMode = 'DRIVING') {
  const routesLib = useMapsLibrary('routes');
  const [path, setPath] = useState(null);
  const [distance, setDistance] = useState(null);
  const [duration, setDuration] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!routesLib || !origin || !destination) return;

    const key = cacheKey(origin, destination, travelMode);
    const cached = cacheGet(key);
    if (cached) {
      setPath(cached.path);
      setDistance(cached.distance);
      setDuration(cached.duration);
      setError(null);
      return;
    }

    const service = new routesLib.DirectionsService();
    let cancelled = false;

    service.route(
      {
        origin,
        destination,
        travelMode: routesLib.TravelMode[travelMode] || routesLib.TravelMode.DRIVING,
      },
      (result, status) => {
        if (cancelled) return;
        if (status === 'OK' && result.routes[0]) {
          const route = result.routes[0];
          const overview = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
          const leg = route.legs[0];
          const dist = leg?.distance?.value || null;
          const dur = leg?.duration?.value || null;
          cacheSet(key, { path: overview, distance: dist, duration: dur });
          setPath(overview);
          setDistance(dist);
          setDuration(dur);
          setError(null);
        } else {
          setPath([origin, destination]);
          setError(status);
        }
      },
    );

    return () => { cancelled = true; };
  }, [routesLib, origin?.lat, origin?.lng, destination?.lat, destination?.lng, travelMode]);

  return { path, distance, duration, error };
}
