import { supabase } from './supabase';
import { trackEventLater } from './analytics';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const listDriverCheckoutPlans = async () => {
    // Production already has the unified membership catalog. Always ask the
    // server for the authenticated driver's compatible plans so weekly and
    // monthly options cannot disappear because of a stale build-time flag.
    // Higo Pay already catches RPC errors and uses its legacy fallback safely.
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
