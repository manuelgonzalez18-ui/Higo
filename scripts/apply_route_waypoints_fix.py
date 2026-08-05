from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}\n--- needle ---\n{old}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Google Maps: include intermediate stops as Directions API waypoints and
# aggregate all legs so distance, duration, ETA and pricing use the full route.
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    "import { resolveVehicleMarkerRotation } from '../utils/vehicleMarkerRotation';\n",
    "import { resolveVehicleMarkerRotation } from '../utils/vehicleMarkerRotation';\nimport { normalizeRouteWaypoints } from '../utils/routeWaypoints';\n",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    "const Directions = ({ origin, destination, onRouteData, routeColor }) => {",
    "const Directions = ({ origin, destination, waypoints = [], onRouteData, routeColor }) => {",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    """        directionsService.route({
            origin: origin,
            destination: destination,
            travelMode: 'DRIVING',
            provideRouteAlternatives: false
        }).then(response => {
""",
    """        directionsService.route({
            origin,
            destination,
            waypoints: normalizeRouteWaypoints(waypoints).map((stop) => ({
                location: { lat: stop.lat, lng: stop.lng },
                stopover: true,
            })),
            optimizeWaypoints: false,
            travelMode: 'DRIVING',
            provideRouteAlternatives: false
        }).then(response => {
""",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    """            // Extract ETA data from the first leg
            const leg = response.routes[0]?.legs[0];
            const overviewPath = response.routes[0]?.overview_path || [];

            if (leg && onRouteData) {
                const nextStep = leg.steps?.[0];
""",
    """            const legs = response.routes[0]?.legs || [];
            const firstLeg = legs[0];
            const overviewPath = response.routes[0]?.overview_path || [];

            if (firstLeg && onRouteData) {
                const nextStep = firstLeg.steps?.[0];
""",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    """                const stepsForNav = (leg.steps || []).map(step => ({
                    instruction:     stripHtml(step.instructions),
                    htmlInstruction: step.instructions,
                    distance:        step.distance,
                    duration:        step.duration,
                    maneuver:        step.maneuver,
                    start_location:  { lat: step.start_location.lat(), lng: step.start_location.lng() },
                    end_location:    { lat: step.end_location.lat(),   lng: step.end_location.lng() },
                }));

                onRouteData({
                    duration: leg.duration,
                    distance: leg.distance,
                    end_location: leg.end_location,
                    start_location: leg.start_location,
""",
    """                const stepsForNav = legs.flatMap((leg, legIndex) => (leg.steps || []).map(step => ({
                    instruction:     stripHtml(step.instructions),
                    htmlInstruction: step.instructions,
                    distance:        step.distance,
                    duration:        step.duration,
                    maneuver:        step.maneuver,
                    legIndex,
                    start_location:  { lat: step.start_location.lat(), lng: step.start_location.lng() },
                    end_location:    { lat: step.end_location.lat(),   lng: step.end_location.lng() },
                })));
                const totalDistance = legs.reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0);
                const totalDuration = legs.reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0);
                const finalLeg = legs[legs.length - 1];

                onRouteData({
                    duration: { value: totalDuration, text: `${Math.max(1, Math.round(totalDuration / 60))} min` },
                    distance: { value: totalDistance, text: `${(totalDistance / 1000).toFixed(1)} km` },
                    end_location: finalLeg.end_location,
                    start_location: firstLeg.start_location,
""",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    "    }, [directionsService, directionsRenderer, origin, destination]);",
    "    }, [directionsService, directionsRenderer, origin, destination, waypoints, onRouteData, routeColor]);",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    """                <Directions
                    origin={origin}
                    destination={destination}
                    onRouteData={setRouteInfo}
                    routeColor={routeColor}
                />
""",
    """                <Directions
                    origin={origin}
                    destination={destination}
                    waypoints={markersProp}
                    onRouteData={setRouteInfo}
                    routeColor={routeColor}
                />
""",
)
replace_once(
    'src/components/InteractiveMapGoogle.jsx',
    """            {/* Destination Marker */}
            {destination && !showPin && isValidCoordinate(destination) && (
""",
    """            {/* Intermediate stop markers */}
            {normalizeRouteWaypoints(markersProp).map((stop, index) => (
                <AdvancedMarker key={stop.id} position={{ lat: stop.lat, lng: stop.lng }} zIndex={45}>
                    <div className=\"w-9 h-9 rounded-full bg-amber-500 text-black border-2 border-white shadow-xl flex items-center justify-center font-black text-sm\" title={stop.address}>
                        {index + 1}
                    </div>
                </AdvancedMarker>
            ))}

            {/* Destination Marker */}
            {destination && !showPin && isValidCoordinate(destination) && (
""",
)

