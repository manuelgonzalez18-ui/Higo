import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import AdminGuard from '../components/AdminGuard';

// Fraud signals panel (Fase 11 D.A3).
// Lee la materialized view fraud_signals via RPC get_fraud_signals
// (la RPC valida is_admin server-side; SELECT directo a la MV está
// revoked). El refresh es manual via RPC refresh_fraud_signals — un
// admin lo dispara antes de revisar para tener data fresca.
//
// Heurísticas en mig 44:
//   - multiple_cancellations (passenger): 3+ rides cancelados sin
//     ningún ride completado en 30 días.
//   - low_rating (driver): avg rating < 3 con >= 5 rides en 60 días.
//   - impossible_speed (ride): velocidad promedio > 150 km/h.

const SIGNAL_LABELS = {
    multiple_cancellations: { label: 'Cancelaciones excesivas', icon: 'cancel',     color: 'text-rose-400' },
    low_rating:             { label: 'Rating bajo sostenido',   icon: 'star',       color: 'text-amber-400' },
    impossible_speed:       { label: 'Velocidad imposible',     icon: 'speed',      color: 'text-red-400' },
};
const SEVERITY_CLS = {
    high:   'bg-rose-500/15 text-rose-300 border-rose-500/40',
    medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    low:    'bg-gray-500/15 text-gray-300 border-gray-500/40',
};
const SUBJECT_LABELS = {
    passenger: 'Pasajero',
    driver:    'Conductor',
    ride:      'Viaje',
};

const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-VE', {
        day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit',
    });
};

const FraudPanel = () => {
    const navigate = useNavigate();
    const [signals, setSignals] = useState([]);
    const [profilesMap, setProfilesMap] = useState({}); // uid → profile
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState('all'); // all | passenger | driver | ride
    const [computedAt, setComputedAt] = useState(null);

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_fraud_signals');
        if (error) {
            console.error('get_fraud_signals failed:', error);
            setSignals([]);
            setLoading(false);
            return;
        }
        const rows = data || [];
        setSignals(rows);
        setComputedAt(rows[0]?.computed_at || null);

        // Hidratar nombres de subject_id para passenger/driver vía
        // get_public_profile (mig 34) — la RLS de profiles bloquea
        // el SELECT directo. ride no necesita hidratación.
        const uids = [...new Set(
            rows.filter(s => s.subject_type !== 'ride')
                .map(s => s.subject_id)
        )];
        const map = {};
        await Promise.all(uids.map(async (uid) => {
            const { data: p } = await supabase.rpc('get_public_profile', { p_id: uid });
            if (p?.[0]) map[uid] = p[0];
        }));
        setProfilesMap(map);
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const refresh = async () => {
        setRefreshing(true);
        const { error } = await supabase.rpc('refresh_fraud_signals');
        if (error) {
            alert(`Error refrescando: ${error.message}`);
            setRefreshing(false);
            return;
        }
        await load();
        setRefreshing(false);
    };

    const filtered = filter === 'all'
        ? signals
        : signals.filter(s => s.subject_type === filter);

    const countBy = {
        all:       signals.length,
        passenger: signals.filter(s => s.subject_type === 'passenger').length,
        driver:    signals.filter(s => s.subject_type === 'driver').length,
        ride:      signals.filter(s => s.subject_type === 'ride').length,
    };

    return (
        <div className="min-h-screen bg-[#0F1014] text-white">
            <div className="max-w-6xl lg:max-w-7xl mx-auto px-4 py-6">
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate('/admin/dashboard')}
                            className="w-10 h-10 rounded-full bg-[#1A1F2E] flex items-center justify-center hover:bg-[#252A3A]"
                            aria-label="Volver"
                        >
                            <span className="material-symbols-outlined">arrow_back</span>
                        </button>
                        <div>
                            <h1 className="text-2xl font-extrabold flex items-center gap-2">
                                <span className="material-symbols-outlined text-rose-400">crisis_alert</span>
                                Fraud signals
                            </h1>
                            <p className="text-xs text-gray-500">
                                {computedAt ? `Última actualización: ${fmtDate(computedAt)}` : 'Sin datos todavía. Refrescá para calcular.'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={refresh}
                        disabled={refreshing}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-bold"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${refreshing ? 'animate-spin' : ''}`}>
                            {refreshing ? 'progress_activity' : 'refresh'}
                        </span>
                        {refreshing ? 'Refrescando…' : 'Refrescar señales'}
                    </button>
                </div>

                <AdminNav />

                <div className="flex gap-2 my-4 overflow-x-auto">
                    {[
                        { id: 'all',       label: 'Todas' },
                        { id: 'passenger', label: 'Pasajeros' },
                        { id: 'driver',    label: 'Conductores' },
                        { id: 'ride',      label: 'Viajes' },
                    ].map(t => (
                        <button
                            key={t.id}
                            onClick={() => setFilter(t.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                                filter === t.id
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-[#1A1F2E] text-gray-400 hover:text-white'
                            }`}
                        >
                            {t.label}
                            <span className={`ml-1 ${filter === t.id ? 'text-rose-100' : 'text-gray-500'}`}>
                                ({countBy[t.id]})
                            </span>
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-8 h-8 border-4 border-rose-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                        <span className="material-symbols-outlined text-emerald-400 text-5xl">verified_user</span>
                        <p className="mt-3 font-medium text-emerald-300">Sin señales en esta categoría.</p>
                        <p className="text-xs text-gray-500 mt-1">
                            Si esperabas resultados, asegurate de haber refrescado la vista materializada.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {filtered.map((s, i) => {
                            const sig = SIGNAL_LABELS[s.signal] || { label: s.signal, icon: 'warning', color: 'text-gray-400' };
                            const sevCls = SEVERITY_CLS[s.severity] || SEVERITY_CLS.low;
                            const subject = s.subject_type !== 'ride' ? profilesMap[s.subject_id] : null;
                            const subjectLabel = SUBJECT_LABELS[s.subject_type] || s.subject_type;
                            return (
                                <li key={`${s.subject_type}-${s.subject_id}-${s.signal}-${i}`}
                                    className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 flex items-start gap-3"
                                >
                                    <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0 ${sig.color}`}>
                                        <span className="material-symbols-outlined text-[20px]">{sig.icon}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{subjectLabel}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${sevCls}`}>
                                                {s.severity}
                                            </span>
                                            <p className="font-bold text-sm">{sig.label}</p>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1 truncate">
                                            {s.subject_type === 'ride'
                                                ? `Ride #${s.subject_id} · ${s.metadata?.pickup || ''} → ${s.metadata?.dropoff || ''}`
                                                : (subject?.full_name || s.subject_id)}
                                        </p>
                                        <div className="mt-2 flex gap-3 text-[11px] text-gray-300 flex-wrap">
                                            {Object.entries(s.metadata || {}).map(([k, v]) => {
                                                if (k === 'pickup' || k === 'dropoff') return null;
                                                return (
                                                    <span key={k} className="bg-white/5 px-2 py-0.5 rounded font-mono">
                                                        {k}: {typeof v === 'number' ? v.toLocaleString() : String(v)}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    {s.subject_type === 'driver' && (
                                        <button
                                            onClick={() => navigate(`/admin/drivers?focus=${s.subject_id}`)}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 shrink-0"
                                        >
                                            Ver chofer
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

const AdminFraudPage = () => (
    <AdminGuard>
        <FraudPanel />
    </AdminGuard>
);

export default AdminFraudPage;
