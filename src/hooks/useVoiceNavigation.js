// useVoiceNavigation.js — turn-by-turn voice nav para el driver.
//
// Recibe la lista de `steps` que devuelve InteractiveMapGoogle (la
// ruta calculada por DirectionsService) y la posición actual del
// driver. En cada update de posición:
//   1. Calcula la distancia al final del step actual.
//   2. A 300m del final → anuncio anticipado: "En 280 metros, gire
//      a la derecha en Calle 12".
//   3. A 50m del final → anuncio inmediato: "Gire a la derecha en
//      Calle 12".
//   4. Pasado el step (< 30m del end_location) → avanza al siguiente.
//   5. Último step alcanzado → "Has llegado a tu destino".
//
// El hook NO se activa para el pasajero — sólo se llama desde
// DriverDashboard cuando isOnline + activeRide.
//
// Reset automático: si la lista de steps cambia (nuevo viaje o
// re-routing), reseteamos el cursor y los flags de anuncio.

import { useEffect, useRef } from 'react';

// Distancias en metros para los gatillos de anuncio.
const ADVANCE_M  = 300; // anuncio anticipado
const IMMINENT_M = 50;  // anuncio inmediato
const PASSED_M   = 30;  // step pasado, avanzar

// Haversine en metros — copiado acá para evitar import extra.
const distanceMeters = (a, b) => {
    if (!a || !b) return Infinity;
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

export const useVoiceNavigation = ({ steps, currentLocation, enabled, speak }) => {
    const stepIndexRef        = useRef(0);
    const announcedAdvanceRef = useRef(false);
    const announcedImminentRef = useRef(false);
    const announcedStartRef   = useRef(false);
    const routeKeyRef         = useRef(null);

    // Reset cuando llega una ruta nueva (origen/destino distinto).
    useEffect(() => {
        if (!steps || steps.length === 0) {
            routeKeyRef.current = null;
            return;
        }
        const last = steps[steps.length - 1];
        const key = `${steps.length}|${last?.end_location.lat.toFixed(4)},${last?.end_location.lng.toFixed(4)}`;
        if (key !== routeKeyRef.current) {
            stepIndexRef.current = 0;
            announcedAdvanceRef.current = false;
            announcedImminentRef.current = false;
            announcedStartRef.current = false;
            routeKeyRef.current = key;
        }
    }, [steps]);

    useEffect(() => {
        if (!enabled || !speak) return;
        if (!steps || steps.length === 0) return;
        if (!currentLocation) return;

        // Primer step: anuncio de arranque.
        if (!announcedStartRef.current && steps[0]?.instruction) {
            speak(steps[0].instruction);
            announcedStartRef.current = true;
            return;
        }

        const idx = stepIndexRef.current;
        if (idx >= steps.length) return; // Ruta terminada.

        const currStep = steps[idx];
        const nextStep = steps[idx + 1];
        const distToEnd = distanceMeters(currentLocation, currStep.end_location);

        // ¿Pasamos el step? Avanzar.
        if (distToEnd < PASSED_M) {
            if (nextStep) {
                stepIndexRef.current = idx + 1;
                announcedAdvanceRef.current = false;
                announcedImminentRef.current = false;
            } else if (!announcedImminentRef.current) {
                // Último step pasado → llegamos.
                speak('Has llegado a tu destino');
                announcedImminentRef.current = true;
                stepIndexRef.current = steps.length;
            }
            return;
        }

        // Anuncio inmediato (~50m del giro).
        if (distToEnd < IMMINENT_M && !announcedImminentRef.current) {
            const inst = nextStep?.instruction || 'Llegando a destino';
            speak(inst);
            announcedImminentRef.current = true;
            return;
        }

        // Anuncio anticipado (~300m del giro).
        if (distToEnd < ADVANCE_M && distToEnd >= IMMINENT_M && !announcedAdvanceRef.current) {
            const inst = nextStep?.instruction || 'Llegando a destino';
            const metros = Math.round(distToEnd);
            speak(`En ${metros} metros, ${inst}`);
            announcedAdvanceRef.current = true;
        }
    }, [currentLocation, steps, enabled, speak]);
};
