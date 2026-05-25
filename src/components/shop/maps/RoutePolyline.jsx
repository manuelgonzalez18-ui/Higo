import { useEffect } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

// Draws a google.maps.Polyline imperatively because the React wrapper does
// not ship a declarative Polyline component yet. path is an array of
// { lat, lng } pairs. options forwards through to the native Polyline.
export function RoutePolyline({
  path,
  color = '#3B82F6',
  weight = 4,
  opacity = 0.85,
  dashed = false,
  fitBounds = false,
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !path || path.length < 2 || !window.google?.maps) return;

    const polylineOptions = {
      path,
      strokeColor: color,
      strokeOpacity: dashed ? 0 : opacity,
      strokeWeight: weight,
      map,
      icons: dashed
        ? [{
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: opacity,
              strokeColor: color,
              strokeWeight: weight,
              scale: 3,
            },
            offset: '0',
            repeat: '14px',
          }]
        : undefined,
    };

    const polyline = new window.google.maps.Polyline(polylineOptions);

    if (fitBounds) {
      const bounds = new window.google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 80);
    }

    return () => polyline.setMap(null);
  }, [map, JSON.stringify(path), color, weight, opacity, dashed, fitBounds]);

  return null;
}
