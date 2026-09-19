// A release has one business contract on web and Android.
export const RELEASE_FLAGS = Object.freeze({
    VITE_SHOP_ENABLED: false,
    VITE_SERVER_SIDE_RIDE_PRICING: true,
    VITE_SERVER_SIDE_RIDE_STATE: true,
    VITE_UNIFIED_MEMBERSHIP_CHECKOUT: true,
    VITE_ADMIN_MFA_UI: true,
});

export function validateEnvironment(env, { release = false } = {}) {
    const errors = [];
    const kind = env.VITE_APP_ENV;
    if (!['development', 'test', 'staging', 'production'].includes(kind)) errors.push('VITE_APP_ENV');
    for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_BASE_URL']) {
        if (!env[key] || /YOURPROJECT|xxxxx/i.test(env[key])) errors.push(key);
    }
    for (const key of ['VITE_SUPABASE_URL', 'VITE_API_BASE_URL']) {
        try {
            const url = new URL(env[key]);
            const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
            if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) errors.push(key);
            if (url.protocol !== 'https:' && !(local && ['development', 'test'].includes(kind))) errors.push(key);
            if (kind === 'test' && !local) errors.push(`${key}: tests must use localhost`);
            if (kind !== 'production' && ['higoapp.com', 'www.higoapp.com', 'yfgomicdcwifgeumqsvv.supabase.co'].includes(url.hostname)) errors.push(`${key}: production isolation`);
        } catch { errors.push(key); }
    }
    if (release && ['staging', 'production'].includes(kind)) {
        for (const key of ['VITE_GOOGLE_MAPS_API_KEY', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID']) {
            if (!env[key] || /xxxxx|YOURPROJECT/i.test(env[key])) errors.push(key);
        }
        if (!/^[a-f0-9]{40}$/i.test(env.VITE_GIT_SHA || '')) errors.push('VITE_GIT_SHA');
    }
    if (errors.length) throw new Error(`Invalid Higo environment: ${[...new Set(errors)].join(', ')}`);
    return kind;
}
