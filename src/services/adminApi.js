import { supabase } from './supabase';

const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const getAdminContext = async () => unwrap(await supabase.rpc('admin_get_context'));
export const getAdminDashboardMetrics = async () => unwrap(await supabase.rpc('admin_dashboard_metrics'));
export const getAdminAnalytics = async (days = 30) => unwrap(await supabase.rpc('admin_business_analytics', { p_days: days }));
export const getAdminPlatformFunnel = async (days = 30) => unwrap(await supabase.rpc('admin_platform_funnel', { p_days: days }));

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

export const saveFundedPromo = async (id, payload) => unwrap(await supabase.rpc('admin_save_promo', {
    p_id: id || null,
    p_payload: payload,
}));

export const archivePromo = async (id, reason) => unwrap(await supabase.rpc('admin_archive_promo', {
    p_id: id,
    p_reason: reason,
}));

export const listDriverApplications = async ({ query = '', status = 'all', limit = 50, offset = 0 } = {}) =>
    unwrap(await supabase.rpc('admin_list_driver_applications', {
        p_query: query || null,
        p_status: status,
        p_limit: limit,
        p_offset: offset,
    }));

export const getDriverApplication = async (applicationCode) =>
    unwrap(await supabase.rpc('admin_get_driver_application', {
        p_application_code: applicationCode,
    }));

const adminApiEndpoint = (path) => {
    const productionHosts = ['higoapp.com', 'www.higoapp.com'];
    return productionHosts.includes(window.location.hostname)
        ? `/api/${path}`
        : `https://higoapp.com/api/${path}`;
};

const DRIVER_APPLICATION_ERRORS = {
    required_documents_not_approved: 'Debes aprobar la foto de perfil, cédula, licencia, circulación, RCV y fotografía del vehículo antes de aprobar la solicitud.',
    status_reason_required: 'Indica una observación o motivo para realizar este cambio.',
    conversion_in_progress: 'Otro proceso ya está registrando este driver. Espera unos minutos y actualiza la solicitud.',
    conversion_claim_failed: 'No se pudo reservar la solicitud para crear la cuenta. Actualiza e intenta nuevamente.',
    application_not_approved: 'La solicitud debe estar aprobada antes de registrar al driver.',
    approved_profile_photo_required: 'Debes aprobar la foto de perfil del conductor antes de registrar su cuenta.',
    profile_photo_publish_failed: 'No se pudo publicar de forma segura la foto de perfil. Revisa el archivo e intenta nuevamente.',
    auth_create_failed: 'No se pudo crear la cuenta. Comprueba si el correo ya está registrado en Higo.',
    profile_insert_failed: 'La cuenta no pudo completar el perfil de driver; el alta fue revertida.',
    conversion_finalize_failed: 'No se pudo finalizar el registro de forma segura; el alta fue revertida.',
    admin_mfa_required: 'Esta acción requiere autenticación multifactor administrativa.',
};

const friendlyAdminError = (result, status) => {
    const raw = String(result.detail || result.error || '');
    const matched = Object.entries(DRIVER_APPLICATION_ERRORS)
        .find(([code]) => raw.includes(code) || result.error === code);
    return matched?.[1] || raw || `Solicitud administrativa fallida (HTTP ${status}).`;
};

const postAdminApi = async (path, payload) => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('La sesión administrativa expiró. Inicia sesión nuevamente.');
    const response = await fetch(adminApiEndpoint(path), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
        throw new Error(friendlyAdminError(result, response.status));
    }
    return result;
};

export const setDriverApplicationStatus = async ({ applicationCode, status, reason = '' }) =>
    postAdminApi('driver-application-admin.php', {
        action: 'set_status',
        application_code: applicationCode,
        status,
        reason,
    });

export const requestDriverApplicationDocuments = async ({ applicationCode, reason = '' }) =>
    postAdminApi('driver-application-admin.php', {
        action: 'request_documents',
        application_code: applicationCode,
        reason,
    });

export const reviewDriverApplicationDocument = async ({ applicationCode, documentId, reviewStatus, notes = '' }) =>
    postAdminApi('driver-application-admin.php', {
        action: 'review_document',
        application_code: applicationCode,
        document_id: documentId,
        review_status: reviewStatus,
        notes,
    });

export const convertDriverApplication = async ({ applicationCode, paymentQrUrl = '' }) =>
    postAdminApi('convert-driver-application.php', {
        application_code: applicationCode,
        payment_qr_url: paymentQrUrl,
    });
