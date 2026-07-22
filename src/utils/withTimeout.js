// withTimeout — corta la ESPERA de una promesa tras `ms`, rechazando con un
// Error legible. NO cancela la operación subyacente; solo deja de esperarla.
//
// Por qué existe (incidente 2026-07-22): en el WebView de Android (Capacitor)
// el AbortController NO corta el fetch colgado de forma confiable, así que el
// timeout del cliente Supabase no dispara y el login queda en "Procesando..."
// para siempre — sin error, sin poder reintentar. En el navegador sí corta,
// por eso la web funcionaba y la app no. Este helper garantiza que la UI se
// recupere en cualquier entorno: si la operación no resuelve en `ms`, el
// caller recibe el error, resetea el estado y el usuario reintenta (el
// reintento suele pasar en redes móviles intermitentes).
export const withTimeout = (promise, ms = 20000, message = 'La conexión tardó demasiado. Revisá tu internet e intentá de nuevo.') => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export default withTimeout;
