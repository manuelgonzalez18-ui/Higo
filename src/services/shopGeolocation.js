const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 * @param {number} deg
 * @returns {number}
 */
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate distance between two coordinates using Haversine formula.
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Compute compass bearing (0..360°, clockwise from north) from point a to b.
 * Used to rotate the driver marker so it faces the direction of travel.
 */
export function bearingBetween(a, b) {
  if (!a || !b) return null;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (θ * 180 / Math.PI + 360) % 360;
}

/**
 * Get the current position from the browser Geolocation API.
 * @param {object} [options] - PositionOptions for getCurrentPosition
 * @returns {Promise<{lat: number, lng: number}>}
 */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation no es soportado por tu navegador'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => {
        let message;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'Permiso de ubicación denegado';
            break;
          case error.POSITION_UNAVAILABLE:
            message = 'Ubicación no disponible';
            break;
          case error.TIMEOUT:
            message = 'Tiempo de espera agotado para obtener ubicación';
            break;
          default:
            message = 'Error desconocido al obtener ubicación';
        }
        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
        ...options
      }
    );
  });
}

/**
 * Estimate delivery time based on distance.
 * @param {number} distanceKm - Distance in kilometers
 * @returns {string} Estimated time range, e.g. '15-25 min'
 */
export function estimateDeliveryTime(distanceKm) {
  // Base preparation time: 10 min
  // Average speed in Caracas traffic: ~20 km/h for motos, ~15 km/h for cars
  const baseTime = 10;
  const travelTimeMin = Math.round((distanceKm / 20) * 60);
  const travelTimeMax = Math.round((distanceKm / 12) * 60);

  const minTime = Math.max(10, baseTime + travelTimeMin);
  const maxTime = Math.max(minTime + 5, baseTime + travelTimeMax + 5);

  return `${minTime}-${maxTime} min`;
}

/**
 * Format a real Google Directions duration (seconds) into a delivery ETA range.
 * Adds 10 min of prep overhead on top of the driving time.
 */
export function formatEtaFromSeconds(seconds) {
  if (seconds == null || isNaN(seconds)) return '--';
  const prepMin = 10;
  const travelMin = seconds / 60;
  const minTime = Math.max(10, Math.round(prepMin + travelMin));
  const maxTime = minTime + 5;
  return `${minTime}-${maxTime} min`;
}

/**
 * Format a driving duration (seconds) into a compact "X min" string. No prep
 * buffer — for live tracking chips.
 */
export function formatDurationMin(seconds) {
  if (seconds == null || isNaN(seconds)) return '--';
  const min = Math.max(1, Math.round(seconds / 60));
  return `${min} min`;
}

/**
 * Format a distance value for display.
 * @param {number} km - Distance in kilometers
 * @returns {string} Formatted distance, e.g. '1.3 km' or '800 m'
 */
export function formatDistance(km) {
  if (km == null || isNaN(km)) return '-- km';
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}
