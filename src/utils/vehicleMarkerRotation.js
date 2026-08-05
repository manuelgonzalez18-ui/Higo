const normalizeHeading = (heading) => {
    const numeric = Number(heading);
    if (!Number.isFinite(numeric)) return 0;
    return (numeric + 360) % 360;
};

/**
 * The current motorcycle PNG is a side-profile illustration, not a top-down
 * directional asset. Rotating it with the GPS bearing makes it appear fallen
 * over. Cars and vans keep the historical -90° asset correction.
 */
export const resolveVehicleMarkerRotation = ({ heading = 0, type = 'standard' } = {}) => {
    const normalizedType = String(type || 'standard').trim().toLowerCase();
    if (['moto', 'motorcycle', 'motorbike'].includes(normalizedType)) return 0;
    return normalizeHeading(heading) - 90;
};
