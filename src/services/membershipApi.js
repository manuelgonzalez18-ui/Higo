import { supabase } from './supabase';
import { trackEventLater } from './analytics';
import { FEATURES } from '../config/features';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const listDriverCheckoutPlans = async () => {
    // Rollout safety: when the flag is disabled, callers must keep using the
    // legacy membership_plans table. Returning an empty list lets Higo Pay use
    // its existing fallback without touching RPCs or columns that may not have
    // been migrated in the current environment yet.
    if (!FEATURES.unifiedMembershipCheckout) return [];

    const plans = unwrap(await supabase.rpc('driver_membership_checkout')) || [];
    trackEventLater('membership.checkout_viewed', {
        entityType: 'membership_checkout',
        properties: {
            plan_count: plans.length,
            periods: [...new Set(plans.map((plan) => plan.period).filter(Boolean))],
        },
    });
    return plans;
};

export const getPreferredDriverPlan = (plans, period = 'monthly') => {
    if (!Array.isArray(plans) || plans.length === 0) return null;
    return plans.find((plan) => plan.period === period) || plans[0];
};
