// useOnlineStatus.js — H2.4 del Anexo B (Hardening de Producción).
//
// Detecta si el browser tiene conectividad real. Combina dos señales:
//   1. navigator.onLine + eventos 'online'/'offline' (instantáneo pero
//      MIENTE en algunos casos: true aunque el wifi no tenga internet,
//      false en redes con captive portal sin gateway, etc).
//   2. Ping HEAD a /favicon.ico cada 30s SOLO cuando navigator.onLine
//      reporta false (para confirmar si efectivamente no hay red).
//      Si el ping pasa, asumimos que onLine mintió y nos marcamos online.
//
// Retorna { online: boolean, justReconnected: boolean }.
// justReconnected es true durante 2s post-reconexión para que el banner
// pueda mostrar "Conectado" en verde y luego ocultarse.

import { useEffect, useRef, useState } from 'react';

const PING_INTERVAL_MS = 30 * 1000;
const PING_TIMEOUT_MS = 4000;
const JUST_RECONNECTED_MS = 2000;

const pingNetwork = async () => {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
        // Cache-buster + HEAD para minimizar bytes. /favicon.ico siempre
        // está servido y es chiquito.
        const url = `/favicon.ico?_ping=${Date.now()}`;
        const res = await fetch(url, {
            method: 'HEAD',
            cache: 'no-store',
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        return res.ok || res.status === 304;
    } catch {
        return false;
    }
};

export const useOnlineStatus = () => {
    // Estado inicial: si navigator.onLine es true, asumimos online.
    // En SSR (sin window) default a true para no flash de "offline" al
    // hidratar.
    const initialOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    const [online, setOnline] = useState(initialOnline);
    const [justReconnected, setJustReconnected] = useState(false);
    const wasOfflineRef = useRef(!initialOnline);
    const pingTimerRef = useRef(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const markOnline = () => {
            setOnline(true);
            if (wasOfflineRef.current) {
                wasOfflineRef.current = false;
                setJustReconnected(true);
                setTimeout(() => setJustReconnected(false), JUST_RECONNECTED_MS);
            }
        };

        const markOffline = () => {
            setOnline(false);
            wasOfflineRef.current = true;
        };

        const handleOnline = () => {
            // navigator.onLine cambió a true. Confirmar con ping antes
            // de avisar al user (captive portals devuelven onLine=true).
            pingNetwork().then((ok) => {
                if (ok) markOnline();
                else markOffline();
            });
        };

        const handleOffline = () => {
            markOffline();
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Si arrancamos offline o si la app fue restaurada del background,
        // re-confirmamos con un ping al primer render.
        if (!navigator.onLine) {
            markOffline();
        }

        // Polling cada 30s cuando estamos offline para detectar
        // reconexión incluso si el evento 'online' no se dispara
        // (algunos browsers/devices son raros con eso).
        pingTimerRef.current = setInterval(() => {
            // Solo poll si estamos offline. Si online, ahorrar bytes.
            if (!navigator.onLine || wasOfflineRef.current) {
                pingNetwork().then((ok) => {
                    if (ok) markOnline();
                });
            }
        }, PING_INTERVAL_MS);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (pingTimerRef.current) {
                clearInterval(pingTimerRef.current);
                pingTimerRef.current = null;
            }
        };
    }, []);

    return { online, justReconnected };
};

export default useOnlineStatus;
