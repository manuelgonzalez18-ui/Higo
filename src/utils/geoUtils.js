
// Convert degrees to radians
export const toRad = (value) => {
    return value * Math.PI / 180;
};

// Convert radians to degrees
export const toDeg = (value) => {
    return value * 180 / Math.PI;
};

// Calculate Bearing (Heading) between two points
// Returns degrees 0-360
export const calculateBearing = (lat1, lon1, lat2, lon2) => {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

    let brng = toDeg(Math.atan2(y, x));

    // Normalize to 0-360
    return (brng + 360) % 360;
};

// Calculate Distance in KM (Haversine Formula)
export const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the earth in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
};
