import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Keyboard navigation tipo Gmail/GitHub para el panel admin (D.X4).
// Patrón: secuencia "g + letra" en menos de 1.2s navega a una ruta.
//   g+d → /admin/dashboard
//   g+u → /admin/users
//   g+v → /admin/drivers (v de vehicles/conductores, d ya está usado)
//   g+s → /admin/support
//   g+p → /admin/pricing
//   g+r → /admin/promos (r de "rebajas")
//   g+t → /admin/disputes (t de tickets)
//   g+a → /admin/analytics
//   g+z → /admin/zones
//   g+f → /admin/fraud
//
// Ignora el atajo si el foco está en un <input>/<textarea> o si el
// usuario está marcando una pestaña con cmd/ctrl/alt — no querés
// disparar "g+d" mientras tipea su nombre.

const ROUTES = {
    d: '/admin/dashboard',
    u: '/admin/users',
    v: '/admin/drivers',
    s: '/admin/support',
    p: '/admin/pricing',
    r: '/admin/promos',
    t: '/admin/disputes',
    a: '/admin/analytics',
    z: '/admin/zones',
    f: '/admin/fraud',
};

const isTypingTarget = (el) => {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export const useAdminKeyboardNav = () => {
    const navigate = useNavigate();
    useEffect(() => {
        let armed = false;
        let armedTimer = null;
        const arm = () => {
            armed = true;
            if (armedTimer) clearTimeout(armedTimer);
            armedTimer = setTimeout(() => { armed = false; }, 1200);
        };
        const onKey = (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (isTypingTarget(document.activeElement)) return;
            const k = e.key?.toLowerCase();
            if (!k) return;
            if (!armed && k === 'g') {
                arm();
                return;
            }
            if (armed) {
                armed = false;
                if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
                const route = ROUTES[k];
                if (route) {
                    e.preventDefault();
                    navigate(route);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            if (armedTimer) clearTimeout(armedTimer);
        };
    }, [navigate]);
};
