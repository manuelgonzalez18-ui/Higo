import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

// Lee la última membresía activa del conductor desde driver_memberships y
// derivá días restantes / banda de severidad. La RLS garantiza que un driver
// sólo vea sus propias filas, así que basta filtrar por driver_id = uid.
//
// Devuelve:
//   membership   · fila cruda más reciente (puede estar vencida) o null
//   expiresAt    · Date | null
//   daysLeft     · número (negativo si ya venció)
//   severity     · 'ok' | 'warn' | 'critical' | 'expired' | 'unknown'
//   loading      · boolean
//   refresh()    · refetch manual
//
// Reglas de severidad:
//   > 7d  → ok
//   ≤ 7d  → warn
//   ≤ 2d  → critical
//   ≤ 0d  → expired
export function useDriverMembership(driverId) {
    const [membership, setMembership] = useState(null);
    const [loading, setLoading] = useState(true);
    // `now` se setea después del mount para no llamar Date.now() durante render
    // (react-hooks/purity). Refresh cada minuto alcanza para una pantalla que
    // muestra días restantes con resolución diaria.
    const [now, setNow] = useState(0);

    const fetchLatest = useCallback(async () => {
        if (!driverId) { setMembership(null); setLoading(false); return; }
        setLoading(true);
        const { data } = await supabase
            .from('driver_memberships')
            .select('id, plan, period, paid_at, expires_at, status')
            .eq('driver_id', driverId)
            .order('expires_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        setMembership(data || null);
        setLoading(false);
    }, [driverId]);

    useEffect(() => {
        let cancelled = false;
        const id = setTimeout(() => { if (!cancelled) fetchLatest(); }, 0);
        return () => { cancelled = true; clearTimeout(id); };
    }, [fetchLatest]);

    useEffect(() => {
        const tick = () => setNow(Date.now());
        const initial = setTimeout(tick, 0);
        const id = setInterval(tick, 60_000);
        return () => { clearTimeout(initial); clearInterval(id); };
    }, []);

    const { expiresAt, daysLeft, severity } = useMemo(() => {
        const exp = membership?.expires_at ? new Date(membership.expires_at) : null;
        if (!exp || !now) return { expiresAt: exp, daysLeft: null, severity: 'unknown' };
        const dl = Math.ceil((exp.getTime() - now) / 86400000);
        let sev = 'ok';
        if (dl <= 0) sev = 'expired';
        else if (dl <= 2) sev = 'critical';
        else if (dl <= 7) sev = 'warn';
        return { expiresAt: exp, daysLeft: dl, severity: sev };
    }, [membership, now]);

    return { membership, expiresAt, daysLeft, severity, loading, refresh: fetchLatest };
}
