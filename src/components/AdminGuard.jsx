import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAdminContext } from '../services/adminApi';
import { AdminContext } from '../contexts/AdminContext';

// Compatibility for existing admin pages. The context itself lives in a
// separate module, so this re-export does not create duplicate state.
// eslint-disable-next-line react-refresh/only-export-components
export { useAdminContext } from '../contexts/AdminContext';

const ROUTE_PERMISSIONS = [
    ['/admin/dashboard', ['view_dashboard']],
    ['/admin/drivers', ['manage_memberships', 'manage_drivers']],
    ['/admin/analytics', ['view_analytics']],
    ['/admin/users', ['view_users']],
    ['/admin/pricing', ['manage_pricing']],
    ['/admin/zones', ['manage_zones']],
    ['/admin/promos', ['manage_promos']],
    ['/admin/disputes', ['manage_disputes']],
    ['/admin/rides', ['manage_operations']],
    ['/admin/deliveries', ['manage_operations']],
    ['/admin/support', ['manage_support']],
    ['/admin/fraud', ['manage_operations']],
    ['/admin/shop', ['manage_shop']],
];

export default function AdminGuard({ children }) {
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [context, setContext] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        getAdminContext()
            .then((value) => { if (!cancelled) setContext(value); })
            .catch((err) => { if (!cancelled) setError(err.message || 'No se pudo verificar el acceso.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const requiredPermissions = useMemo(() => {
        const match = ROUTE_PERMISSIONS.find(([prefix]) => location.pathname.startsWith(prefix));
        return match?.[1] || ['view_dashboard'];
    }, [location.pathname]);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0F1419] flex items-center justify-center text-gray-400">
                <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Verificando acceso administrativo…</span>
                </div>
            </div>
        );
    }

    if (error || !context?.authorized) return <Navigate to="/admin" replace />;

    if (context.require_mfa && context.aal !== 'aal2') {
        return (
            <div className="min-h-screen bg-[#0F1419] text-white flex items-center justify-center p-5">
                <div className="max-w-md w-full bg-[#1A1F2E] border border-amber-500/25 rounded-3xl p-7 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center mx-auto mb-4">
                        <span className="material-symbols-outlined text-3xl">security</span>
                    </div>
                    <h1 className="text-xl font-black">Verificación de dos pasos requerida</h1>
                    <p className="text-sm text-gray-400 mt-3">La política del panel exige MFA para esta sesión. Volvé al acceso administrativo para completar el código del autenticador.</p>
                    <a href="#/admin" className="mt-6 inline-flex px-5 py-3 rounded-xl bg-violet-600 font-bold">Verificar acceso</a>
                </div>
            </div>
        );
    }

    const allowed = requiredPermissions.some((permission) => context.permissions?.[permission]);
    if (!allowed) {
        return (
            <div className="min-h-screen bg-[#0F1419] text-white flex items-center justify-center p-5">
                <div className="max-w-md w-full bg-[#1A1F2E] border border-red-500/25 rounded-3xl p-7 text-center">
                    <span className="material-symbols-outlined text-red-300 text-5xl">lock</span>
                    <h1 className="text-xl font-black mt-3">Acceso no autorizado</h1>
                    <p className="text-sm text-gray-400 mt-2">Tu perfil administrativo no tiene ninguno de los permisos requeridos: <span className="font-mono text-gray-300">{requiredPermissions.join(', ')}</span>.</p>
                    <a href="#/admin/dashboard" className="mt-6 inline-flex px-5 py-3 rounded-xl bg-violet-600 font-bold">Volver al resumen</a>
                </div>
            </div>
        );
    }

    return <AdminContext.Provider value={context}>{children}</AdminContext.Provider>;
}
