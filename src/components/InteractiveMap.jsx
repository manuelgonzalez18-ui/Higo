// Google is the map provider for the launch artifact.
import React, { lazy, Suspense } from 'react';

const InteractiveMapGoogle = lazy(() => import('./InteractiveMapGoogle'));
// The launch artifact ships the Google engine only.

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
    const mapInstanceKey = `google:${props.activeRideId || 'idle'}:${props.navStep || 0}`;

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
            <InteractiveMapGoogle key={mapInstanceKey} {...mapProps} />
        </Suspense>
    );
};

export default InteractiveMap;
