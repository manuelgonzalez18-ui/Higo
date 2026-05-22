import { createClient } from '@supabase/supabase-js'

// Configuración del cliente Supabase.
//
// REGLA: las claves DEBEN venir de env vars de build (Vite / GitHub
// Actions secrets). Antes existía un fallback hardcoded acá; se
// removió porque:
//   1. Dificultaba la rotación: la key vieja quedaba en git history
//      y en cada bundle aunque se actualizara el secret de CI.
//   2. Si alguien por error metía una service_role en este fallback,
//      era catastrófico — RLS no protege contra service_role.
//   3. Enseñaba a devs nuevos que hardcodear keys es OK.
//
// Si VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY no están definidos en
// build time, el bundle falla con un error claro. CI tiene un check
// adicional (deploy.yml step "Build Project") que valida formato
// ANTES de invocar vite build.
//
// ROTACIÓN COORDINADA (decisión arquitectónica H1.1):
// La anon key vieja convive con la nueva en Supabase durante 15-30
// días para no romper APKs viejos en el Play Store. Pasos:
//   1. Crear nueva anon key en Supabase dashboard.
//   2. Actualizar GitHub secret VITE_SUPABASE_ANON_KEY con la nueva.
//   3. Subir APK nuevo al Play Store con la key nueva.
//   4. Esperar 15-30 días (ventana de adopción del APK).
//   5. Recién entonces invalidar la key vieja desde Supabase.
// Si se invalida la vieja antes del paso 5, todos los users con APK
// viejo quedan sin acceso. Documentado en docs/OPERATIONS.md.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// HOTFIX: NO usamos throw a nivel de modulo. Eso rompe el import
// chain entero (React nunca monta -> pantalla en blanco), pisando
// incluso al ErrorBoundary global.
//
// En su lugar, si las env vars faltan o tienen formato invalido:
//   1. Logueamos un error loud para que aparezca en DevTools y
//      eventualmente en client_errors si supabase logra reportar.
//   2. Pintamos un mensaje fullscreen via DOM manipulation directo
//      (no necesitamos React montado para mostrar texto al user).
//   3. Devolvemos un cliente "null-safe" no-op para que el resto del
//      bundle no crashee en su primer import.
// El CI check de deploy.yml (regex sobre los secrets) sigue siendo
// la BARRERA real. Esto es defensa en profundidad: si algo se filtro
// igual, el user ve un mensaje claro en lugar de un blank screen.

const renderFatalConfigError = (msg) => {
    if (typeof document === 'undefined') return;
    try {
        document.documentElement.style.background = '#0a101f';
        document.body.style.cssText = 'margin:0;padding:0;background:#0a101f;color:#fff;font-family:-apple-system,sans-serif;';
        document.body.innerHTML = `
            <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;">
                <div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,#dc2626,#f87171);display:flex;align-items:center;justify-content:center;margin-bottom:24px;">
                    <span style="font-size:36px;font-weight:900;color:#fff;">!</span>
                </div>
                <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;">Configuración faltante</h1>
                <p style="margin:0 0 24px;max-width:420px;color:#9ca3af;line-height:1.6;font-size:14px;">
                    La app no puede iniciar porque faltan parámetros de configuración en este build.
                    Avisá al equipo técnico y mostrales este código:
                </p>
                <code style="background:#000;color:#f87171;padding:8px 14px;border-radius:8px;font-family:monospace;font-size:12px;">${msg}</code>
            </div>
        `;
    } catch {
        // Si ni siquiera podemos tocar el DOM, ya no hay nada que hacer.
    }
};

let _supabase;

if (!supabaseUrl || !supabaseKey) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Missing env vars. URL:', !!supabaseUrl, 'KEY:', !!supabaseKey);
    renderFatalConfigError('SUPABASE_ENV_MISSING');
    // Stub que no crashea cuando otros modulos lo importan.
    _supabase = createNullSupabase();
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Invalid URL format:', supabaseUrl);
    renderFatalConfigError('SUPABASE_URL_INVALID_FORMAT');
    _supabase = createNullSupabase();
} else {
    _supabase = createClient(supabaseUrl, supabaseKey);
}

