// Cliente del endpoint /api/banesco-validate.php para Higo Pay.
// El servidor PHP se encarga de hablar con Banesco con las credenciales
// privadas; aquí sólo enviamos los datos del pago + el JWT de Supabase.

import { supabase } from './supabase';

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

/**
 * Llama al endpoint y devuelve el JSON ya parseado tal cual viene del PHP.
 * Forma esperada cuando ok=true:
 *   { ok, statusCode, amountReal, amountRequested, diff, diffPct,
 *     withinTolerance, trnDate, trnTime, referenceNumber,
 *     sourceBankId, destBankId, concept, raw }
 * Cuando ok=false:
 *   { ok:false, errorCode, errorMessage, statusCode?, raw? }
 */
export async function validateBanescoPayment({ reference, amount, phone, date, bank }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
        return { ok: false, errorCode: 'NO_SESSION', errorMessage: 'No hay sesión iniciada.' };
    }

    let resp;
    try {
        resp = await fetch('/api/banesco-validate.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ reference, amount, phone, date, bank }),
        });
    } catch (err) {
        return { ok: false, errorCode: 'NETWORK', errorMessage: err?.message || 'Error de red.' };
    }

    let body;
    try {
        body = await resp.json();
    } catch {
        return { ok: false, errorCode: 'BAD_RESPONSE', errorMessage: `Respuesta no-JSON (HTTP ${resp.status}).` };
    }
    return body;
}
