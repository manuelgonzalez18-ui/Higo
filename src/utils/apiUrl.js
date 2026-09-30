const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export function apiUrl(path) {
    if (!base) throw new Error('HIGO_API_CONFIG_MISSING');
    if (!path.startsWith('/api/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid API path');
    return `${base}${path}`;
}
