import { supabase } from './supabase';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const listDriverCheckoutPlans = async () => unwrap(
    await supabase.rpc('driver_membership_checkout')
);

export const getPreferredDriverPlan = (plans, period = 'monthly') => {
    if (!Array.isArray(plans) || plans.length === 0) return null;
    return plans.find((plan) => plan.period === period) || plans[0];
};
