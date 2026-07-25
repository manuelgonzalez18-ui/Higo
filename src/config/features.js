import { readBoolean } from './parseBooleanFlag';

export const FEATURES = Object.freeze({
    shop: readBoolean(import.meta.env.VITE_SHOP_ENABLED, false),
    serverSideRidePricing: readBoolean(import.meta.env.VITE_SERVER_SIDE_RIDE_PRICING, false),
    serverSideRideState: readBoolean(import.meta.env.VITE_SERVER_SIDE_RIDE_STATE, false),
    // Production already has the unified membership schema. Keep this enabled by
    // default so web and Android always load weekly/monthly checkout plans even
    // when a deployment omits the build-time variable. Higo Pay still catches
    // RPC failures and falls back to the legacy single-plan catalog safely.
    unifiedMembershipCheckout: readBoolean(import.meta.env.VITE_UNIFIED_MEMBERSHIP_CHECKOUT, true),
    directedRideOffers: readBoolean(import.meta.env.VITE_DIRECTED_RIDE_OFFERS, false),
    adminMfa: readBoolean(import.meta.env.VITE_ADMIN_MFA_UI, true),
});

export const featureEnabled = (name) => Boolean(FEATURES[name]);

export { readBoolean };
