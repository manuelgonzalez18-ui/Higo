import { supabase } from './supabase';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const getAdminContext = async () => unwrap(await supabase.rpc('admin_get_context'));
export const getAdminDashboardMetrics = async () => unwrap(await supabase.rpc('admin_dashboard_metrics'));
export const getAdminAnalytics = async (days = 30) => unwrap(await supabase.rpc('admin_business_analytics', { p_days: days }));

export const listMembershipPlans = async () => unwrap(await supabase
    .from('driver_membership_plans')
    .select('*')
    .eq('active', true)
    .order('vehicle_type')
    .order('duration_days'));

export const listDrivers = async ({ query = '', state = 'all', limit = 50, offset = 0 } = {}) =>
    unwrap(await supabase.rpc('admin_list_drivers', {
        p_query: query || null,
        p_state: state,
        p_limit: limit,
        p_offset: offset,
    }));

export const recordMembership = async ({ driverId, planId, paymentMethod, paymentReference, notes, amount }) =>
    unwrap(await supabase.rpc('admin_record_driver_membership', {
        p_driver_id: driverId,
        p_plan_id: planId,
        p_payment_method: paymentMethod,
        p_payment_reference: paymentReference || null,
        p_notes: notes || null,
        p_amount: amount === '' || amount == null ? null : Number(amount),
    }));

export const voidMembership = async (membershipId, reason) =>
    unwrap(await supabase.rpc('admin_void_driver_membership', {
        p_membership_id: membershipId,
        p_reason: reason,
    }));

export const setDriverException = async ({ driverId, action, reason, until = null }) =>
    unwrap(await supabase.rpc('admin_set_driver_exception', {
        p_driver_id: driverId,
        p_action: action,
        p_reason: reason,
        p_until: until,
    }));

export const archiveDriver = async (driverId, reason) =>
    unwrap(await supabase.rpc('admin_archive_driver', {
        p_driver_id: driverId,
        p_reason: reason,
    }));

export const listAdminStaff = async () => unwrap(await supabase.rpc('admin_list_staff'));
export const updateAdminStaffRole = async ({ userId, staffRole, active }) =>
    unwrap(await supabase.rpc('admin_update_staff_role', {
        p_user_id: userId,
        p_staff_role: staffRole,
        p_active: active,
    }));

export const setAdminSecuritySettings = async ({ requireMfa, sessionMinutes }) =>
    unwrap(await supabase.rpc('admin_set_security_settings', {
        p_require_mfa: requireMfa,
        p_session_minutes: sessionMinutes,
    }));

export const changeProfileRole = async (userId, role) =>
    unwrap(await supabase.rpc('admin_change_profile_role', {
        p_user_id: userId,
        p_role: role,
    }));

export const listAuditLog = async (limit = 100) => unwrap(await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit));
