const readBoolean = (value, fallback = false) => {
    if (value == null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
};

export const FEATURES = Object.freeze({
    shop: readBoolean(import.meta.env.VITE_SHOP_ENABLED, false),
    serverSideRidePricing: readBoolean(import.meta.env.VITE_SERVER_SIDE_RIDE_PRICING, false),
    serverSideRideState: readBoolean(import.meta.env.VITE_SERVER_SIDE_RIDE_STATE, false),
    unifiedMembershipCheckout: readBoolean(import.meta.env.VITE_UNIFIED_MEMBERSHIP_CHECKOUT, false),
    directedRideOffers: readBoolean(import.meta.env.VITE_DIRECTED_RIDE_OFFERS, false),
    adminMfa: readBoolean(import.meta.env.VITE_ADMIN_MFA_UI, true),
});

export const featureEnabled = (name) => Boolean(FEATURES[name]);

export { readBoolean };
