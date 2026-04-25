// Cliente del endpoint /api/bcv-rate.php (proxy + cache de dolarapi).
// Devuelve la tasa oficial USD→Bs del BCV. La cachea 1 hora server-side
// y 5 min browser-side, así que llamarla en cada render es barato.

let inflight = null;

/**
 * @returns {Promise<{rate:number,source:string,fetchedAt:string,cached?:boolean,stale?:boolean}|null>}
 *   null si no se pudo obtener (red caída, fuente caída).
 */
export async function getOfficialBcvRate() {
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const r = await fetch('/api/bcv-rate.php', { headers: { Accept: 'application/json' } });
            if (!r.ok) return null;
            const body = await r.json();
            if (!body?.ok || !body?.rate) return null;
            return {
                rate:      Number(body.rate),
                source:    body.source || 'BCV',
                fetchedAt: body.fetchedAt,
                cached:    !!body.cached,
                stale:     !!body.stale,
            };
        } catch {
            return null;
        } finally {
            // libera el cache de promesa después de 30s para que un refresh
            // manual pueda ir a buscar una tasa nueva sin recargar la página
            setTimeout(() => { inflight = null; }, 30_000);
        }
    })();
    return inflight;
}
