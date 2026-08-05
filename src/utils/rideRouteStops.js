const finiteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

export const normalizeRouteCoordinate = (point) => {
    if (!point) return null;

    const source = point.coords
        ?? point.location
        ?? point.coordinate
        ?? point;

    const lat = finiteNumber(source?.lat ?? source?.latitude);
    const lng = finiteNumber(source?.lng ?? source?.lon ?? source?.longitude);

    if (lat == null || lng == null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
};

export const normalizeRideStops = (stops = []) => (
    (Array.isArray(stops) ? stops : [])
        .map((stop, index) => {
            const coordinate = normalizeRouteCoordinate(stop);
            if (!coordinate) return null;
            return {
                ...coordinate,
                id: stop?.id ?? `stop-${index + 1}`,
                address: stop?.address ?? stop?.name ?? stop?.label ?? `Parada ${index + 1}`,
                index,
            };
        })
        .filter(Boolean)
);

const sameCoordinate = (left, right) => (
    Math.abs(left.lat - right.lat) < 0.000001
    && Math.abs(left.lng - right.lng) < 0.000001
);

export const buildOrderedRideRoute = ({ origin, destination, stops = [] } = {}) => {
    const points = [
        normalizeRouteCoordinate(origin),
        ...normalizeRideStops(stops).map(({ lat, lng }) => ({ lat, lng })),
        normalizeRouteCoordinate(destination),
    ].filter(Boolean);

    return points.filter((point, index) => (
        index === 0 || !sameCoordinate(point, points[index - 1])
    ));
};

export const routeStopsSignature = (stops = []) => normalizeRideStops(stops)
    .map((stop) => `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`)
    .join(';');

export const buildGoogleWaypoints = (stops = []) => normalizeRideStops(stops).map((stop) => ({
    location: { lat: stop.lat, lng: stop.lng },
    stopover: true,
}));

const formatDistance = (meters) => (
    meters >= 1000
        ? `${(meters / 1000).toFixed(1)} km`
        : `${Math.round(meters)} m`
);

const formatDuration = (seconds) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export const sumGoogleRouteLegs = (route = {}) => {
    const legs = Array.isArray(route.legs) ? route.legs : [];
    const distanceValue = legs.reduce((total, leg) => total + Number(leg?.distance?.value || 0), 0);
    const durationValue = legs.reduce((total, leg) => total + Number(leg?.duration?.value || 0), 0);
    const steps = legs.flatMap((leg, legIndex) => (
        (leg?.steps || []).map((step) => ({ step, legIndex }))
    ));

    return {
        distance: { value: distanceValue, text: formatDistance(distanceValue) },
        duration: { value: durationValue, text: formatDuration(durationValue) },
        startLocation: legs[0]?.start_location ?? null,
        endLocation: legs.at(-1)?.end_location ?? null,
        steps,
        legCount: legs.length,
    };
};

export const routeDistanceBySegmentsKm = (points = [], distanceBetween) => {
    if (!Array.isArray(points) || points.length < 2 || typeof distanceBetween !== 'function') return 0;
    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        total += Number(distanceBetween(points[index], points[index + 1]) || 0);
    }
    return total;
};
