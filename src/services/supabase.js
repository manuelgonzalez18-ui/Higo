import { createClient } from '@supabase/supabase-js'
import { createSingleFlight } from '../utils/singleFlight'
import { deferAuthCallback } from '../utils/deferAuthCallback'

const FALLBACK_URL = 'https://yfgomicdcwifgeumqsvv.supabase.co';
const FALLBACK_KEY = 'sb_publishable_d0f_4LR1PqQBc87ThKaxqQ_wm9CGAI1';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;

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
        // Sin otra vía segura para informar el error de configuración.
    }
};

function createNullSupabase() {
    const err = { message: 'supabase client not initialized' };
    const resp = { data: null, error: err };
    const channelStub = { on: () => channelStub, subscribe: () => channelStub };
    return {
        auth: {
            getUser: async () => ({ data: { user: null }, error: err }),
            getSession: async () => ({ data: { session: null }, error: err }),
            signInWithPassword: async () => resp,
            signUp: async () => resp,
            signOut: async () => resp,
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            resetPasswordForEmail: async () => resp,
            updateUser: async () => resp,
        },
        from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => resp, single: async () => resp }), single: async () => resp, maybeSingle: async () => resp }),
            insert: async () => resp,
            update: () => ({ eq: async () => resp }),
            upsert: async () => resp,
            delete: () => ({ eq: async () => resp }),
        }),
        rpc: async () => resp,
        storage: { from: () => ({ upload: async () => resp, createSignedUrl: async () => resp, remove: async () => resp }) },
        channel: () => channelStub,
        removeChannel: () => {},
    };
}

let _supabase;

if (!supabaseUrl || !supabaseKey) {
    console.error('[supabase] Missing env vars. URL:', !!supabaseUrl, 'KEY:', !!supabaseKey);
    renderFatalConfigError('SUPABASE_ENV_MISSING');
    _supabase = createNullSupabase();
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) {
    console.error('[supabase] Invalid URL format:', supabaseUrl);
    renderFatalConfigError('SUPABASE_URL_INVALID_FORMAT');
    _supabase = createNullSupabase();
} else {
    const passThroughLock = async (_name, _acquireTimeout, fn) => fn();
    _supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { lock: passThroughLock },
    });

    // Supabase advises against awaiting or starting more client calls directly
    // inside onAuthStateChange. Those callbacks can run while the auth client
    // still holds its internal lock, leaving signInWithPassword pending even
    // after /auth/v1/token has returned 200. Defer every application callback
    // centrally so existing and future listeners cannot recreate the deadlock.
    const nativeOnAuthStateChange = _supabase.auth.onAuthStateChange.bind(_supabase.auth);
    _supabase.auth.onAuthStateChange = (callback) => nativeOnAuthStateChange(
        deferAuthCallback(callback),
    );
}

// Supabase Auth puede seguir ejecutando el fetch aunque el timeout de UI deje de
// esperarlo. Sin este guard, el retry iniciaba otro /token en paralelo. Ahora
// todos los intentos para el mismo email comparten una única Promise real.
const authSingleFlight = createSingleFlight();
const nativeSignInWithPassword = _supabase.auth.signInWithPassword.bind(_supabase.auth);

const writeAuthTrace = (entry) => {
    try {
        const previous = JSON.parse(sessionStorage.getItem('higo_auth_trace') || '[]');
        const next = [...previous.slice(-19), entry];
        sessionStorage.setItem('higo_auth_trace', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('higo:auth-trace', { detail: entry }));
    } catch {
        // Diagnóstico opcional: nunca debe afectar el login.
    }
};

_supabase.auth.signInWithPassword = (credentials) => {
    const normalizedEmail = String(credentials?.email || '').trim().toLowerCase();
    const key = `password:${normalizedEmail}`;
    const joinedExisting = authSingleFlight.has(key);
    const attemptId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

    writeAuthTrace({
        attemptId,
        event: joinedExisting ? 'joined_inflight' : 'started',
        at: new Date().toISOString(),
        platform: typeof window !== 'undefined' ? window.navigator?.userAgent : 'unknown',
    });

    return authSingleFlight.run(key, async () => {
        const startedAt = Date.now();
        try {
            const result = await nativeSignInWithPassword(credentials);
            writeAuthTrace({
                attemptId,
                event: result?.error ? 'completed_with_error' : 'completed',
                at: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                status: result?.error?.status || null,
                errorName: result?.error?.name || null,
                errorMessage: result?.error?.message || null,
            });
            return result;
        } catch (error) {
            writeAuthTrace({
                attemptId,
                event: 'threw',
                at: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                status: error?.status || null,
                errorName: error?.name || null,
                errorMessage: error?.message || String(error),
            });
            throw error;
        }
    });
};

export const supabase = _supabase;
export const getAuthTrace = () => {
    try {
        return JSON.parse(sessionStorage.getItem('higo_auth_trace') || '[]');
    } catch {
        return [];
    }
};

export const withNetworkRetry = async (asyncFn, maxRetries = 2, timeoutMs = 8000) => {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await Promise.race([
                asyncFn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('La conexión tardó demasiado. Probá de nuevo.')), timeoutMs),
                ),
            ]);
        } catch (err) {
            lastErr = err;
            const msg = String(err?.message || err?.name || err || '').toLowerCase();
            // Un timeout local no cancela la operación subyacente. Reintentar en
            // ese caso duplicaría consultas todavía activas; solo reintentamos
            // errores de red que ya rechazaron realmente.
            const retryable = /failed to fetch|networkerror|network error|retryable|load failed/.test(msg);
            if (attempt >= maxRetries || !retryable) throw err;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
    }
    throw lastErr;
};

export const getUserProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (error || !data) return { id: user.id, role: 'passenger' };
    return data;
};

export const subscribeWithRetry = (channelFactory, opts = {}) => {
    const baseMs = opts.baseMs ?? 1000;
    const maxMs = opts.maxMs ?? 30000;
    const onStatus = opts.onStatus;
    let attempt = 0;
    let channel = null;
    let retryTimer = null;
    let stopped = false;

    const computeDelay = () => {
        const exp = Math.min(maxMs, baseMs * 2 ** attempt);
        return Math.round(exp * (0.8 + Math.random() * 0.4));
    };

    const connect = () => {
        if (stopped) return;
        channel = channelFactory();
        channel.subscribe((status) => {
            onStatus?.(status);
            if (status === 'SUBSCRIBED') {
                attempt = 0;
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
        if (retryTimer) clearTimeout(retryTimer);
        if (channel) supabase.removeChannel(channel);
    };
};
