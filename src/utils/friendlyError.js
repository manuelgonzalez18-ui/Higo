// friendlyError.js — H5.3 del Anexo B (Hardening de Producción).
//
// Mapea errores de Supabase / Postgres / red a mensajes user-friendly
// en español. El motivo: hoy hay ~30-40 call sites con patrón
//   toast.error("Error al X: " + err.message)
// que filtran nombres de constraints, codes Postgres, "RLS denied",
// "duplicate key value violates unique constraint xyz_pkey" y otras
// strings crudas que asustan al user + dan pistas internas a un atacante.
//
// API:
//   import { mapSupabaseError, friendlyError } from '../utils/friendlyError';
//
//   try { ... } catch (err) {
//     toast.error(friendlyError(err, 'No se pudo guardar el cambio'));
//   }
//
// El segundo arg es el mensaje genérico de fallback si no matcheamos
// ningún code conocido. Si querés el objeto estructurado para handling
// más fino, usá mapSupabaseError(err) que devuelve { code, message }.
//
// La función también dispara reportError() en background para que el
// error real (con stack) llegue a public.client_errors para diagnostico.

import { reportError } from './reportError';

// Postgres SQLSTATE codes más comunes que PostgREST devuelve via err.code.
// Ref: https://www.postgresql.org/docs/current/errcodes-appendix.html
const POSTGRES_CODES = {
    '23505': 'Ya existe un registro con esos datos. Verificá si no lo creaste antes.',
    '23503': 'No se puede completar — falta un registro relacionado.',
    '23502': 'Falta información requerida. Revisá los campos obligatorios.',
    '23514': 'Los datos no cumplen las reglas del sistema.',
    '42501': 'No tenés permisos para esta acción.',
    '42P01': 'La tabla no está disponible. Probá de nuevo en un momento.',
    '08000': 'No pudimos conectar con el servidor. Verificá tu conexión.',
    '08006': 'Se perdió la conexión con el servidor. Probá de nuevo.',
    '57014': 'La operación tardó demasiado y se canceló. Probá de nuevo.',
    'PGRST116': 'No se encontró el registro solicitado.',
    'PGRST301': 'Esta acción requiere iniciar sesión.',
    'PGRST302': 'No tenés permisos para esta acción.',
};

// Algunos errores de Supabase Auth tienen `code` o `name` específicos.
const AUTH_PATTERNS = [
    { test: /invalid login credentials/i,    msg: 'Email o clave incorrectos.' },
    { test: /email not confirmed/i,          msg: 'Tu email todavía no está verificado. Revisá tu bandeja de entrada.' },
    { test: /user already registered/i,      msg: 'Ya existe una cuenta con ese email.' },
    { test: /weak password|password should/i, msg: 'La clave es muy débil. Usá al menos 8 caracteres.' },
    { test: /rate limit/i,                   msg: 'Demasiados intentos. Esperá unos minutos antes de probar otra vez.' },
    { test: /jwt expired|invalid token/i,    msg: 'Tu sesión expiró. Iniciá sesión de nuevo.' },
    { test: /network|fetch|failed to fetch/i, msg: 'Problema de conexión. Verificá tu internet y probá de nuevo.' },
    { test: /aborted/i,                      msg: 'La operación se canceló.' },
];

/**
 * Devuelve { code, message } a partir de un error.
 *
 * @param {Error|any} err  El error original.
 * @returns {{ code: string|null, message: string }}
 */
export const mapSupabaseError = (err) => {
    if (!err) return { code: null, message: 'Algo salió mal. Intentá de nuevo.' };

    const code    = err.code || err.error_code || err.statusCode || null;
    const rawMsg  = String(err.message || err.error || err.error_description || err.msg || err || '');

    // 1. Match por code de Postgres / PostgREST.
    if (code && POSTGRES_CODES[code]) {
        return { code, message: POSTGRES_CODES[code] };
    }

    // 2. Match por patrón de auth/red.
    for (const { test, msg } of AUTH_PATTERNS) {
        if (test.test(rawMsg)) {
            return { code: code || 'pattern', message: msg };
        }
    }

    // 3. Fallback genérico.
    return {
        code: code || null,
        message: 'Algo salió mal. Intentá de nuevo en unos segundos.',
    };
};

/**
 * Helper de un solo paso para usar directamente en toast.error.
 * Mapea + reporta a client_errors en background.
 *
 * @param {Error|any} err          Error original.
 * @param {string} [fallback]      Mensaje genérico si no matcheamos code.
 * @param {object} [context]       Contexto extra para reportError.
 * @returns {string}               Mensaje listo para mostrar al user.
 */
export const friendlyError = (err, fallback, context = {}) => {
    const mapped = mapSupabaseError(err);

    // Reportar a public.client_errors en background (fire-and-forget).
    // Llevamos el error original con stack para diagnostico interno;
    // el user solo ve el mensaje friendly. Failsafe asegurado por
    // el propio reportError.
    if (err) {
        reportError(err, {
            mapped_code: mapped.code,
            fallback_used: !POSTGRES_CODES[mapped.code],
            ...context,
        });
    }

    // Si tenemos match, usar el mapped. Si no, usar fallback custom o
    // el mapped default.
    if (mapped.code && POSTGRES_CODES[mapped.code]) {
        return mapped.message;
    }
    return fallback || mapped.message;
};

export default friendlyError;
