// Cliente del endpoint /api/bcv-rate.php (proxy + cache de dolarapi).
// Devuelve la tasa oficial USD→Bs del BCV. La cachea 1 hora server-side
// y 5 min browser-side, así que llamarla en cada render es barato.
//
// Resiliencia:
//   - Si el fetch falla (red caída, CORS, dolarapi caído, etc), caemos
//     al último valor guardado en localStorage. Mejor mostrar una tasa
//     "stale" de hace unas horas que un "Tasa BCV no disponible" rojo
//     en el recibo del driver.
//   - El cache local sobrevive 7 días. Si no hay nada cacheado y la red
//     falla, devolvemos null (igual que antes) y el UI muestra el error.

import { apiUrl } from '../utils/apiUrl';

const LS_KEY = 'higo:bcv:lastGood';
const LS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

let inflight = null;

const loadLocalGood = () => {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.rate || !parsed?.savedAt) return null;
        if (Date.now() - parsed.savedAt > LS_TTL_MS) return null;
        return parsed;
    } catch {
        return null;
    }
};

const saveLocalGood = (data) => {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            rate:      data.rate,
            source:    data.source,
            fetchedAt: data.fetchedAt,
            savedAt:   Date.now(),
        }));
    } catch {
        // localStorage lleno o bloqueado → ignoramos, no es crítico.
    }
};

/**
 * @returns {Promise<{rate:number,source:string,fetchedAt:string,cached?:boolean,stale?:boolean}|null>}
 *   null si no hay tasa fresca NI cache local.
 */
export async function getOfficialBcvRate() {
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const url = apiUrl('/api/bcv-rate.php');
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!r.ok) {
                console.warn('[bcv] HTTP', r.status, 'en', url);
                throw new Error('http_' + r.status);
            }
            const body = await r.json();
            if (!body?.ok || !body?.rate) {
                console.warn('[bcv] respuesta sin rate:', body);
                throw new Error('bad_body');
            }
            const result = {
                rate:      Number(body.rate),
                source:    body.source || 'BCV',
                fetchedAt: body.fetchedAt,
                cached:    !!body.cached,
                stale:     !!body.stale,
            };
            saveLocalGood(result);
            return result;
        } catch (err) {
            console.warn('[bcv] fetch falló, intentando cache local:', err?.message || err);
            const local = loadLocalGood();
            if (local) {
                return {
                    rate:      Number(local.rate),
                    source:    (local.source || 'BCV') + ' (cache local)',
                    fetchedAt: local.fetchedAt,
                    cached:    true,
                    stale:     true,
                };
            }
            return null;
        } finally {
            // libera el cache de promesa después de 30s para que un refresh
            // manual pueda ir a buscar una tasa nueva sin recargar la página
            setTimeout(() => { inflight = null; }, 30_000);
        }
    })();
    return inflight;
}
