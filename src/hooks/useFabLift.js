import { useEffect } from 'react';

// useFabLift — eleva la burbuja flotante de soporte (SupportChatWidget) para
// que quede JUSTO por encima del borde superior de una tarjeta inferior, en
// vez de taparla.
//
// Por qué (2026-07-23): en la pantalla de viaje del pasajero y del Higo Driver
// la tarjeta inferior (datos del viaje / "Completar Viaje") ocupa la parte baja
// y la burbuja de soporte, anclada a `bottom` fijo, quedaba encima de la
// tarjeta. Este hook publica la posición correcta en la CSS var
// `--higo-fab-bottom`, que el widget lee. Al desmontar/desactivar, borra la var
// y el widget vuelve a su posición por defecto (6rem) en el resto de la app.
//
// Se mide `getBoundingClientRect().top` del elemento referenciado (posición
// real en viewport), así funciona aunque la tarjeta cambie de alto o sea un
// bottom-sheet que se colapsa/expande. Recalcula ante resize del elemento, del
// window y al terminar transiciones (el sheet del pasajero se desliza).
//
// Opción `fromCardHeight`: para tarjetas ancladas al fondo (p.ej. el
// bottom-sheet del pasajero, `absolute bottom-0` dentro de un `h-screen`),
// medimos por el ALTO real de la tarjeta (`offsetHeight`) en vez de `rect.top`.
// Esto evita el desfase de la barra del navegador móvil (window.innerHeight ≠
// viewport visible) que dejaba la burbuja pegada al borde de la tarjeta, y la
// mantiene arriba aunque el sheet esté colapsado (offsetHeight no cambia con el
// transform).
export function useFabLift(ref, active = true, { fromCardHeight = false, gap = 12 } = {}) {
    useEffect(() => {
        const el = ref?.current;
        const root = document.documentElement;

        if (!active || !el) {
            root.style.removeProperty('--higo-fab-bottom');
            return undefined;
        }

        const FLOOR = 96;     // 6rem: posición por defecto de la burbuja.
        // Nunca bajamos por debajo del FLOOR: ahí es donde vive el chat interno
        // conductor↔pasajero (ChatWidget, bottom-6 right-6). Si la tarjeta es
        // baja (p.ej. bottom-sheet del pasajero colapsado o tarjeta del driver
        // minimizada), mantenemos la posición por defecto para no tapar el chat.
        // Solo elevamos cuando la tarjeta es alta y su borde superior queda por
        // encima del FLOOR.
        const update = () => {
            const fromBottom = fromCardHeight
                ? el.offsetHeight + gap
                : window.innerHeight - el.getBoundingClientRect().top + gap;
            root.style.setProperty('--higo-fab-bottom', `${Math.max(FLOOR, fromBottom)}px`);
        };

        update();

        const ro = new ResizeObserver(update);
        ro.observe(el);
        window.addEventListener('resize', update);
        el.addEventListener('transitionend', update);

        return () => {
            ro.disconnect();
            window.removeEventListener('resize', update);
            el.removeEventListener('transitionend', update);
            root.style.removeProperty('--higo-fab-bottom');
        };
    }, [ref, active, fromCardHeight, gap]);
}

export default useFabLift;
