import { useEffect } from 'react';
import { APIProvider, Map, useMap, useApiLoadingStatus } from '@vis.gl/react-google-maps';
import {
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_ID,
  GOOGLE_MAPS_LIBRARIES,
  DARK_MAP_STYLES,
} from '../../../services/shopGoogleMaps.js';

// Recenters + zooms the parent Map to fit all provided points. The effect
// re-runs only when `key` changes so consumers can opt in to "fit once per
// leg" semantics instead of refitting on every driver tick.
export function AutoFitBounds({ points, padding = 80, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !points?.length || !window.google?.maps) return;
    const valid = points.filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number');
    if (valid.length < 2) return;
    const bounds = new window.google.maps.LatLngBounds();
    valid.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, padding);
  }, [map, fitKey]);
  return null;
}

export function GoogleMapsProvider({ children }) {
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={GOOGLE_MAPS_LIBRARIES}>
      {children}
    </APIProvider>
  );
}

// Shimmer placeholder shown while the Google Maps JS SDK is loading or if it
// fails to authenticate. Sits inside the same container as the <Map> so the
// layout doesn't reflow when the real map mounts.
function MapSkeleton({ failed }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: failed
          ? 'linear-gradient(135deg, #1a2236 0%, #0f1422 100%)'
          : 'linear-gradient(135deg, #1a2236 0%, #283246 50%, #1a2236 100%)',
        backgroundSize: '200% 200%',
        animation: failed ? undefined : 'higo-map-shimmer 1.8s ease-in-out infinite',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        color: failed ? '#f87171' : '#94a3b8',
        fontSize: 13,
        fontWeight: 500,
        gap: 6,
        pointerEvents: 'none',
      }}
    >
      <span style={{ fontSize: 24 }}>{failed ? '⚠️' : '🗺️'}</span>
      <span>{failed ? 'No se pudo cargar el mapa' : 'Cargando mapa...'}</span>
    </div>
  );
}

// Single source of truth for our themed Google Map. center is { lat, lng }.
// Wrap in <GoogleMapsProvider> at the page root.
export function MapView({
  center,
  zoom = 14,
  children,
  className,
  style,
  onClick,
  disableUI = true,
  gestureHandling = 'greedy',
}) {
  const apiStatus = useApiLoadingStatus();
  const isReady = apiStatus === 'LOADED';
  const hasFailed = apiStatus === 'FAILED' || apiStatus === 'AUTH_FAILURE';

  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    >
      <Map
        center={center}
        defaultZoom={zoom}
        mapId={GOOGLE_MAPS_ID}
        styles={GOOGLE_MAPS_ID ? undefined : DARK_MAP_STYLES}
        disableDefaultUI={disableUI}
        gestureHandling={gestureHandling}
        clickableIcons={false}
        onClick={onClick}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </Map>
      {(!isReady || hasFailed) && <MapSkeleton failed={hasFailed} />}
    </div>
  );
}
