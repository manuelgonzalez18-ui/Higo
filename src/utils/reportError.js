// reportError.js — H2.2 del Anexo B (Hardening de Producción).
//
// Inserta errores del cliente en la tabla public.client_errors (mig 66)
// para que los admins puedan diagnosticarlos en /admin/support o vía SQL.
//
// Dos defensas críticas:
//   1. Dedupe local: si un error se dispara en loop (ej. render-error
//      infinito), no spameamos la DB con miles de filas idénticas.
//      Usamos un Map con hash(message + route) y TTL 60s.
//   2. Failsafe absoluto: un fallo del reporter NUNCA debe re-throw.
//      Si el insert falla (red, RLS, tabla no existe en dev), tragamos
//      silenciosamente. La app no se va a romper "porque el reporter de
//      errores se rompió" — eso seria la peor inversión de hardening.
//
// Uso típico:
//   import { reportError } from '../utils/reportError';
//
//   try {
//     await algo();
//   } catch (err) {
//     reportError(err, { source: 'algo()', rideId: 123 });
//     throw err; // re-throw si querés que el caller lo maneje también
//   }
//
// En ErrorBoundary.componentDidCatch:
//   reportError(error, { componentStack, source: 'react-boundary' });

import { supabase } from '../services/supabase';
import { logger } from './logger';

// Versión de la app: la inyecta Vite en build time si está definida en
// .env (VITE_APP_VERSION). En dev queda 'dev'.
const APP_VERSION = (typeof import.meta !== 'undefined'
    && import.meta.env?.VITE_APP_VERSION) || 'dev';

const IS_DEV = (typeof import.meta !== 'undefined'
    && import.meta.env?.DEV === true) || false;

// Dedupe: hash de message+route -> timestamp del último envío.
// TTL: 60s. Si llega el mismo error dentro de la ventana, no spammeamos.
const DEDUPE_TTL_MS = 60 * 1000;
const dedupeMap = new Map();

const hashKey = (msg, route) => `${route || '?'}::${(msg || '').slice(0, 100)}`;

const isDuplicateRecent = (msg, route) => {
    const key = hashKey(msg, route);
    const now = Date.now();
    const last = dedupeMap.get(key);
    if (last && now - last < DEDUPE_TTL_MS) {
        return true;
    }
    dedupeMap.set(key, now);
    // Limpieza barata: si el Map crece > 200 entries, purgar las viejas.
    if (dedupeMap.size > 200) {
        for (const [k, t] of dedupeMap) {
            if (now - t > DEDUPE_TTL_MS) dedupeMap.delete(k);
        }
    }
    return false;
};

const truncate = (s, max) => {
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
};

/**
 * Reportar un error a public.client_errors. Failsafe — nunca throw.
 *
 * @param {Error|string} err   El error (instancia o mensaje).
 * @param {object} [context]   Datos extra estructurados (jsonb).
 * @returns {Promise<void>}    Resuelve siempre, incluso si insert falla.
 */
export const reportError = async (err, context = {}) => {
    try {
        const message = err instanceof Error
            ? (err.message || String(err))
            : String(err || 'unknown error');

        const stack = err instanceof Error ? err.stack : null;

        const route = typeof window !== 'undefined'
            ? (window.location.hash || window.location.pathname || '?')
            : '?';

        // Dedupe: si llegó este mismo error/ruta en los últimos 60s,
        // no spameamos la DB. Sí logueamos en consola para visibilidad
        // local del dev.
        if (isDuplicateRecent(message, route)) {
            logger.debug('[reportError] deduped:', message);
            return;
        }

        // En DEV solo console.error y no insert — no llenamos la tabla
        // con ruido de hot-reload, ni dependemos de Supabase up local.
        if (IS_DEV) {
            logger.error('[reportError] (dev, not sent):', message, stack, context);
            return;
        }

        // Obtener user_id si hay sesión. NO bloqueamos si no hay.
        // Si auth.getUser() falla por red, queda user_id = null.
        let userId = null;
        try {
            const { data: { user } } = await supabase.auth.getUser();
            userId = user?.id || null;
        } catch {
            // ignorar — reportar igual sin user_id
        }

        const payload = {
            user_id:     userId,
            route:       truncate(route, 500),
            message:     truncate(message, 2000),
            stack:       truncate(stack, 8000),
            user_agent:  truncate(typeof navigator !== 'undefined' ? navigator.userAgent : '', 500),
            app_version: APP_VERSION,
            context:     context && typeof context === 'object' ? context : {},
        };

        // Fire-and-forget. Si el insert falla, nos enteramos en logs
        // del admin de Supabase, no rompe la app.
        const { error: insErr } = await supabase
            .from('client_errors')
            .insert(payload);

        if (insErr) {
            // No re-throw. Solo loguear si es algo distinto a tabla
            // inexistente (caso de migración no aplicada todavía).
            logger.warn('[reportError] insert failed:', insErr.message);
        }
    } catch (reporterErr) {
        // Triple defensa: si TODO falla acá adentro, tragamos.
        // No queremos que reportError tire un unhandled rejection.
        try {
            // eslint-disable-next-line no-console
            console.warn('[reportError] reporter self-failed:', reporterErr?.message || reporterErr);
        } catch {
            // ya está, rendido.
        }
    }
};

export default reportError;
