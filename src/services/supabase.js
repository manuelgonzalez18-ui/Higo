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

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        'Missing Supabase env vars at build time. ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local (dev) ' +
        'or as GitHub Actions secrets (CI). See docs/OPERATIONS.md.'
    );
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) {
    throw new Error(
        'VITE_SUPABASE_URL has invalid format. Expected https://<project-ref>.supabase.co, got: ' + supabaseUrl
    );
}

export const supabase = createClient(supabaseUrl, supabaseKey)

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
