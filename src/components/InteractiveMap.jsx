// InteractiveMap.jsx — wrapper dual-engine (Anexo C / M0).
//
// Conmuta entre el motor Google (InteractiveMapGoogle, actual) y el
// motor Mapbox (InteractiveMapMapbox, nuevo) usando la env var
// VITE_MAP_ENGINE inyectada en build time.
//
// CONTRATO: este wrapper expone EXACTAMENTE la misma firma de props
// que InteractiveMapGoogle (center, origin, destination, assignedDriver,
// markers, markersProp, routeColor, onRouteData, isDriver, vehicleType,
// activeRideId, navStep, showPin, className). Las 5 páginas
// consumidoras NO se tocan al migrar.
//
// Fallback de seguridad: si una webview vieja no tiene WebGL, caemos
// silenciosamente a Google (Mapbox requiere WebGL). Documentado en
// docs/OPERATIONS.md.
//
// Rollback: cambiar VITE_MAP_ENGINE=google en GitHub Secrets +
// redeploy. Code path Google queda intacto hasta M7.

import React, { lazy, Suspense } from 'react';

const InteractiveMapGoogle = lazy(() => import('./InteractiveMapGoogle'));
const InteractiveMapMapbox = lazy(() => import('./InteractiveMapMapbox'));

const FLAG = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAP_ENGINE) || 'google';

// Detección de WebGL para fallback automático. Mapbox GL JS no funciona
// sin WebGL; mejor degradar a Google que dejar al user con mapa vacío.
const hasWebGL = (() => {
    if (typeof window === 'undefined') return true; // SSR optimista
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (
            canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
        ));
    } catch {
        return false;
    }
})();

const useMapbox = FLAG === 'mapbox' && hasWebGL;

const MapSkeleton = ({ className }) => (
    <div
        className={`bg-[#0a101f] flex items-center justify-center ${className || 'w-full h-full'}`}
        aria-label="Cargando mapa"
    >
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
);

const InteractiveMap = (props) => {
    // Remontar el motor cuando cambia o termina el viaje elimina cualquier
    // DirectionsRenderer/polyline que el SDK anterior haya dejado en el mapa.
    const mapInstanceKey = `${useMapbox ? 'mapbox' : 'google'}:${props.activeRideId || 'idle'}:${props.navStep || 0}`;

    // En el panel del conductor, `origin` es la ubicación GPS viva del propio
    // vehículo. La lógica interna de Google permite pausar el seguimiento al
    // detectar gestos/cambios de cámara; en algunos teléfonos también confundía
    // actualizaciones programáticas de heading/tilt con gestos y dejaba la cámara
    // fija. Al pasar la posición viva además como `center`, cada lectura GPS hace
    // pan de la cámara al vehículo, sin afectar los mapas del pasajero.
    const mapProps = props.isDriver && props.origin
        ? { ...props, center: props.origin }
        : props;

    return (
        <Suspense fallback={<MapSkeleton className={props.className} />}>
            {useMapbox
                ? <InteractiveMapMapbox key={mapInstanceKey} {...mapProps} />
                : <InteractiveMapGoogle key={mapInstanceKey} {...mapProps} />}
        </Suspense>
    );
};

export default InteractiveMap;
