import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

// Barra simple con porcentaje relativo al máximo del dataset
const Bar = ({ value, max, color = 'bg-blue-500', label, sub }) => {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="flex items-center gap-3">
            <div className="w-16 text-right shrink-0">
                <p className="text-[10px] text-gray-500 truncate">{label}</p>
            </div>
            <div className="flex-1 bg-[#0F1014] rounded-full h-6 overflow-hidden">
                <div className={`h-full ${color} rounded-full flex items-center px-2 transition-all duration-500`} style={{ width: `${Math.max(pct, 2)}%` }}>
                    <span className="text-[10px] font-bold text-white/80 whitespace-nowrap">{sub}</span>
                </div>
            </div>
        </div>
    );
};

const KpiTile = ({ label, value, icon, accent }) => (
    <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
            <span className="material-symbols-outlined text-white text-xl">{icon}</span>
        </div>
        <div>
            <p className="text-xs text-gray-400">{label}</p>
            <p className="text-xl font-black text-white">{value}</p>
        </div>
    </div>
);

const AdminAnalyticsPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState(30); // días
    const [dailyRides, setDailyRides] = useState([]);
    const [weeklyUsers, setWeeklyUsers] = useState([]);
    const [kpis, setKpis] = useState({ totalRides: 0, totalRevenue: 0, retentionPct: 0, activeDrivers: 0 });

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') { navigate('/'); return; }
            setAuthorized(true);
        })();
    }, [navigate]);

    useEffect(() => {
        if (!authorized) return;
        loadAnalytics();
    }, [authorized, range]);

    const loadAnalytics = async () => {
        setLoading(true);
        const since = new Date(Date.now() - range * 86400e3).toISOString();

        const [ridesRes, usersRes, activeDriversRes, allRidesForRetention] = await Promise.all([
            // Todos los viajes del periodo para agrupar por día en JS
            supabase.from('rides').select('created_at, price, payment_confirmed_at').gte('created_at', since),
            // Usuarios pasajeros del periodo
            supabase.from('profiles').select('created_at').eq('role', 'passenger').gte('created_at', since),
            // Conductores activos
            supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'driver').eq('subscription_status', 'active'),
            // Para retención: cuántos pasajeros tienen más de 1 viaje
            supabase.from('rides').select('user_id'),
        ]);

        // Agrupar viajes por día
        const byDay = {};
        for (const r of ridesRes.data || []) {
            const day = r.created_at?.slice(0, 10);
            if (!day) continue;
            if (!byDay[day]) byDay[day] = { trips: 0, revenue: 0 };
            byDay[day].trips++;
            if (r.payment_confirmed_at) byDay[day].revenue += Number(r.price || 0);
        }
        // Llenar días vacíos en el rango
        const daysList = [];
        for (let i = range - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
            daysList.push({ day: d, trips: byDay[d]?.trips || 0, revenue: byDay[d]?.revenue || 0 });
        }
        setDailyRides(daysList);

        // Agrupar usuarios nuevos por semana
        const byWeek = {};
        for (const u of usersRes.data || []) {
            const d = new Date(u.created_at);
            // Lunes de la semana
            const monday = new Date(d);
            monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            const key = monday.toISOString().slice(0, 10);
            byWeek[key] = (byWeek[key] || 0) + 1;
        }
        const weeksList = Object.entries(byWeek)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-8)
            .map(([week, count]) => ({ week, count }));
        setWeeklyUsers(weeksList);

        // KPIs globales
        const totalRides = (ridesRes.data || []).length;
        const totalRevenue = (ridesRes.data || []).reduce((s, r) => s + (r.payment_confirmed_at ? Number(r.price || 0) : 0), 0);

        // Retención: % pasajeros con más de 1 viaje
        const rideCounts = {};
        for (const r of allRidesForRetention.data || []) {
            rideCounts[r.user_id] = (rideCounts[r.user_id] || 0) + 1;
        }
        const unique = Object.keys(rideCounts).length;
        const returning = Object.values(rideCounts).filter(c => c > 1).length;
        const retentionPct = unique > 0 ? Math.round((returning / unique) * 100) : 0;

        setKpis({ totalRides, totalRevenue, retentionPct, activeDrivers: activeDriversRes.count || 0 });
        setLoading(false);
    };

    if (!authorized) return (
        <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    const maxTrips = Math.max(...dailyRides.map(d => d.trips), 1);
    const maxRevenue = Math.max(...dailyRides.map(d => d.revenue), 1);
    const maxWeek = Math.max(...weeklyUsers.map(w => w.count), 1);

    const fmtDay = (iso) => {
        const [, m, d] = iso.split('-');
        return `${d}/${m}`;
    };
    const fmtWeek = (iso) => {
        const [, m, d] = iso.split('-');
        return `${d}/${m}`;
    };

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-3 rounded-2xl shadow-lg shadow-blue-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">bar_chart</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Analytics</h1>
                        <p className="text-gray-400 text-sm">Métricas de viajes y retención</p>
                    </div>
                </div>
                {/* Selector de rango */}
                <div className="flex gap-1 bg-[#1A1F2E] p-1 rounded-xl border border-white/5">
                    {[[7, '7d'], [30, '30d'], [90, '90d']].map(([days, label]) => (
                        <button
                            key={days}
                            onClick={() => setRange(days)}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${range === days ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-32">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* KPI tiles */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KpiTile label={`Viajes (${range}d)`} value={kpis.totalRides} icon="receipt_long" accent="bg-blue-600" />
                        <KpiTile label="Ingresos confirmados" value={`$${kpis.totalRevenue.toFixed(2)}`} icon="attach_money" accent="bg-emerald-600" />
                        <KpiTile label="Retención global" value={`${kpis.retentionPct}%`} icon="repeat" accent="bg-violet-600" />
                        <KpiTile label="Conductores activos" value={kpis.activeDrivers} icon="directions_car" accent="bg-amber-600" />
                    </div>

                    {/* Viajes por día */}
                    <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Viajes por día</h2>
                        <div className="space-y-1.5">
                            {dailyRides.filter(d => d.trips > 0 || dailyRides.indexOf(d) % Math.ceil(range / 15) === 0).map(d => (
                                <Bar
                                    key={d.day}
                                    value={d.trips}
                                    max={maxTrips}
                                    color="bg-blue-500"
                                    label={fmtDay(d.day)}
                                    sub={d.trips > 0 ? `${d.trips} viaje${d.trips !== 1 ? 's' : ''}` : '0'}
                                />
                            ))}
                        </div>
                        {dailyRides.every(d => d.trips === 0) && (
                            <p className="text-center text-gray-500 text-sm py-6">Sin viajes en este período.</p>
                        )}
                    </div>

                    {/* Ingresos por día */}
                    <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Ingresos confirmados por día</h2>
                        <div className="space-y-1.5">
                            {dailyRides.filter(d => d.revenue > 0 || dailyRides.indexOf(d) % Math.ceil(range / 15) === 0).map(d => (
                                <Bar
                                    key={d.day}
                                    value={d.revenue}
                                    max={maxRevenue}
                                    color="bg-emerald-500"
                                    label={fmtDay(d.day)}
                                    sub={d.revenue > 0 ? `$${d.revenue.toFixed(2)}` : '$0'}
                                />
                            ))}
                        </div>
                        {dailyRides.every(d => d.revenue === 0) && (
                            <p className="text-center text-gray-500 text-sm py-6">Sin ingresos confirmados en este período.</p>
                        )}
                    </div>

                    {/* Nuevos usuarios por semana */}
                    <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Nuevos pasajeros por semana</h2>
                        {weeklyUsers.length === 0 ? (
                            <p className="text-center text-gray-500 text-sm py-6">Sin registros nuevos en este período.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {weeklyUsers.map(w => (
                                    <Bar
                                        key={w.week}
                                        value={w.count}
                                        max={maxWeek}
                                        color="bg-violet-500"
                                        label={`sem ${fmtWeek(w.week)}`}
                                        sub={`${w.count} usuario${w.count !== 1 ? 's' : ''}`}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminAnalyticsPage;
