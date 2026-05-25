import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import AdminGuard from '../components/AdminGuard';
import InteractiveMap from '../components/InteractiveMap';

// Centro default del mapa: Higuerote, Miranda, VE. El mapa permite
// pan/zoom; este es solo el frame inicial.
const HIGUEROTE_CENTER = { lat: 10.4862, lng: -66.0944 };

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
        openDisputes: 0,
        shopStores: 0,
        shopRevenueToday: 0
    });

    const loadKpis = async () => {
        const since = new Date(Date.now() - DRIVER_ONLINE_STALE_MS).toISOString();
        const today = startOfToday();

        const [drivers, rides, revenue, disputes, stores, shopOrders] = await Promise.all([
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
            supabase
                .from('rides')
                .select('id', { count: 'exact', head: true })
                .is('payment_confirmed_at', null)
                .or('payment_reference.not.is.null,payment_confirmed_by_user.eq.true,payment_confirmed_by_driver.eq.true'),
            supabase
                .from('stores')
                .select('id', { count: 'exact', head: true }),
            supabase
                .from('orders')
                .select('total')
                .gte('created_at', today)
                .eq('status', 'DELIVERED')
        ]);

        const totalRevenue = (revenue.data || []).reduce(
            (sum, r) => sum + (Number(r.price) || 0),
            0
        );

        const totalShopRevenue = (shopOrders.data || []).reduce(
            (sum, o) => sum + (Number(o.total) || 0),
            0
        );

        setKpis({
            driversOnline: drivers.count || 0,
            ridesToday: rides.count || 0,
            revenueToday: totalRevenue,
            openDisputes: disputes.count || 0,
            shopStores: stores.count || 0,
            shopRevenueToday: totalShopRevenue
        });
        setLoading(false);
    };

    useEffect(() => {
        loadKpis();
        const ch = supabase.channel('admin-kpi-watch')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, loadKpis)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadKpis)
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
            <div className="max-w-6xl lg:max-w-7xl mx-auto px-4 py-6">
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

                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                    <div className="col-span-1">
                        <KpiCard
                            icon="directions_car"
                            label="Drivers online"
                            value={kpis.driversOnline}
                            accent="bg-green-600"
                            loading={loading}
                        />
                    </div>
                    <div className="col-span-1">
                        <KpiCard
                            icon="receipt_long"
                            label="Viajes hoy"
                            value={kpis.ridesToday}
                            accent="bg-blue-600"
                            loading={loading}
                        />
                    </div>
                    <div className="col-span-1">
                        <KpiCard
                            icon="attach_money"
                            label="Ingresos hoy"
                            value={`$${kpis.revenueToday.toFixed(2)}`}
                            accent="bg-violet-600"
                            loading={loading}
                        />
                    </div>
                    <div className="col-span-1">
                        <KpiCard
                            icon="report"
                            label="Disputas"
                            value={kpis.openDisputes}
                            accent="bg-red-600"
                            loading={loading}
                        />
                    </div>
                    <div className="col-span-1">
                        <KpiCard
                            icon="storefront"
                            label="Tiendas Shop"
                            value={kpis.shopStores}
                            accent="bg-orange-500"
                            loading={loading}
                        />
                    </div>
                    <div className="col-span-1">
                        <KpiCard
                            icon="shopping_bag"
                            label="Ventas Shop hoy"
                            value={`$${kpis.shopRevenueToday.toFixed(2)}`}
                            accent="bg-pink-500"
                            loading={loading}
                        />
                    </div>
                </div>

                {/* D.A1: Mapa realtime con drivers online. InteractiveMap
                    ya se suscribe a profiles UPDATE filtrado por role=driver
                    y mantiene drivers[] como state interno; renderiza
                    AnimatedVehicleMarker con heading. Acá lo embebemos sin
                    assignedDriver ni isDriver para que muestre TODA la flota
                    online. */}
                <section className="mb-8 bg-[#1A1F2E] rounded-2xl border border-white/5 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-green-400 text-[20px]">my_location</span>
                            <h2 className="font-bold text-sm">Flota en vivo</h2>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            {kpis.driversOnline} drivers · {kpis.ridesToday} viajes hoy
                        </div>
                    </div>
                    <div className="h-[420px] relative">
                        <InteractiveMap
                            center={HIGUEROTE_CENTER}
                            isDriver={false}
                            assignedDriver={null}
                            showPin={false}
                        />
                    </div>
                </section>

                <h2 className="text-lg font-bold mb-3">Accesos rápidos</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <NavTile to="/admin/drivers"   icon="directions_car" label="Conductores" description="Ver, activar, suspender y registrar drivers" />
                    <NavTile to="/admin/users"     icon="group"          label="Usuarios"    description="Listado y gestión de pasajeros" />
                    <NavTile to="/admin/shop"      icon="shopping_bag"   label="Higo Shop"   description="Auditar comercios, menús, productos y pedidos realtime" />
                    <NavTile to="/admin/pricing"   icon="payments"       label="Tarifas"     description="Precios base y por km por tipo de vehículo" />
                    <NavTile to="/admin/promos"    icon="local_offer"    label="Promos"      description="Códigos promocionales y referidos" />
                    <NavTile to="/admin/disputes"  icon="report"         label="Disputas"    description="Conflictos de pago entre driver y pasajero" />
                    <NavTile to="/admin/analytics" icon="bar_chart"      label="Analytics"   description="Viajes, ingresos y retención de usuarios" />
                    <NavTile to="/admin/zones"     icon="place"          label="Zonas"       description="Áreas de cobertura geográfica de Higo" />
                    <NavTile to="/admin/fraud"     icon="crisis_alert"   label="Fraud signals" description="Cancelaciones, ratings bajos, velocidades imposibles" />
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
