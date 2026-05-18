import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

// Historial de viajes del pasajero. Lista paginada (cursor por
// created_at) de los rides donde user_id = auth.uid() con status
// 'completed' o 'cancelled'. Los rides activos (requested/accepted/
// in_progress) NO aparecen acá — viven en RideStatusPage.
//
// Para mostrar nombre/avatar del chofer en cada fila usamos la RPC
// get_public_profile (migration 34) que devuelve solo el subset safe
// sin requerir que el ride esté en estado donde RLS profiles permite
// leer la contraparte. Útil para rides cancelados donde la nueva RLS
// ya no expone el profile del chofer.

const PAGE_SIZE = 20;
const FILTERS = [
    { id: 'all',       label: 'Todos',      icon: 'list' },
    { id: 'completed', label: 'Completados', icon: 'check_circle' },
    { id: 'cancelled', label: 'Cancelados',  icon: 'cancel' },
];

const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-VE', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
};
const fmtPrice = (n) => `$${Number(n || 0).toFixed(2)}`;

const statusChip = (status) => {
    if (status === 'completed') return { label: 'Completado', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
    if (status === 'cancelled') return { label: 'Cancelado',  cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
    return                            { label: status || '—', cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30' };
};

const ratingStars = (n) => {
    if (!n) return null;
    return (
        <span className="inline-flex items-center gap-0.5 text-amber-400 text-xs">
            <span className="material-symbols-outlined text-[14px]">star</span>
            {n}
        </span>
    );
};

const RideHistoryPage = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState(null);
    const [filter, setFilter] = useState('all');
    const [rides, setRides] = useState([]);
    const [drivers, setDrivers] = useState({}); // driver_id → { full_name, avatar_url }
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (cancelled) return;
            if (!user) {
                navigate('/auth');
                return;
            }
            setUserId(user.id);
        })();
        return () => { cancelled = true; };
    }, [navigate]);

    // Resolver nombres de choferes en bulk vía get_public_profile RPC.
    // Una sola query a profiles via UNNEST sería más eficiente pero
    // requiere otro RPC; por ahora un await por driver_id único es
    // OK para 20 rows.
    const hydrateDrivers = useCallback(async (newRides) => {
        const driverIds = [...new Set(
            newRides.map(r => r.driver_id).filter(Boolean)
        )];
        if (!driverIds.length) return;
        const toFetch = driverIds.filter(id => !drivers[id]);
        if (!toFetch.length) return;
        const fetched = await Promise.all(
            toFetch.map(async (id) => {
                const { data } = await supabase.rpc('get_public_profile', { p_id: id });
                return [id, data?.[0] || null];
            })
        );
        setDrivers(prev => {
            const next = { ...prev };
            for (const [id, profile] of fetched) {
                if (profile) next[id] = profile;
            }
            return next;
        });
    }, [drivers]);

    const fetchPage = useCallback(async (reset = false) => {
        if (!userId) return;
        const before = reset ? null : (rides[rides.length - 1]?.created_at || null);

        let q = supabase
            .from('rides')
            .select('id, created_at, pickup, dropoff, price, status, driver_id, rating, ride_type, service_type, wait_fee, tip_amount')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE);

        if (filter === 'completed') q = q.eq('status', 'completed');
        else if (filter === 'cancelled') q = q.eq('status', 'cancelled');
        else q = q.in('status', ['completed', 'cancelled']);

        if (before) q = q.lt('created_at', before);

        const { data, error } = await q;
        if (error) {
            console.error('history fetch error:', error);
            return;
        }
        const next = reset ? (data || []) : [...rides, ...(data || [])];
        setRides(next);
        setHasMore((data || []).length === PAGE_SIZE);
        hydrateDrivers(data || []);
    }, [userId, filter, rides, hydrateDrivers]);

    // Refresh cuando cambia user o filtro.
    useEffect(() => {
        if (!userId) return;
        setLoading(true);
        setRides([]);
        setHasMore(true);
        (async () => {
            await fetchPage(true);
            setLoading(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, filter]);

    const loadMore = async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        await fetchPage(false);
        setLoadingMore(false);
    };

    return (
        <div className="min-h-screen bg-[#0F1014] text-white">
            {/* Header */}
            <header className="sticky top-0 z-10 px-4 py-3 bg-[#0F1014]/95 backdrop-blur border-b border-white/5 flex items-center gap-3">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 rounded-full bg-[#1A1F2E] flex items-center justify-center hover:bg-[#252A3A] active:scale-95 transition"
                    aria-label="Volver"
                >
                    <span className="material-symbols-outlined">arrow_back</span>
                </button>
                <div className="flex-1">
                    <h1 className="text-lg font-black">Historial de viajes</h1>
                    <p className="text-xs text-gray-500">Tus viajes y envíos pasados</p>
                </div>
            </header>

            {/* Filtros */}
            <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto">
                {FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1 transition-colors ${
                            filter === f.id
                                ? 'bg-blue-600 text-white shadow'
                                : 'bg-[#1A1F2E] text-gray-400 hover:text-white'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[14px]">{f.icon}</span>
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Lista */}
            <main className="px-4 pb-8 pt-2">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : rides.length === 0 ? (
                    <div className="text-center py-20 text-gray-500">
                        <span className="material-symbols-outlined text-5xl text-gray-600 mb-3 block">history</span>
                        <p className="text-sm font-medium">
                            {filter === 'cancelled' ? 'No hay viajes cancelados.'
                                : filter === 'completed' ? 'No hay viajes completados aún.'
                                : 'No hay viajes en tu historial todavía.'}
                        </p>
                        <button
                            onClick={() => navigate('/')}
                            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold"
                        >
                            Solicitar viaje
                        </button>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {rides.map(ride => {
                            const chip = statusChip(ride.status);
                            const driver = ride.driver_id ? drivers[ride.driver_id] : null;
                            const total = Number(ride.price || 0) + Number(ride.wait_fee || 0) + Number(ride.tip_amount || 0);
                            const hasTip = Number(ride.tip_amount || 0) > 0;
                            const isDelivery = ride.service_type === 'delivery';
                            return (
                                <li
                                    key={ride.id}
                                    className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-4 hover:border-white/10 transition-colors"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                            isDelivery ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-600/10 text-blue-400'
                                        }`}>
                                            <span className="material-symbols-outlined text-[20px]">
                                                {isDelivery ? 'inventory_2' : 'local_taxi'}
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-xs text-gray-400">{fmtDate(ride.created_at)}</p>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${chip.cls}`}>
                                                    {chip.label}
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-start gap-2 text-sm">
                                                <span className="material-symbols-outlined text-emerald-400 text-[14px] mt-0.5">trip_origin</span>
                                                <p className="truncate">{ride.pickup || '—'}</p>
                                            </div>
                                            <div className="flex items-start gap-2 text-sm">
                                                <span className="material-symbols-outlined text-rose-400 text-[14px] mt-0.5">place</span>
                                                <p className="truncate">{ride.dropoff || '—'}</p>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {driver?.avatar_url ? (
                                                        <img src={driver.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                                                    ) : (
                                                        <span className="w-6 h-6 rounded-full bg-[#0F1014] border border-white/10 flex items-center justify-center text-gray-500">
                                                            <span className="material-symbols-outlined text-[14px]">person</span>
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-gray-300 truncate">
                                                        {driver?.full_name || (ride.driver_id ? 'Conductor' : 'Sin conductor')}
                                                    </span>
                                                    {ratingStars(ride.rating)}
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-black text-sm">{fmtPrice(total)}</p>
                                                    {hasTip && (
                                                        <p className="text-[10px] text-emerald-400">+ {fmtPrice(ride.tip_amount)} propina</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {!loading && rides.length > 0 && hasMore && (
                    <div className="flex justify-center pt-4">
                        <button
                            onClick={loadMore}
                            disabled={loadingMore}
                            className="px-5 py-2 rounded-full bg-[#1A1F2E] text-gray-300 text-sm font-bold hover:bg-[#252A3A] disabled:opacity-50"
                        >
                            {loadingMore ? 'Cargando…' : 'Cargar más'}
                        </button>
                    </div>
                )}
                {!loading && rides.length > 0 && !hasMore && (
                    <p className="text-center text-xs text-gray-500 pt-4">
                        — fin del historial —
                    </p>
                )}
            </main>
        </div>
    );
};

export default RideHistoryPage;
