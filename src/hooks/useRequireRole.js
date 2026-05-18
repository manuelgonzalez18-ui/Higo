import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserProfile } from '../services/supabase';

// Hook que centraliza el patrón "fetch profile + check role +
// redirect si no autorizado" repetido en ~10 admin pages
// (AdminUsersPage, AdminZonesPage, AdminPromoCodesPage,
// AdminLoginPage, AdminDriversPage, AdminAnalyticsPage,
// AdminSupportStatsPage, AdminSupportPage, AdminPricingPage,
// AdminDashboardPage vía AdminGuard).
//
// API:
//   const { authorized, loading, profile } = useRequireRole('admin');
//   if (loading) return <Spinner />;
//   if (!authorized) return null;  // navigate('/') ya disparó
//
// Soporta arrays para multi-role: useRequireRole(['admin', 'driver']).
// fallbackPath opcional: a dónde mandar si no autoriza (default '/').

export const useRequireRole = (allowed, opts = {}) => {
    const navigate = useNavigate();
    const fallbackPath = opts.fallbackPath ?? '/';
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        const roles = Array.isArray(allowed) ? allowed : [allowed];
        let cancelled = false;
        (async () => {
            const p = await getUserProfile();
            if (cancelled) return;
            if (!p || !roles.includes(p.role)) {
                navigate(fallbackPath, { replace: true });
                setLoading(false);
                return;
            }
            setProfile(p);
            setAuthorized(true);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    // allowed es array literal — Array.isArray + JSON.stringify trick
    // o simplemente disable exhaustive-deps. Acá lo dejamos como
    // ref-stable porque el patrón típico es useRequireRole('admin')
    // o useRequireRole(['admin']) con literal — no cambia entre
    // renders del mismo mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, fallbackPath]);

    return { authorized, loading, profile };
};

// Variantes específicas para los casos más comunes.
export const useRequireAdmin = (opts) => useRequireRole('admin', opts);
export const useRequireDriver = (opts) => useRequireRole('driver', opts);
