// Prefija los fetches a /api/*.php con el host correcto.
//
// En la web (https://higoapp.com) la URL relativa funciona sola y devolvemos
// el path sin tocar. Dentro del APK Capacitor el origen es capacitor://localhost
// (o https://localhost), así que la URL relativa resuelve contra el bundle local
// y nunca llega al backend. En ese caso anteponemos el host de producción.

const PROD_API_HOST = 'https://higoapp.com';

const isCapacitorNative = () => {
    try {
        return !!(typeof window !== 'undefined'
            && window.Capacitor
            && window.Capacitor.isNativePlatform
            && window.Capacitor.isNativePlatform());
    } catch {
        return false;
    }
};

export function apiUrl(path) {
    const p = path.startsWith('/') ? path : '/' + path;
    return isCapacitorNative() ? PROD_API_HOST + p : p;
}
