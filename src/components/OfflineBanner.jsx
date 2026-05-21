// OfflineBanner.jsx — H2.4 del Anexo B (Hardening de Producción).
//
// Banner sticky en el top que muestra:
//   - Amber/naranja persistente cuando no hay conexión.
//   - Verde durante 2s al recuperar conexión, luego oculto.
//
// Montado globalmente en App.jsx (un único banner para toda la app).
// Se posiciona en z-[100] para quedar arriba de modales, drawer y mapa
// pero debajo del Toast (que vive en z-[110] del propio Toast system).

import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const OfflineBanner = () => {
    const { online, justReconnected } = useOnlineStatus();

    if (online && !justReconnected) return null;

    const isReconnected = online && justReconnected;

    return (
        <div
            role="status"
            aria-live="polite"
            className={`fixed top-0 left-0 right-0 z-[100] px-4 py-2 text-sm font-bold text-center shadow-lg transition-all duration-300 ${
                isReconnected
                    ? 'bg-emerald-500/95 text-white'
                    : 'bg-amber-500/95 text-amber-950'
            }`}
            style={{
                paddingTop: 'max(8px, env(safe-area-inset-top))',
            }}
        >
            {isReconnected ? (
                <span className="inline-flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] leading-none">wifi</span>
                    Conectado
                </span>
            ) : (
                <span className="inline-flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] leading-none">wifi_off</span>
                    Sin conexión — algunas acciones no estarán disponibles
                </span>
            )}
        </div>
    );
};

export default OfflineBanner;
