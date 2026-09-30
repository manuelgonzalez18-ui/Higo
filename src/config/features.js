import { readBoolean } from './parseBooleanFlag';

export const FEATURES = Object.freeze({
    shop: readBoolean(import.meta.env.VITE_SHOP_ENABLED, false),
    // Vite injects the same mandatory business contract for web and Android.
    serverSideRidePricing: readBoolean(import.meta.env.VITE_SERVER_SIDE_RIDE_PRICING, true),
    serverSideRideState: readBoolean(import.meta.env.VITE_SERVER_SIDE_RIDE_STATE, true),
    unifiedMembershipCheckout: readBoolean(import.meta.env.VITE_UNIFIED_MEMBERSHIP_CHECKOUT, true),
    directedRideOffers: readBoolean(import.meta.env.VITE_DIRECTED_RIDE_OFFERS, false),
    adminMfa: readBoolean(import.meta.env.VITE_ADMIN_MFA_UI, true),
});

export const featureEnabled = (name) => Boolean(FEATURES[name]);

export { readBoolean };
