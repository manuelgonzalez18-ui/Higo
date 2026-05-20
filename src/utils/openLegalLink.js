import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

// Abre un enlace legal sin sacar al usuario del contexto de la app.
//
// En Android/iOS (Capacitor native): usa @capacitor/browser que abre
// el navegador in-app (SafariViewController en iOS, Chrome Custom Tabs
// en Android). El usuario cierra con back y vuelve a la app sin
// reload.
//
// En web: el plugin de Capacitor en runtime web hace window.open en
// nueva pestaña. Lo invocamos igual para mantener una sola codepath.
// Si falla por cualquier motivo, fallback explícito a window.open.

export const openLegalLink = async (url) => {
    if (!url) return;
    try {
        await Browser.open({
            url,
            // toolbarColor matchea el bg dark de la app (#0A1330 del landing).
            // Capacitor lo respeta solo en Android Chrome Custom Tabs.
            toolbarColor: '#0A1330',
            presentationStyle: 'popover',
        });
    } catch (err) {
        // Fallback defensivo. No bloqueamos el flow si el plugin
        // estuviese ausente en algún build viejo.
        console.warn('[openLegalLink] Browser.open falló, fallback:', err?.message || err);
        if (typeof window !== 'undefined') {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }
};

// Helper informativo (no usado en runtime crítico).
export const isNativeApp = () =>
    typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.();
