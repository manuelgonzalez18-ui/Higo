import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

// Lee la última membresía activa de la tienda desde store_memberships y
// deriva días restantes / severidad. La RLS garantiza que un merchant
// sólo vea su tienda, así que basta filtrar por store_id.
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
export function useStoreMembership(storeId) {
    const [membership, setMembership] = useState(null);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(0);

    const fetchLatest = useCallback(async () => {
        if (!storeId) { 
            setMembership(null); 
            setLoading(false); 
            return; 
        }
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('store_memberships')
                .select('id, store_id, amount, payment_method, reference, status, paid_at, expires_at, notes, receipt_url, bank_origin, sender_phone')
                .eq('store_id', storeId)
                .order('expires_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            
            if (error) throw error;
            setMembership(data || null);
        } catch (err) {
            console.warn("[useStoreMembership] Failed to query store memberships from Supabase. Falling back to local state.", err.message);
            // Dynamic resilient fallback: if there is no table, we load from localStorage to keep the simulation fully operational
            const cached = localStorage.getItem(`higo_shop_membership_${storeId}`);
            if (cached) {
                try {
                    setMembership(JSON.parse(cached));
                } catch {
                    setMembership(null);
                }
            } else {
                setMembership(null);
            }
        } finally {
            setLoading(false);
        }
    }, [storeId]);

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

    // Permite guardar una simulación local para desarrollo resiliente si Supabase falla
    const saveLocalSimulation = useCallback((newMem) => {
        if (!storeId) return;
        localStorage.setItem(`higo_shop_membership_${storeId}`, JSON.stringify(newMem));
        setMembership(newMem);
    }, [storeId]);

    return { 
        membership, 
        expiresAt, 
        daysLeft, 
        severity, 
        loading, 
        refresh: fetchLatest,
        saveLocalSimulation 
    };
}
