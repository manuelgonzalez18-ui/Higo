from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one match, found {count}\n"
            f"--- needle ---\n{old}"
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{path}: start marker not found: {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{path}: end marker not found: {end_marker!r}")
    if text.find(start_marker, start + 1) >= 0:
        raise SystemExit(f"{path}: start marker is not unique: {start_marker!r}")
    file_path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


# ---------------------------------------------------------------------------
# Google Maps: send every stop as an ordered waypoint, total every leg and show
# numbered stop markers. optimizeWaypoints=false preserves the passenger order.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    "import { resolveVehicleMarkerRotation } from '../utils/vehicleMarkerRotation';\n",
    "import { resolveVehicleMarkerRotation } from '../utils/vehicleMarkerRotation';\n"
    "import { buildGoogleWaypoints, normalizeRideStops, routeStopsSignature, sumGoogleRouteLegs } from '../utils/rideRouteStops';\n",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    "const Directions = ({ origin, destination, onRouteData, routeColor }) => {\n",
    "const Directions = ({ origin, destination, stops = [], onRouteData, routeColor }) => {\n",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    """    const [routes, setRoutes] = useState([]);

    useEffect(() => {
""",
    """    const [routes, setRoutes] = useState([]);
    const normalizedStops = normalizeRideStops(stops);
    const stopsSignature = routeStopsSignature(normalizedStops);

    useEffect(() => {
""",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
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
            waypoints: buildGoogleWaypoints(normalizedStops),
            optimizeWaypoints: false,
            travelMode: 'DRIVING',
            provideRouteAlternatives: false,
        }).then(response => {
""",
)

replace_between(
    "src/components/InteractiveMapGoogle.jsx",
    "            // Extract ETA data from the first leg\n",
    "        }).catch(e => console.error(\"Directions request failed\", e));",
    r'''            // A route with waypoints contains one leg per segment. The fare,
            // ETA and navigation must use the complete origin → stops → destination
            // path rather than only routes[0].legs[0].
            const route = response.routes[0];
            const summary = sumGoogleRouteLegs(route);
            const overviewPath = route?.overview_path || [];

            if (route && onRouteData) {
                const firstStep = summary.steps[0]?.step;
                let nextHeading = 0;
                if (firstStep) {
                    const s = firstStep.start_location;
                    const e = firstStep.end_location;
                    nextHeading = Math.atan2(e.lng() - s.lng(), e.lat() - s.lat()) * 180 / Math.PI;
                }

                // Steps completas para turn-by-turn voice nav. Google
                // devuelve `instructions` con HTML (ej: "Turn <b>right</b>");
                // limpiamos para que TTS pronuncie texto plano.
                const stripHtml = (html) => {
                    if (!html) return '';
                    return html
                        .replace(/<div[^>]*>/gi, '. ')
                        .replace(/<\/div>/gi, '')
                        .replace(/<br\s*\/?>/gi, '. ')
                        .replace(/<[^>]+>/g, '')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/\s+/g, ' ')
                        .trim();
                };

                const stepsForNav = summary.steps.map(({ step, legIndex }) => ({
                    instruction: stripHtml(step.instructions),
                    htmlInstruction: step.instructions,
                    distance: step.distance,
                    duration: step.duration,
                    maneuver: step.maneuver,
                    legIndex,
                    start_location: { lat: step.start_location.lat(), lng: step.start_location.lng() },
                    end_location: { lat: step.end_location.lat(), lng: step.end_location.lng() },
                }));

                onRouteData({
                    duration: summary.duration,
                    distance: summary.distance,
                    end_location: summary.endLocation,
                    start_location: summary.startLocation,
                    overviewPath: overviewPath.map((point) => ({ lat: point.lat(), lng: point.lng() })),
                    steps: stepsForNav,
                    legCount: summary.legCount,
                    next_step: firstStep ? {
                        instruction: firstStep.instructions,
                        distance: firstStep.distance,
                        heading: nextHeading,
                    } : null,
                });
            }
''',
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    "    }, [directionsService, directionsRenderer, origin, destination]);\n",
    "    }, [directionsService, directionsRenderer, origin?.lat, origin?.lng, destination?.lat, destination?.lng, stopsSignature, onRouteData]);\n",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    """    selectedRide, onRideSelect, showPin, markersProp, center, origin, heading,
    destination, assignedDriver, destinationIconType, onRouteData, className,
""",
    """    selectedRide, onRideSelect, showPin, markersProp, center, origin, heading,
    destination, stops = [], assignedDriver, destinationIconType, onRouteData, className,
""",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    """            {/* Destination Marker */}
            {destination && !showPin && isValidCoordinate(destination) && (
""",
    """            {/* Ordered stop markers */}
            {normalizeRideStops(stops).map((stop, index) => (
                <AdvancedMarker key={stop.id || `${stop.lat}:${stop.lng}`} position={{ lat: stop.lat, lng: stop.lng }} zIndex={80}>
                    <div className="w-9 h-9 rounded-full bg-amber-500 text-[#111827] border-2 border-white shadow-xl flex items-center justify-center font-black text-sm">
                        {index + 1}
                    </div>
                </AdvancedMarker>
            ))}

            {/* Destination Marker */}
            {destination && !showPin && isValidCoordinate(destination) && (
""",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    """                    origin={origin}
                    destination={destination}
                    onRouteData={setRouteInfo}
""",
    """                    origin={origin}
                    destination={destination}
                    stops={stops}
                    onRouteData={setRouteInfo}
""",
)


# ---------------------------------------------------------------------------
# Mapbox: request one ordered coordinate chain, include stops in viewport and
# display numbered markers. The directions service also handles the fallback.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    "import { reportError } from '../utils/reportError';\n",
    "import { reportError } from '../utils/reportError';\n"
    "import { normalizeRideStops, routeStopsSignature } from '../utils/rideRouteStops';\n",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """    } else if (kind === 'driver' || kind === 'fleet') {
        // Pin de chofer: círculo con icono de vehículo.
""",
    """    } else if (kind === 'stop') {
        const dot = document.createElement('div');
        dot.textContent = String((opts.index ?? 0) + 1);
        dot.style.cssText = `
            width:34px;height:34px;border-radius:9999px;
            background:#f59e0b;color:#111827;border:3px solid #fff;
            box-shadow:0 4px 12px rgba(0,0,0,0.45);
            display:flex;align-items:center;justify-content:center;
            font-weight:900;font-size:14px;
        `;
        wrap.appendChild(dot);
    } else if (kind === 'driver' || kind === 'fleet') {
        // Pin de chofer: círculo con icono de vehículo.
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """    origin,
    destination,
    assignedDriver,
""",
    """    origin,
    destination,
    stops = [],
    assignedDriver,
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """    const originMarkerRef = useRef(null);
    const destinationMarkerRef = useRef(null);
    const driverMarkerRef = useRef(null);
""",
    """    const originMarkerRef = useRef(null);
    const destinationMarkerRef = useRef(null);
    const stopMarkersRef = useRef([]);
    const driverMarkerRef = useRef(null);
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """    const onRouteDataRef = useRef(onRouteData);

    // Mantener el callback fresco sin re-crear el effect del mapa.
""",
    """    const onRouteDataRef = useRef(onRouteData);
    const normalizedStops = normalizeRideStops(stops);
    const stopsSignature = routeStopsSignature(normalizedStops);

    // Mantener el callback fresco sin re-crear el effect del mapa.
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """            originMarkerRef.current = null;
            destinationMarkerRef.current = null;
            driverMarkerRef.current = null;
""",
    """            originMarkerRef.current = null;
            destinationMarkerRef.current = null;
            stopMarkersRef.current.forEach((marker) => marker.remove());
            stopMarkersRef.current = [];
            driverMarkerRef.current = null;
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """    // ─── 4. Sync assignedDriver marker (el chofer asignado al ride) ─
    useEffect(() => {
""",
    """    // ─── 4. Sync ordered stop markers ────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        stopMarkersRef.current.forEach((marker) => marker.remove());
        stopMarkersRef.current = [];
        if (!map) return;

        normalizedStops.forEach((stop, index) => {
            const marker = new mapboxgl.Marker({
                element: createMarkerElement('stop', { index }),
                anchor: 'center',
            })
                .setLngLat([stop.lng, stop.lat])
                .addTo(map);
            stopMarkersRef.current.push(marker);
        });
    }, [stopsSignature]);

    // ─── 5. Sync assignedDriver marker (el chofer asignado al ride) ─
    useEffect(() => {
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    """            const bounds = new mapboxgl.LngLatBounds()
                .extend([origin.lng, origin.lat])
                .extend([destination.lng, destination.lat]);
            map.fitBounds(bounds, { padding: 80, duration: 700, maxZoom: 15 });
""",
    """            const bounds = new mapboxgl.LngLatBounds()
                .extend([origin.lng, origin.lat]);
            normalizedStops.forEach((stop) => bounds.extend([stop.lng, stop.lat]));
            bounds.extend([destination.lng, destination.lat]);
            map.fitBounds(bounds, { padding: 80, duration: 700, maxZoom: 15 });
""",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);\n\n    // ─── 7. Calcular y dibujar la ruta",
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, stopsSignature]);\n\n    // ─── 8. Calcular y dibujar la ruta",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    "            const data = await getRoute(origin, destination);\n",
    "            const data = await getRoute(origin, destination, 'driving-traffic', normalizedStops);\n",
)

replace_once(
    "src/components/InteractiveMapMapbox.jsx",
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, routeColor]);\n\n    // ─── 8. Sync flota",
    "    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, stopsSignature, routeColor]);\n\n    // ─── 9. Sync flota",
)


# ---------------------------------------------------------------------------
# Mapbox directions + Haversine fallback: route through every stop and calculate
# the complete trip, including an out-and-back final destination.
# ---------------------------------------------------------------------------
replace_once(
    "src/services/directionsService.js",
    "import { reportError } from '../utils/reportError';\n",
    "import { reportError } from '../utils/reportError';\n"
    "import { buildOrderedRideRoute, routeDistanceBySegmentsKm } from '../utils/rideRouteStops';\n",
)

replace_between(
    "src/services/directionsService.js",
    "const haversineFallback = (origin, destination) => {\n",
    "/**\n * Obtener ruta entre dos puntos lat/lng.",
    r'''const haversineFallback = (origin, destination, stops = []) => {
    const points = buildOrderedRideRoute({ origin, destination, stops });
    if (points.length < 2) {
        return {
            distance: { value: 0, text: '0 m' },
            duration: { value: 0, text: '0 min' },
            polyline: points.map((point) => [point.lng, point.lat]),
            degraded: true,
        };
    }

    const km = routeDistanceBySegmentsKm(points, (left, right) => (
        getDistanceFromLatLonInKm(left.lat, left.lng, right.lat, right.lng)
    ));
    const meters = km * 1000;
    // Estimación de duración: 30 km/h urbano. En fallback se suma cada
    // tramo para no cobrar ni dibujar un atajo directo que ignore las paradas.
    const seconds = (km / 30) * 3600;
    return {
        distance: { value: meters, text: fmtKm(meters) },
        duration: { value: seconds, text: fmtMin(seconds) },
        polyline: points.map((point) => [point.lng, point.lat]),
        degraded: true,
    };
};

''',
)

replace_once(
    "src/services/directionsService.js",
    """ * @param {string} [profile]  'driving-traffic' | 'driving' | 'walking' | 'cycling'
 * @returns {Promise<{distance, duration, polyline, degraded?}>}
 */
export const getRoute = async (origin, destination, profile = 'driving-traffic') => {
    if (!origin?.lat || !destination?.lat) {
        return haversineFallback(origin || {}, destination || {});
    }
""",
    """ * @param {string} [profile]  'driving-traffic' | 'driving' | 'walking' | 'cycling'
 * @param {Array} [stops] ordered intermediate stops
 * @returns {Promise<{distance, duration, polyline, degraded?}>}
 */
export const getRoute = async (origin, destination, profile = 'driving-traffic', stops = []) => {
    const routePoints = buildOrderedRideRoute({ origin, destination, stops });
    if (routePoints.length < 2) {
        return haversineFallback(origin || {}, destination || {}, stops);
    }
""",
)

replace_once(
    "src/services/directionsService.js",
    "        return haversineFallback(origin, destination);\n",
    "        return haversineFallback(origin, destination, stops);\n",
)

replace_once(
    "src/services/directionsService.js",
    """    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/`
        + `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
        + `?geometries=geojson&overview=full&language=es&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
""",
    """    const coordinates = routePoints.map((point) => `${point.lng},${point.lat}`).join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/`
        + coordinates
        + `?geometries=geojson&overview=full&language=es&steps=true&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
""",
)

replace_once(
    "src/services/directionsService.js",
    "            origin, destination, profile,\n",
    "            origin, destination, stops, profile,\n",
)

# The remaining catch fallback is the second occurrence after the token branch.
replace_once(
    "src/services/directionsService.js",
    "        return haversineFallback(origin, destination);\n",
    "        return haversineFallback(origin, destination, stops);\n",
)


# ---------------------------------------------------------------------------
# Passenger request/confirmation screens: use an explicit `stops` contract so
# driver/fleet markers can never be mistaken for route waypoints.
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/RequestRidePage.jsx",
    """        const newStops = stops.filter(s => s.id !== id);
        setStops(newStops);
        // Force recalc price
""",
    """        const newStops = stops.filter(s => s.id !== id);
        setStops(newStops);
        setRoadDistance(0);
        setRouteDurationMin(0);
        // Force recalc price
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """        setStops(newStops);
    };

    // Vehicle Rates: viven en DB",
    """        setStops(newStops);
        if (place?.lat && place?.lng) {
            setRoadDistance(0);
            setRouteDurationMin(0);
        }
    };

    // Vehicle Rates: viven en DB",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """            const baseDistNoStops = roadDistance > 0 ? (roadDistance / 1000) : getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
""",
    """            const baseDistNoStops = getDistanceFromLatLonInKm(
                pickupCoords.lat,
                pickupCoords.lng,
                dropoffCoords.lat,
                dropoffCoords.lng,
            );
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    "                    markersProp={stops}\n",
    "                    stops={stops}\n",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    "<InteractiveMap className=\"w-full h-full\" center={pickupCoords} origin={pickupCoords} destination={dropoffCoords} markersProp={stops} />",
    "<InteractiveMap className=\"w-full h-full\" center={pickupCoords} origin={pickupCoords} destination={dropoffCoords} stops={stops} />",
)


# ---------------------------------------------------------------------------
# Android release: this behavior lives in the installed web bundle, therefore a
# new versionCode is required for Play Console and device testing.
# ---------------------------------------------------------------------------
replace_once(
    "android/app/build.gradle",
    "        versionCode 50\n        versionName \"1.5.18\"\n",
    "        versionCode 51\n        versionName \"1.5.19\"\n",
)

replace_once(
    "tests/driverGhostOfferRegression.test.mjs",
    """    assert.match(gradle, /versionCode 50/);
    assert.match(gradle, /versionName \"1\\.5\\.18\"/);
""",
    """    assert.match(gradle, /versionCode 51/);
    assert.match(gradle, /versionName \"1\\.5\\.19\"/);
""",
)

replace_once(
    "tests/passengerRideVoice.test.mjs",
    """    assert.match(gradle, /versionCode 50/);
    assert.match(gradle, /versionName \"1\\.5\\.18\"/);
""",
    """    assert.match(gradle, /versionCode 51/);
    assert.match(gradle, /versionName \"1\\.5\\.19\"/);
""",
)


# Add permanent source-contract coverage only after the integration is applied,
# so the normal PR Quality Gate can evaluate the staging branch first.
test_path = Path("tests/rideRouteStops.test.mjs")
test_source = test_path.read_text(encoding="utf-8")
contract_test = r'''

import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('map implementations consume explicit stop waypoints', async () => {
    const [googleMap, mapboxMap, directions, requestPage, confirmPage, gradle] = await Promise.all([
        readSource('src/components/InteractiveMapGoogle.jsx'),
        readSource('src/components/InteractiveMapMapbox.jsx'),
        readSource('src/services/directionsService.js'),
        readSource('src/pages/RequestRidePage.jsx'),
        readSource('src/pages/ConfirmTripPage.jsx'),
        readSource('android/app/build.gradle'),
    ]);

    assert.match(googleMap, /waypoints: buildGoogleWaypoints\(normalizedStops\)/);
    assert.match(googleMap, /optimizeWaypoints: false/);
    assert.match(googleMap, /sumGoogleRouteLegs\(route\)/);
    assert.match(googleMap, /stops=\{stops\}/);
    assert.match(mapboxMap, /getRoute\(origin, destination, 'driving-traffic', normalizedStops\)/);
    assert.match(mapboxMap, /normalizedStops\.forEach/);
    assert.match(directions, /buildOrderedRideRoute/);
    assert.match(requestPage, /stops=\{stops\}/);
    assert.match(confirmPage, /stops=\{stops\}/);
    assert.match(gradle, /versionCode 51/);
    assert.match(gradle, /versionName "1\.5\.19"/);
});
'''
if "map implementations consume explicit stop waypoints" not in test_source:
    test_path.write_text(test_source + contract_test, encoding="utf-8")


# Advance the signed Android workflow and preserve all previous release checks.
old_workflow = Path(".github/workflows/build-higo-1.5.18-aab.yml")
new_workflow = Path(".github/workflows/build-higo-1.5.19-aab.yml")
workflow = old_workflow.read_text(encoding="utf-8")
workflow = workflow.replace("Build Higo 1.5.18 AAB", "Build Higo 1.5.19 AAB")
workflow = workflow.replace("versionCode 50", "versionCode 51")
workflow = workflow.replace('versionName "1.5.18"', 'versionName "1.5.19"')
workflow = workflow.replace("Higo 1.5.18 (50)", "Higo 1.5.19 (51)")
workflow = workflow.replace("higo-1.5.18-50", "higo-1.5.19-51")
workflow = workflow.replace(
    """      - src/pages/ConfirmTripPage.jsx
      - src/pages/RideStatusPage.jsx
      - src/utils/passengerRideVoice.js
      - tests/passengerRideVoice.test.mjs
      - android/app/build.gradle
""",
    """      - src/pages/ConfirmTripPage.jsx
      - src/pages/RequestRidePage.jsx
      - src/pages/RideStatusPage.jsx
      - src/components/InteractiveMapGoogle.jsx
      - src/components/InteractiveMapMapbox.jsx
      - src/services/directionsService.js
      - src/utils/passengerRideVoice.js
      - src/utils/rideRouteStops.js
      - tests/passengerRideVoice.test.mjs
      - tests/rideRouteStops.test.mjs
      - android/app/build.gradle
""",
)
workflow = workflow.replace(
    """      - name: Run passenger voice regression
        run: node --test tests/passengerRideVoice.test.mjs
""",
    """      - name: Run passenger voice and route-stop regressions
        run: node --test tests/passengerRideVoice.test.mjs tests/rideRouteStops.test.mjs
""",
)
if workflow == old_workflow.read_text(encoding="utf-8"):
    raise SystemExit("Android build workflow was not advanced")
new_workflow.write_text(workflow, encoding="utf-8")
old_workflow.unlink()
