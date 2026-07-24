// Resolves PHP API calls to the production backend when the frontend is not
// running on higoapp.com (Capacitor, localhost or a Vercel preview).

const PROD_API_HOST = 'https://higoapp.com';
const PROD_HOSTS = new Set(['higoapp.com', 'www.higoapp.com']);

const isCapacitorNative = () => {
    try {
        return Boolean(
            typeof window !== 'undefined'
            && window.Capacitor?.isNativePlatform?.()
        );
    } catch {
        return false;
    }
};

const needsProductionApiHost = () => {
    if (typeof window === 'undefined') return false;
    return isCapacitorNative() || !PROD_HOSTS.has(window.location.hostname);
};

export function apiUrl(path) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return needsProductionApiHost() ? `${PROD_API_HOST}${normalizedPath}` : normalizedPath;
}
