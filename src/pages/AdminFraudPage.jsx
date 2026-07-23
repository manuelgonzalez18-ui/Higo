import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import { toast } from '../components/Toast';

const LABELS = {
    multiple_cancellations: ['Cancelaciones excesivas', 'cancel', 'text-rose-400'],
    low_rating: ['Rating bajo sostenido', 'star', 'text-amber-400'],
    impossible_speed: ['Velocidad imposible', 'speed', 'text-red-400'],
};
const SEVERITY = {
    high: 'bg-red-500/15 text-red-300 border-red-500/30',
    medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    low: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
};
const PAGE = 50;

export default function AdminFraudPage() {
    const navigate = useNavigate();
    const [signals, setSignals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState('all');
    const [visible, setVisible] = useState(PAGE);

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('admin_get_fraud_signals_v2');
        if (error) toast.error(error.message);
        setSignals(data || []);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);
    useEffect(() => { setVisible(PAGE); }, [filter]);

    const refresh = async () => {
        setRefreshing(true);
        const { error } = await supabase.rpc('refresh_fraud_signals');
        if (error) toast.error(error.message);
        else await load();
        setRefreshing(false);
    };

    const filtered = useMemo(() => filter === 'all' ? signals : signals.filter(s => s.subject_type === filter), [signals, filter]);
    const counts = useMemo(() => ({
        all: signals.length,
        passenger: signals.filter(s => s.subject_type === 'passenger').length,
        driver: signals.filter(s => s.subject_type === 'driver').length,
        ride: signals.filter(s => s.subject_type === 'ride').length,
    }), [signals]);

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
                <div><h1 className="text-2xl font-black">Alertas operativas</h1><p className="text-sm text-gray-400 mt-1">Señales calculadas en lote, con perfiles resueltos en una sola consulta.</p></div>
                <button onClick={refresh} disabled={refreshing} className="px-4 py-3 rounded-xl bg-red-600 disabled:opacity-50 font-bold flex items-center gap-2"><span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`}>refresh</span>{refreshing ? 'Actualizando…' : 'Recalcular señales'}</button>
            </div>

            <div className="flex gap-2 mb-5 overflow-x-auto">{[['all','Todas'],['passenger','Pasajeros'],['driver','Drivers'],['ride','Viajes']].map(([id,label]) => <button key={id} onClick={() => setFilter(id)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${filter === id ? 'bg-red-600' : 'bg-[#1A1F2E] text-gray-400'}`}>{label} ({counts[id]})</button>)}</div>

            {loading ? <div className="py-24 flex justify-center"><div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" /></div> : <div className="space-y-3">{filtered.slice(0, visible).map((item, index) => {
                const [label, icon, tone] = LABELS[item.signal] || [item.signal, 'warning', 'text-gray-400'];
                return <article key={`${item.subject_type}-${item.subject_id}-${item.signal}-${index}`} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 flex gap-4 items-start">
                    <div className={`w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0 ${tone}`}><span className="material-symbols-outlined">{icon}</span></div>
                    <div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{item.subject_type}</span><span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEVERITY[item.severity] || SEVERITY.low}`}>{item.severity}</span><p className="font-bold">{label}</p></div><p className="text-sm text-gray-400 mt-1 truncate">{item.subject_name || (item.subject_type === 'ride' ? `Viaje #${item.subject_id}` : item.subject_id)}{item.subject_phone ? ` · ${item.subject_phone}` : ''}</p><div className="flex flex-wrap gap-2 mt-3">{Object.entries(item.metadata || {}).map(([key,value]) => <span key={key} className="text-[10px] font-mono px-2 py-1 rounded bg-[#0F1014] text-gray-400">{key}: {String(value)}</span>)}</div></div>
                    {item.subject_type === 'driver' && <button onClick={() => navigate(`/admin/drivers?focus=${item.subject_id}`)} className="px-3 py-2 rounded-lg bg-white/5 text-xs font-bold">Ver driver</button>}
                </article>;
            })}{!filtered.length && <div className="py-20 text-center rounded-2xl bg-[#1A1F2E] border border-dashed border-white/10 text-emerald-300"><span className="material-symbols-outlined text-5xl">verified_user</span><p className="mt-2">Sin alertas en esta categoría.</p></div>}{visible < filtered.length && <div className="text-center pt-4"><button onClick={() => setVisible(v => v + PAGE)} className="px-6 py-3 rounded-full bg-[#1A1F2E] border border-white/10 text-sm font-bold">Ver más ({filtered.length - visible})</button></div>}</div>}
        </div>
    );
}
