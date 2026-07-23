// Client for the server-side Banesco validation endpoints.
// Driver memberships use v2 (unified driver_membership_plans). Store payments
// remain on the legacy endpoint until Higo Shop is re-enabled and migrated.

import { supabase } from './supabase';
import { apiUrl } from '../utils/apiUrl';

export const VENEZUELAN_BANKS = [
    { code: '0102', name: 'Banco de Venezuela' },
    { code: '0104', name: 'Venezolano de Crédito' },
    { code: '0105', name: 'Banco Mercantil' },
    { code: '0108', name: 'Banco Provincial (BBVA)' },
    { code: '0114', name: 'Bancaribe' },
    { code: '0115', name: 'Banco Exterior' },
    { code: '0116', name: 'Banco Occidental de Descuento (BOD)' },
    { code: '0128', name: 'Banco Caroní' },
    { code: '0134', name: 'Banesco' },
    { code: '0137', name: 'Banco Sofitasa' },
    { code: '0138', name: 'Banco Plaza' },
    { code: '0146', name: 'Bangente' },
    { code: '0151', name: 'BFC Banco Fondo Común' },
    { code: '0156', name: '100% Banco' },
    { code: '0157', name: 'Banco DelSur' },
    { code: '0163', name: 'Banco del Tesoro' },
    { code: '0166', name: 'Banco Agrícola de Venezuela' },
    { code: '0168', name: 'Bancrecer' },
    { code: '0169', name: 'Mi Banco' },
    { code: '0171', name: 'Banco Activo' },
    { code: '0172', name: 'Bancamiga' },
    { code: '0174', name: 'Banplus' },
    { code: '0175', name: 'Banco Bicentenario' },
    { code: '0176', name: 'Banco Espirito Santo' },
    { code: '0177', name: 'Banfanb' },
    { code: '0178', name: 'Banco Nacional de Crédito (BNC)' },
    { code: '0191', name: 'Banco Nacional de Crédito (BNC)' },
];

export async function validateBanescoPayment({
    reference,
    amount,
    phone,
    date,
    bank,
    storeId,
    planId,
    paymentType,
}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
        return { ok: false, errorCode: 'NO_SESSION', errorMessage: 'No hay sesión iniciada.' };
    }

    const payload = { reference, amount, phone, date, bank };
    let endpoint = '/api/banesco-validate-v2.php';

    if (storeId) {
        // Higo Shop compatibility path. The module is disabled by default and
        // will receive its own unified catalogue before being enabled again.
        endpoint = '/api/banesco-validate.php';
        payload.store_id = storeId;
    } else {
        if (planId) payload.plan_id = planId;
        payload.payment_type = paymentType || 'pm_banesco';
    }

    let response;
    try {
        response = await fetch(apiUrl(endpoint), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        return { ok: false, errorCode: 'NETWORK', errorMessage: error?.message || 'Error de red.' };
    }

    let body;
    try {
        body = await response.json();
    } catch {
        return {
            ok: false,
            errorCode: 'BAD_RESPONSE',
            errorMessage: `Respuesta no válida (HTTP ${response.status}).`,
        };
    }
    return body;
}
