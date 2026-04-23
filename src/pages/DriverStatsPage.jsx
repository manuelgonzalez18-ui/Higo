import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

// Pantalla "Mis Estadísticas" del conductor.
// Muestra: ganancias por periodo, viajes totales, rating promedio,
// historial reciente, código de referido y crédito acumulado.
const DriverStatsPage = () => {
    const navigate = useNavigate();
    const [profile, setProfile] = useState(null);
    const [rides, setRides] = useState([]);
    const [period, setPeriod] = useState('week'); // 'today' | 'week' | 'month' | 'all'
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/auth'); return; }

            const { data: prof } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();
            if (!prof || prof.role !== 'driver') { navigate('/'); return; }
            setProfile(prof);

            const { data: ridesData } = await supabase
                .from('rides')
                .select('id, price, wait_fee, status, created_at, rating, pickup, dropoff, payment_method, payment_confirmed_at, ride_type')
                .eq('driver_id', user.id)
                .eq('status', 'completed')
                .order('created_at', { ascending: false })
                .limit(200);
            setRides(ridesData || []);
            setLoading(false);
        };
        load();
    }, [navigate]);

    // Filtros temporales
    const filterByPeriod = (rs) => {
        if (period === 'all') return rs;
        const now = Date.now();
        const cutoff = period === 'today' ? now - 86400e3 :
                       period === 'week' ? now - 7 * 86400e3 :
                       now - 30 * 86400e3;
        return rs.filter(r => new Date(r.created_at).getTime() >= cutoff);
    };
    const filteredRides = filterByPeriod(rides);

    // Métricas
    const totalEarnings = filteredRides.reduce((s, r) => s + Number(r.price || 0), 0);
    const totalTrips = filteredRides.length;
    const avgRating = (() => {
        const rated = filteredRides.filter(r => r.rating);
        if (!rated.length) return null;
        return (rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length).toFixed(1);
    })();
    const totalWaitFees = filteredRides.reduce((s, r) => s + Number(r.wait_fee || 0), 0);

    const shareReferral = async () => {
        if (!profile?.referral_code) return;
        const text = `Únete a Higo con mi código ${profile.referral_code} y ambos ganamos $1 en tu primer viaje. https://higodriver.com`;
        if (navigator.share) {
            try { await navigator.share({ title: 'Higo App', text }); } catch (_) {}
        } else {
            await navigator.clipboard.writeText(text);
            alert('Mensaje copiado al portapapeles.');
        }
    };

    if (loading) {
        return <div className="h-screen flex items-center justify-center bg-[#0F1014] text-white">Cargando…</div>;
    }

    const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
    const periodLabel = { today: 'Hoy', week: 'Semana', month: 'Mes', all: 'Total' }[period];

    return (
        <div className="min-h-screen bg-[#0F1014] text-white pb-10">
            {/* Header */}
            <header className="sticky top-0 z-20 bg-[#0F1014]/95 backdrop-blur-md border-b border-white/5">
                <div className="px-4 py-4 flex items-center gap-3 max-w-2xl mx-auto">
                    <button onClick={() => navigate('/driver')} className="w-10 h-10 bg-[#1A1F2E] rounded-full flex items-center justify-center">
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <div>
                        <h1 className="text-xl font-bold">Mis Estadísticas</h1>
                        <p className="text-xs text-gray-500">{profile?.full_name || profile?.email}</p>
                    </div>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">

                {/* Period selector */}
                <div className="flex gap-2 bg-[#1A1F2E] p-1 rounded-2xl">
                    {[['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['all', 'Total']].map(([k, label]) => (
                        <button
                            key={k}
                            onClick={() => setPeriod(k)}
                            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${period === k ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Earnings hero */}
                <div className="bg-gradient-to-br from-emerald-600/20 to-blue-600/20 border border-emerald-500/30 rounded-3xl p-6 text-center">
                    <p className="text-emerald-300 text-xs font-bold tracking-wider uppercase mb-2">Ganancias · {periodLabel}</p>
                    <p className="text-5xl font-black text-white mb-2">{fmt(totalEarnings)}</p>
                    <p className="text-gray-400 text-sm">{totalTrips} {totalTrips === 1 ? 'viaje' : 'viajes'} completados</p>
                    {totalWaitFees > 0 && (
                        <p className="text-amber-300 text-xs mt-2">+ {fmt(totalWaitFees)} en cargos por espera</p>
                    )}
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#1A1F2E] rounded-2xl p-4 text-center">
                        <p className="text-2xl font-black">{totalTrips}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Viajes</p>
                    </div>
                    <div className="bg-[#1A1F2E] rounded-2xl p-4 text-center">
                        <p className="text-2xl font-black">{avgRating || '—'} <span className="text-yellow-400">★</span></p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Rating</p>
                    </div>
                    <div className="bg-[#1A1F2E] rounded-2xl p-4 text-center">
                        <p className="text-2xl font-black">{totalTrips > 0 ? fmt(totalEarnings / totalTrips) : '—'}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Promedio</p>
                    </div>
                </div>

                {/* Membership status */}
                <div className="bg-[#1A1F2E] rounded-2xl p-4 border border-white/5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-400 mb-1">Membresía</p>
                            <p className={`font-bold ${profile?.subscription_status === 'suspended' ? 'text-red-400' : 'text-emerald-400'}`}>
                                {profile?.subscription_status === 'suspended' ? 'Vencida' : 'Activa'}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-gray-400 mb-1">Último pago</p>
                            <p className="font-mono text-sm">
                                {profile?.last_payment_date ? new Date(profile.last_payment_date).toLocaleDateString() : '—'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Referral */}
                <div className="bg-gradient-to-br from-purple-600/15 to-pink-600/15 border border-purple-500/30 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <p className="text-xs text-purple-300 font-bold uppercase tracking-wider">Tu código</p>
                            <p className="text-2xl font-black text-white tracking-wider">{profile?.referral_code || '—'}</p>
                        </div>
                        <button
                            onClick={shareReferral}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-xl font-bold text-sm flex items-center gap-1 active:scale-95 transition-all"
                        >
                            <span className="material-symbols-outlined text-base">share</span>
                            Compartir
                        </button>
                    </div>
                    <p className="text-xs text-purple-200/70">
                        Crédito acumulado: <span className="text-white font-bold">{fmt(profile?.referral_credit_balance)}</span>
                    </p>
                </div>

                {/* History */}
                <div>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Historial reciente</h2>
                    {filteredRides.length === 0 ? (
                        <div className="bg-[#1A1F2E] rounded-2xl p-6 text-center text-gray-500">
                            No hay viajes en este periodo.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredRides.slice(0, 30).map(r => (
                                <div key={r.id} className="bg-[#1A1F2E] rounded-2xl p-4 flex items-start justify-between">
                                    <div className="flex-1 min-w-0 pr-3">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="material-symbols-outlined text-blue-400 text-base">
                                                {r.ride_type === 'moto' ? 'two_wheeler' : r.ride_type === 'van' ? 'airport_shuttle' : 'local_taxi'}
                                            </span>
                                            <span className="text-xs text-gray-500">
                                                {new Date(r.created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <p className="text-sm truncate">{r.dropoff || '—'}</p>
                                        {r.rating && <p className="text-xs text-yellow-400 mt-1">{'★'.repeat(r.rating)}</p>}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-emerald-400 font-bold">{fmt(r.price)}</p>
                                        {r.payment_confirmed_at && (
                                            <p className="text-[10px] text-emerald-500/70 mt-1">✓ Confirmado</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default DriverStatsPage;