# Mapbox route service: accept ordered intermediate coordinates and preserve
# their order. Fallback distance also sums every segment.
replace_once(
    'src/services/directionsService.js',
    "import { reportError } from '../utils/reportError';\n",
    "import { reportError } from '../utils/reportError';\nimport { normalizeRouteWaypoints, routePoints } from '../utils/routeWaypoints';\n",
)
replace_once(
    'src/services/directionsService.js',
    "const haversineFallback = (origin, destination) => {\n    const km = getDistanceFromLatLonInKm(origin.lat, origin.lng, destination.lat, destination.lng);",
    "const haversineFallback = (origin, destination, waypoints = []) => {\n    const points = routePoints(origin, destination, waypoints);\n    const km = points.slice(0, -1).reduce((sum, point, index) => sum + getDistanceFromLatLonInKm(point.lat, point.lng, points[index + 1].lat, points[index + 1].lng), 0);",
)
replace_once(
    'src/services/directionsService.js',
    "        polyline: [[origin.lng, origin.lat], [destination.lng, destination.lat]],",
    "        polyline: points.map((point) => [point.lng, point.lat]),",
)
replace_once(
    'src/services/directionsService.js',
    "export const getRoute = async (origin, destination, profile = 'driving-traffic') => {",
    "export const getRoute = async (origin, destination, profile = 'driving-traffic', waypoints = []) => {",
)
replace_once(
    'src/services/directionsService.js',
    "        return haversineFallback(origin || {}, destination || {});",
    "        return haversineFallback(origin || {}, destination || {}, waypoints);",
)
replace_once(
    'src/services/directionsService.js',
    "        return haversineFallback(origin, destination);",
    "        return haversineFallback(origin, destination, waypoints);",
)
replace_once(
    'src/services/directionsService.js',
    """    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/`
        + `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
""",
    """    const coordinates = routePoints(origin, destination, normalizeRouteWaypoints(waypoints))
        .map((point) => `${point.lng},${point.lat}`)
        .join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/`
        + coordinates
""",
)
replace_once(
    'src/services/directionsService.js',
    "        return haversineFallback(origin, destination);\n    }\n};",
    "        return haversineFallback(origin, destination, waypoints);\n    }\n};",
)

# Mapbox renderer: pass waypoints, fit them all, and show numbered stops.
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    "import { reportError } from '../utils/reportError';\n",
    "import { reportError } from '../utils/reportError';\nimport { normalizeRouteWaypoints } from '../utils/routeWaypoints';\n",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    "    const fleetMarkersRef = useRef({}); // driverId → marker\n",
    "    const fleetMarkersRef = useRef({}); // driverId → marker\n    const stopMarkersRef = useRef([]);\n",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    """            fleetMarkersRef.current = {};
        };
""",
    """            fleetMarkersRef.current = {};
            stopMarkersRef.current.forEach((marker) => marker.remove());
            stopMarkersRef.current = [];
        };
""",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    """            const bounds = new mapboxgl.LngLatBounds()
                .extend([origin.lng, origin.lat])
                .extend([destination.lng, destination.lat]);
""",
    """            const bounds = new mapboxgl.LngLatBounds().extend([origin.lng, origin.lat]);
            normalizeRouteWaypoints(markersProp).forEach((stop) => bounds.extend([stop.lng, stop.lat]));
            bounds.extend([destination.lng, destination.lat]);
""",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);",
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, markersProp]);",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    "            const data = await getRoute(origin, destination);",
    "            const data = await getRoute(origin, destination, 'driving-traffic', markersProp);",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, routeColor]);",
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, routeColor, markersProp]);",
)
replace_once(
    'src/components/InteractiveMapMapbox.jsx',
    "    // ─── 8. Sync flota de drivers (markersProp / markers) ──────────\n",
    """    // ─── 8. Sync numbered intermediate stops ──────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        stopMarkersRef.current.forEach((marker) => marker.remove());
        stopMarkersRef.current = normalizeRouteWaypoints(markersProp).map((stop, index) => {
            const element = document.createElement('div');
            element.textContent = String(index + 1);
            element.title = stop.address;
            element.style.cssText = 'width:30px;height:30px;border-radius:9999px;background:#f59e0b;color:#111827;border:2px solid white;display:flex;align-items:center;justify-content:center;font-weight:900;box-shadow:0 5px 14px rgba(0,0,0,.45)';
            return new mapboxgl.Marker({ element, anchor: 'center' })
                .setLngLat([stop.lng, stop.lat])
                .addTo(map);
        });
        return () => {
            stopMarkersRef.current.forEach((marker) => marker.remove());
            stopMarkersRef.current = [];
        };
    }, [markersProp]);

    // ─── 9. Sync flota de drivers (markersProp / markers) ──────────
""",
)

# Release version for installed Android app.
replace_once(
    'android/app/build.gradle',
    '        versionCode 50\n        versionName "1.5.18"\n',
    '        versionCode 51\n        versionName "1.5.19"\n',
)
