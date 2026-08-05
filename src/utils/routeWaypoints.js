const toFiniteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

export const normalizeRouteWaypoints = (stops = []) => (
    (Array.isArray(stops) ? stops : [])
        .map((stop, index) => {
            const source = stop?.coords || stop?.location || stop;
            const lat = toFiniteNumber(source?.lat ?? source?.latitude);
            const lng = toFiniteNumber(source?.lng ?? source?.longitude);
            if (lat == null || lng == null) return null;
            return {
                id: stop?.id ?? `stop-${index + 1}`,
                address: stop?.address || stop?.name || stop?.label || `Parada ${index + 1}`,
                lat,
                lng,
            };
        })
        .filter(Boolean)
);

export const routePoints = (origin, destination, stops = []) => [
    origin,
    ...normalizeRouteWaypoints(stops).map(({ lat, lng }) => ({ lat, lng })),
    destination,
].filter((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)));
