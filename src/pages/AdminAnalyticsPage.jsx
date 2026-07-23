import React, { useEffect, useMemo, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { getAdminAnalytics } from '../services/adminApi';

const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const fmtDay = (value) => {
    const date = new Date(`${value}T00:00:00`);
    return date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
};

const Card = ({ label, value, note, icon, tone }) => (
    <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3"><div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}><span className="material-symbols-outlined">{icon}</span></div><p className="text-sm text-gray-400">{label}</p></div>
        <p className="text-2xl font-black">{value}</p>{note && <p className="text-xs text-gray-500 mt-2">{note}</p>}
    </div>
);

const Bars = ({ title, subtitle, rows, valueKey, label, tone = 'bg-violet-500' }) => {
    const max = Math.max(...rows.map(r => Number(r[valueKey] || 0)), 1);
    return (
        <section className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5">
            <h2 className="font-bold">{title}</h2><p className="text-xs text-gray-500 mt-1 mb-5">{subtitle}</p>
            <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {rows.map(row => {
                    const value = Number(row[valueKey] || 0);
                    const pct = Math.max(value > 0 ? 2 : 0, (value / max) * 100);
                    return <div key={row.day} className="grid grid-cols-[48px_1fr_82px] gap-3 items-center"><span className="text-[10px] text-gray-500 text-right">{fmtDay(row.day)}</span><div className="h-6 bg-[#0F1014] rounded-full overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div><span className="text-xs text-right font-mono text-gray-300">{label(value, row)}</span></div>;
                })}
            </div>
        </section>
    );
};

export default function AdminAnalyticsPage() {
    const [range, setRange] = useState(30);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError('');
        getAdminAnalytics(range).then(result => { if (!cancelled) setData(result); }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [range]);

    const membershipRows = useMemo(() => data?.membershipDaily || [], [data]);
    const tripRows = useMemo(() => data?.tripDaily || [], [data]);

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
                <div><h1 className="text-2xl font-black">Analítica del negocio</h1><p className="text-sm text-gray-400 mt-1">Ingresos de membresías y volumen de viajes se reportan por separado.</p></div>
                <div className="flex p-1 bg-[#1A1F2E] rounded-xl border border-white/5">{[7,30,90].map(days => <button key={days} onClick={() => setRange(days)} className={`px-4 py-2 rounded-lg text-sm font-bold ${range === days ? 'bg-violet-600' : 'text-gray-400'}`}>{days}d</button>)}</div>
            </div>
            {error && <div className="p-4 mb-5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">No se pudieron calcular las métricas: {error}</div>}
            {loading ? <div className="py-28 flex justify-center"><div className="w-9 h-9 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div> : data && <div className="space-y-7">
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                    <Card label="Ingresos por membresías" value={money(data.membershipRevenue)} note={`${data.payments || 0} pagos registrados`} icon="payments" tone="bg-emerald-600" />
                    <Card label="Drivers que pagaron" value={data.payingDrivers || 0} note={`Promedio ${money(data.averageRevenuePerDriver)}`} icon="badge" tone="bg-blue-600" />
                    <Card label="Tasa de renovación" value={`${Number(data.renewalRate || 0).toFixed(1)}%`} note="Drivers con más de un pago en el período" icon="autorenew" tone="bg-violet-600" />
                    <Card label="Membresías vigentes" value={data.activeMemberships || 0} note="Incluye por vencer y excepciones temporales" icon="verified" tone="bg-teal-600" />
                </div>
                <div className="grid xl:grid-cols-2 gap-5">
                    <Bars title="Ingreso diario de Higo" subtitle="Solo pagos de membresías de Higo Drivers." rows={membershipRows} valueKey="revenue" label={(v, row) => `${money(v)} · ${row.payments || 0}`} tone="bg-emerald-500" />
                    <Bars title="Volumen de viajes" subtitle="Dinero pagado entre pasajeros y drivers. No es ingreso de Higo." rows={tripRows} valueKey="volume" label={(v, row) => `${money(v)} · ${row.rides || 0}`} tone="bg-blue-500" />
                </div>
                <section className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-5">
                    <div className="flex gap-3"><span className="material-symbols-outlined text-amber-400">info</span><div><p className="font-bold text-amber-200">Lectura financiera correcta</p><p className="text-sm text-amber-100/70 mt-1">Higo no cobra comisión por los viajes. El valor mostrado como volumen de viajes pertenece a la relación pasajero–driver. Los ingresos propios del negocio se calculan desde las membresías.</p></div></div>
                </section>
            </div>}
        </div>
    );
}