function createNullSupabase() {
    // Stub mínimo: cualquier call devuelve un error suave en lugar de
    // tirar TypeError "auth of undefined". El bundle no crashea al
    // import time; los call sites que dependan de supabase verán el
    // error en runtime y caerán por el ErrorBoundary global / try-catch.
    const err = { message: 'supabase client not initialized' };
    const resp = { data: null, error: err };
    const channelStub = { on: () => channelStub, subscribe: () => channelStub };
    return {
        auth: {
            getUser:        async () => ({ data: { user: null }, error: err }),
            getSession:     async () => ({ data: { session: null }, error: err }),
            signInWithPassword: async () => resp,
            signUp:         async () => resp,
            signOut:        async () => resp,
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            resetPasswordForEmail: async () => resp,
            updateUser:     async () => resp,
        },
        from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => resp, single: async () => resp }), single: async () => resp, maybeSingle: async () => resp }),
            insert: async () => resp,
            update: () => ({ eq: async () => resp }),
            upsert: async () => resp,
            delete: () => ({ eq: async () => resp }),
        }),
        rpc:            async () => resp,
        storage:        { from: () => ({ upload: async () => resp, createSignedUrl: async () => resp, remove: async () => resp }) },
        channel:        () => channelStub,
        removeChannel:  () => {},
    };
}

export const supabase = _supabase;

export const getUserProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (error || !data) {
        // Fallback if no profile exists yet
        return { id: user.id, role: 'passenger' }
    }
    return data
}

// Wrapper de subscribe con retry exponencial. Supabase Realtime ya
// hace reconexión automática por debajo, pero cuando el channel se
// cae con CHANNEL_ERROR o TIMED_OUT (típicamente: red mala, server
// reinicio, cambio de auth token), el callback de status lo reporta
// y el channel queda inactivo. Sin retry quedamos colgados hasta el
// próximo unmount/remount del componente.
//
// Patrón de uso (ver DriverDashboard / RideStatusPage):
//   const channel = supabase.channel('foo').on(...).subscribe(handler);
// Pasa a:
//   const stop = subscribeWithRetry(() =>
//       supabase.channel('foo').on(...),
//   );
//   return stop; // cleanup
//
// El factory crea el channel desde cero en cada retry (no podemos
// re-suscribir un channel removido). Backoff base 1s, máximo 30s,
// con jitter ±20% para evitar thundering herd al reconectar miles
// de drivers en simultáneo después de una caída de Supabase.
export const subscribeWithRetry = (channelFactory, opts = {}) => {
    const baseMs = opts.baseMs ?? 1000;
    const maxMs  = opts.maxMs  ?? 30000;
    const onStatus = opts.onStatus; // opcional: callback al consumidor.

    let attempt = 0;
    let channel = null;
    let retryTimer = null;
    let stopped = false;

    const computeDelay = () => {
        const exp   = Math.min(maxMs, baseMs * 2 ** attempt);
        const jitter = exp * (0.8 + Math.random() * 0.4); // ±20%
        return Math.round(jitter);
    };

    const connect = () => {
        if (stopped) return;
        channel = channelFactory();
        channel.subscribe((status) => {
            onStatus?.(status);
            if (status === 'SUBSCRIBED') {
                attempt = 0; // reset backoff al primer éxito
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                if (stopped) return;
                const delay = computeDelay();
                attempt++;
                if (channel) {
                    supabase.removeChannel(channel);
                    channel = null;
                }
                retryTimer = setTimeout(connect, delay);
            }
        });
    };

    connect();

    return () => {
        stopped = true;
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        if (channel) {
            supabase.removeChannel(channel);
            channel = null;
        }
    };
};
