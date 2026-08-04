const numberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const positiveOrNull = (value) => {
    const parsed = numberOrNull(value);
    return parsed != null && parsed > 0 ? parsed : null;
};

const roundMultiplier = (value) => Math.round(value * 1000) / 1000;

export const resolveEffectiveRideMultiplier = ({ pricing = {}, snapshot = {} } = {}) => {
    const stored = positiveOrNull(pricing.multiplier) ?? 1;
    const snapshotted = positiveOrNull(snapshot.surgeMultiplier) ?? 1;

    const components = [
        pricing.baseAmount ?? snapshot.base,
        pricing.distanceAmount ?? snapshot.distanceAmount,
        pricing.timeAmount ?? snapshot.timeAmount,
        pricing.stopsAmount ?? snapshot.stopsAmount,
        pricing.extrasAmount ?? snapshot.extrasAmount,
    ].map(numberOrNull);

    const hasComponents = components.some((value) => value != null);
    const preMultiplier = hasComponents
        ? components.reduce((sum, value) => sum + (value ?? 0), 0)
        : 0;
    const chargedSubtotal = positiveOrNull(snapshot.chargedSubtotal ?? snapshot.subtotal);
    const minimumFare = positiveOrNull(pricing.minimumFare ?? snapshot.minimumFare) ?? 0;
    const maximumMultiplier = Math.min(
        3,
        Math.max(1, positiveOrNull(snapshot.maximumMultiplier) ?? 1.30),
    );

    let inferred = 1;
    if (
        preMultiplier > 0
        && chargedSubtotal != null
        && chargedSubtotal > preMultiplier
        && minimumFare <= preMultiplier
    ) {
        const ratio = chargedSubtotal / preMultiplier;
        if (ratio > 1.005 && ratio <= maximumMultiplier + 0.005) {
            inferred = ratio;
        }
    }

    const value = roundMultiplier(Math.max(1, stored, snapshotted, inferred));
    let source = 'stored';
    if (snapshotted >= stored && snapshotted >= inferred) source = 'snapshot';
    if (inferred > stored && inferred > snapshotted) source = 'inferred';

    let reason;
    if (value <= 1.005) {
        reason = pricing.multiplierReason || snapshot.multiplierReason || 'tarifa_normal';
    } else if (source === 'snapshot') {
        reason = snapshot.multiplierReason || pricing.multiplierReason || 'regla_zona_horario';
    } else if (source === 'stored') {
        reason = pricing.multiplierReason || snapshot.multiplierReason || 'regla_zona_horario';
    } else {
        reason = 'regla_zona_horario';
    }

    return { value, reason, source };
};
