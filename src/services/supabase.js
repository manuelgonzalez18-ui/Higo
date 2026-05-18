import { createClient } from '@supabase/supabase-js'

// Valores del proyecto Supabase. Son seguros exponer en el cliente:
// - URL del proyecto: pública por definición
// - anon key: protegida por Row Level Security en la DB
// Si en .env o en CI está definida una variable, esa gana. Caso contrario,
// usamos estos valores fallback para evitar un "Missing env vars" fatal.
const FALLBACK_URL = 'https://yfgomicdcwifgeumqsvv.supabase.co';
const FALLBACK_KEY = 'sb_publishable_d0f_4LR1PqQBc87ThKaxqQ_wm9CGAI1';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;

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

