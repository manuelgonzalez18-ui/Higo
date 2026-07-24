import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import { getAdminDashboardMetrics } from '../services/adminApi';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const KPI = ({ icon, label, value, note, tone = 'bg-violet-600', alert = false }) => (
    <div className={`rounded-2xl border p-5 ${alert ? 'bg-red-500/10 border-red-500/30' : 'bg-[#1A1F2E] border-white/5'}`}>
        <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}>
                <span className="material-symbols-outlined text-white text-xl">{icon}</span>
            </div>
            <span className="text-sm font-medium text-gray-400">{label}</span>
        </div>
        <p className="text-3xl font-black text-white">{value}</p>
        {note && <p className="text-xs text-gray-500 mt-2">{note}</p>}
    </div>
);

const Action = ({ to, icon, title, detail, badge }) => (
    <Link to={to} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5 hover:border-violet-500/40 transition-colors flex gap-4">
        <div className="w-11 h-11 rounded-xl bg-violet-600/20 text-violet-400 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined">{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <p className="font-bold text-white">{title}</p>
                {badge > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500 text-white">{badge}</span>}
            </div>
            <p className="text-sm text-gray-400 mt-1">{detail}</p>
        </div>
        <span className="material-symbols-outlined text-gray-600">chevron_right</span>
    </Link>
);

export default function AdminDashboardPage() {
    const navigate = useNavigate();
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            setError('');
            setMetrics(await getAdminDashboardMetrics());
        } catch (err) {
            console.error('[AdminDashboard] metrics failed:', err);
            setError('No se pudieron cargar las métricas. No se mostrarán datos estimados.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        let timer;
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(load, 800);
        };
        const channel = supabase.channel('admin-business-metrics')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_memberships' }, schedule)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, schedule)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads' }, schedule)
            .subscribe();
        return () => { clearTimeout(timer); supabase.removeChannel(channel); };
    }, [load]);

    const logout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('session_id');
        navigate('/admin', { replace: true });
    };

    const m = metrics || {};

    return (
        <div className="min-h-screen bg-[#0F1419] text-white">
            <div className="max-w-7xl mx-auto px-4 py-6">
                <header className="flex items-start justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-black">Centro de control Higo</h1>
                        <p className="text-sm text-gray-400 mt-1">Ingresos propios por membresías, operación y asuntos pendientes.</p>
                    </div>
                    <button onClick={logout} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 flex items-center gap-2">
                        <span className="material-symbols-outlined text-lg">logout</span> Salir
                    </button>
                </header>

                <AdminNav />

                {error && <div className="mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300">{error}</div>}
                {loading ? (
                    <div className="py-28 flex justify-center"><div className="w-9 h-9 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : (
                    <>
                        <section className="mb-8">
                            <div className="flex items-end justify-between mb-3 gap-4">
                                <div>
                                    <h2 className="font-bold text-lg">Negocio de membresías</h2>
                                    <p className="text-xs text-gray-500">La única fuente de ingreso mostrada aquí son pagos de membresías de Higo Drivers.</p>
                                </div>
                                <Link to="/admin/drivers" className="text-sm font-bold text-violet-400 hover:text-violet-300">Gestionar membresías →</Link>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <KPI icon="payments" label="Ingresos hoy" value={money(m.membershipRevenueToday)} note="Membresías registradas hoy" tone="bg-emerald-600" />
                                <KPI icon="calendar_month" label="Ingresos del mes" value={money(m.membershipRevenueMonth)} note="Sin incluir valor de viajes" tone="bg-teal-600" />
                                <KPI icon="verified" label="Membresías vigentes" value={m.activeMemberships || 0} note={`${m.expiringSoon || 0} vencen en 7 días`} tone="bg-blue-600" />
                                <KPI icon="event_busy" label="Vencidas o faltantes" value={m.expiredMemberships || 0} note="Requieren renovación o revisión" tone="bg-amber-600" />
                            </div>
                        </section>

                        <section className="mb-8">
                            <h2 className="font-bold text-lg mb-3">Operación</h2>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <KPI icon="directions_car" label="Drivers online" value={m.driversOnline || 0} tone="bg-green-600" />
                                <KPI icon="route" label="Viajes hoy" value={m.ridesToday || 0} tone="bg-sky-600" />
                                <KPI icon="currency_exchange" label="Volumen transado" value={money(m.tripVolumeToday)} note="Pago pasajero → driver; no es ingreso de Higo" tone="bg-indigo-600" />
                                <KPI icon="warning" label="Activos sin membresía" value={m.activeWithoutMembership || 0} note="Inconsistencia que debe corregirse" tone="bg-red-600" alert={(m.activeWithoutMembership || 0) > 0} />
                            </div>
                        </section>

                        <section>
                            <h2 className="font-bold text-lg mb-3">Pendientes prioritarios</h2>
                            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                                <Action to="/admin/drivers" icon="badge" title="Membresías y drivers" detail="Renovar, revisar vencimientos, documentos y excepciones auditadas." badge={m.expiredMemberships || 0} />
                                <Action to="/admin/support" icon="support_agent" title="Soporte" detail="Conversaciones abiertas y emergencias SOS." badge={m.supportUnread || 0} />
                                <Action to="/admin/disputes" icon="report" title="Disputas" detail="Pagos entre pasajero y driver pendientes de resolución." badge={m.openDisputes || 0} />
                                <Action to="/admin/deliveries" icon="inventory_2" title="Operación de envíos" detail="Seguimiento, evidencia y reclamos de entregas." />
                                <Action to="/admin/analytics" icon="monitoring" title="Analítica del negocio" detail="Renovación, ingreso medio, membresías y volumen de viajes separados." />
                                <Action to="/admin/pricing" icon="tune" title="Configuración operativa" detail="Tarifas sugeridas, reglas y zonas de cobertura." />
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
}
