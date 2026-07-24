// withTimeout — corta la ESPERA de una promesa tras `ms`, rechazando con un
// Error legible. NO cancela la operación subyacente; solo deja de esperarla.
//
// Por qué existe (incidente 2026-07-22): en el WebView de Android (Capacitor)
// el AbortController NO corta el fetch colgado de forma confiable, así que el
// timeout del cliente Supabase no dispara y el login queda en "Procesando..."
// para siempre — sin error, sin poder reintentar. En el navegador sí corta,
// por eso la web funcionaba y la app no. Este helper garantiza que la UI se
// recupere en cualquier entorno: si la operación no resuelve en `ms`, el
// caller recibe el error y resetea el estado.
export const withTimeout = (promise, ms = 20000, message = 'La conexión tardó demasiado. Revisá tu internet e intentá de nuevo.') => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// ¿El error de red ya rechazó realmente la operación? Solo esos errores son
// reintentables. Un timeout local NO cancela la promesa/fetch original; volver
// a ejecutar en ese caso crea solicitudes solapadas o se une al mismo
// single-flight, por lo que no cuenta como un reintento real.
export const isRetryableNetworkError = (err) => {
    const msg = String(err?.message || err?.name || err || '').toLowerCase();
    return /failed to fetch|networkerror|network error|retryable|load failed/.test(msg);
};

// Ejecuta una función async con reintentos ante errores de red que ya
// rechazaron. La función recibe el número de intento.
export const withRetry = async (fn, { attempts = 3, baseDelayMs = 1000 } = {}) => {
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastErr = err;
            if (attempt >= attempts || !isRetryableNetworkError(err)) throw err;
            await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        }
    }
    throw lastErr;
};

export default withTimeout;
