// Central config for Google Maps SDK loading.
// API key falls back to the same public key used in the deploy workflow so
// local/manual builds work without a .env. Restricted by HTTP referrer on the
// Google Cloud side. Sin este fallback, un build sin la env var hacía throw a
// nivel de módulo y dejaba la app en pantalla negra (incidente 2026-05-24).
const FALLBACK_API_KEY = 'AIzaSyAoGygSCo5Uxoi7Dz3-cusemmz2CD8Lhko';

export const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || FALLBACK_API_KEY;

// Optional mapId for vector + cloud-styled maps. When provided, AdvancedMarker
// renders properly. Without it the markers still render but the SDK logs a
// warning; the raster style array below is applied as a fallback.
export const GOOGLE_MAPS_ID = import.meta.env.VITE_GOOGLE_MAPS_ID || undefined;

export const GOOGLE_MAPS_LIBRARIES = ['places', 'routes', 'marker', 'geocoding'];

// Dark theme styles — only applied when mapId is absent (Cloud styling
// supersedes inline styles on vector maps).
export const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1a2236' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a2236' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#162033' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#10b981' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#283246' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a2236' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3b4860' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a2236' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#283246' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0f1d' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3b82f6' }] },
];
