import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import AdminGuard from '../components/AdminGuard';

// Criterio para considerar un driver "online" en vivo: status=online Y
// actualización de ubicación reciente. 90s es el mismo umbral que usa
// InteractiveMap para no pintar fantasmas en el mapa.
const DRIVER_ONLINE_STALE_MS = 90_000;

const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
};

const KpiCard = ({ icon, label, value, accent, loading }) => (
    <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
        <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
                <span className="material-symbols-outlined text-white text-xl">{icon}</span>
            </div>
            <span className="text-sm font-medium text-gray-400">{label}</span>
        </div>
        <div className="text-3xl font-extrabold text-white">
            {loading ? <span className="text-gray-600">--</span> : value}
        </div>
    </div>
);

const NavTile = ({ to, icon, label, description }) => (
    <Link
        to={to}
        className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5 hover:border-violet-500/40 hover:bg-[#1E2338] transition-all group"
    >
        <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-violet-600/20 flex items-center justify-center shrink-0 group-hover:bg-violet-600/30 transition-colors">
                <span className="material-symbols-outlined text-violet-400 text-2xl">{icon}</span>
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-bold text-white mb-1">{label}</div>
                <div className="text-sm text-gray-400">{description}</div>
            </div>
            <span className="material-symbols-outlined text-gray-600 group-hover:text-violet-400 transition-colors">chevron_right</span>
        </div>
    </Link>
);

const AdminDashboardContent = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState({
        driversOnline: 0,
        ridesToday: 0,
        revenueToday: 0,
        openDisputes: 0
    });

    const loadKpis = async () => {
        const since = new Date(Date.now() - DRIVER_ONLINE_STALE_MS).toISOString();
        const today = startOfToday();

        const [drivers, rides, revenue, disputes] = await Promise.all([
            supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .eq('role', 'driver')
                .eq('status', 'online')
                .gt('updated_at', since),
            supabase
                .from('rides')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', today),
            supabase
                .from('rides')
                .select('price')
                .gte('created_at', today)
                .not('payment_confirmed_at', 'is', null),
            // Disputas pendientes: mismo criterio que AdminDisputesPage
            // (pago marcado por una parte pero no cerrado bilateralmente).
            supabase
                .from('rides')
                .select('id', { count: 'exact', head: true })
                .is('payment_confirmed_at', null)
                .or('payment_reference.not.is.null,payment_confirmed_by_user.eq.true,payment_confirmed_by_driver.eq.true')
        ]);

        const totalRevenue = (revenue.data || []).reduce(
            (sum, r) => sum + (Number(r.price) || 0),
            0
        );

        setKpis({
            driversOnline: drivers.count || 0,
            ridesToday: rides.count || 0,
            revenueToday: totalRevenue,
            openDisputes: disputes.count || 0
        });
        setLoading(false);
    };

    useEffect(() => {
        loadKpis();
        const ch = supabase.channel('admin-kpi-watch')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, loadKpis)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, loadKpis)
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('session_id');
        navigate('/admin', { replace: true });
    };

    return (
        <div className="min-h-screen bg-[#0F1419] text-white">
            <div className="max-w-6xl mx-auto px-4 py-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-extrabold">Panel Admin</h1>
                        <p className="text-sm text-gray-400">Resumen general de Higo</p>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">logout</span>
                        Cerrar sesión
                    </button>
                </div>

                <AdminNav />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <KpiCard
                        icon="directions_car"
                        label="Drivers online"
                        value={kpis.driversOnline}
                        accent="bg-green-600"
                        loading={loading}
                    />
                    <KpiCard
                        icon="receipt_long"
                        label="Viajes hoy"
                        value={kpis.ridesToday}
                        accent="bg-blue-600"
                        loading={loading}
                    />
                    <KpiCard
                        icon="attach_money"
                        label="Ingresos hoy"
                        value={`$${kpis.revenueToday.toFixed(2)}`}
                        accent="bg-violet-600"
                        loading={loading}
                    />
                    <KpiCard
                        icon="report"
                        label="Disputas abiertas"
                        value={kpis.openDisputes}
                        accent="bg-red-600"
                        loading={loading}
                    />
                </div>

                <h2 className="text-lg font-bold mb-3">Accesos rápidos</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <NavTile to="/admin/drivers"   icon="directions_car" label="Conductores" description="Ver, activar, suspender y registrar drivers" />
                    <NavTile to="/admin/users"     icon="group"          label="Usuarios"    description="Listado y gestión de pasajeros" />
                    <NavTile to="/admin/pricing"   icon="payments"       label="Tarifas"     description="Precios base y por km por tipo de vehículo" />
                    <NavTile to="/admin/promos"    icon="local_offer"    label="Promos"      description="Códigos promocionales y referidos" />
                    <NavTile to="/admin/disputes"  icon="report"         label="Disputas"    description="Conflictos de pago entre driver y pasajero" />
                    <NavTile to="/admin/analytics" icon="bar_chart"      label="Analytics"   description="Viajes, ingresos y retención de usuarios" />
                    <NavTile to="/admin/zones"     icon="place"          label="Zonas"       description="Áreas de cobertura geográfica de Higo" />
                </div>
            </div>
        </div>
    );
};

const AdminDashboardPage = () => (
    <AdminGuard>
        <AdminDashboardContent />
    </AdminGuard>
);

export default AdminDashboardPage;
