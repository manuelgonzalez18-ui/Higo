import { supabase } from './supabase';

// Lista de bancos venezolanos que más originan pagos móviles. El usuario
// elige el banco DESDE EL QUE pagó. Si paga desde Banesco al mismo Banesco
// (0134), Banesco no exige el phone — para todo lo demás sí.
export const VE_BANKS = [
    { code: '0102', label: '0102 · Banco de Venezuela' },
    { code: '0105', label: '0105 · Mercantil' },
    { code: '0108', label: '0108 · Provincial' },
    { code: '0114', label: '0114 · Bancaribe' },
    { code: '0134', label: '0134 · Banesco' },
    { code: '0151', label: '0151 · BFC' },
    { code: '0156', label: '0156 · 100% Banco' },
    { code: '0163', label: '0163 · Tesoro' },
    { code: '0172', label: '0172 · Bancamiga' },
    { code: '0174', label: '0174 · Banplus' },
    { code: '0175', label: '0175 · Bicentenario' },
    { code: '0191', label: '0191 · BNC' },
];

const ENDPOINT = '/banesco-validate.php';

/**
 * Llama a banesco-validate.php con el JWT del usuario actual.
 * Devuelve siempre un objeto con shape { ok, outcome?, error?, ... }
 * para que el caller no tenga que diferenciar entre throw y respuesta.
 */
export async function validateBanescoPayment({ rideId, reference, phone, bankId, date }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
        return { ok: false, error: 'auth_required' };
    }

    let resp;
    try {
        resp = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                ride_id: rideId,
                reference,
                phone: phone || '',
                bank_id: bankId,
                date: date || new Date().toISOString().slice(0, 10),
            }),
        });
    } catch (e) {
        return { ok: false, error: 'network', detail: e?.message };
    }

    let body = null;
    try { body = await resp.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') {
        return { ok: false, error: 'bad_response', status: resp.status };
    }
    return body;
}

/** Mensajes legibles para los outcomes que devuelve el endpoint. */
export function describeOutcome(body) {
    if (!body) return 'No pudimos contactar al validador.';
    if (body.ok && body.outcome === 'matched') {
        return `Pago detectado: ${body.matched_amount?.toFixed?.(2)} Bs.`;
    }
    if (body.ok && body.outcome === 'already_validated') {
        return 'Este viaje ya fue validado.';
    }
    switch (body.error || body.outcome) {
        case 'auth_required':       return 'Tu sesión expiró. Iniciá sesión de nuevo.';
        case 'bad_reference':       return 'La referencia debe tener entre 4 y 20 dígitos.';
        case 'bad_bank_id':         return 'Banco inválido.';
        case 'bad_phone':           return 'El teléfono debe ser 04XX o 58XXX.';
        case 'phone_required_interbank':
            return 'Banesco requiere el teléfono del pagador para validar pagos interbancarios.';
        case 'too_many_attempts':   return 'Demasiados intentos. Esperá unos minutos.';
        case 'ride_not_found':      return 'No encontramos el viaje.';
        case 'ride_not_yours':      return 'Este viaje no es tuyo.';
        case 'ride_not_completed':  return 'El viaje todavía no está completado.';
        case 'bcv_unavailable':     return 'No pudimos obtener el tipo de cambio. Probá de nuevo.';
        case 'banesco_unavailable': return 'Banesco no responde ahora. Probá en unos minutos.';
        case 'no_credit':           return 'Banesco no encontró un abono con esa referencia.';
        case 'amount_mismatch':     return 'Encontramos un pago, pero el monto no coincide.';
        case 'banesco_error':       return 'Banesco devolvió un error procesando la consulta.';
        default:                    return 'No pudimos validar el pago. Probá de nuevo.';
    }
}
