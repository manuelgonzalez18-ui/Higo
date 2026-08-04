import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { toast } from '../components/Toast';
import { supabase } from '../services/supabase';
import { resolveEffectiveRideMultiplier } from '../utils/pricingPresentation';
import {
    getAdminRideDetail,
    getAdminRideMetrics,
    listAdminRides,
    overrideAdminRideStatus,
} from '../services/adminApi';

const STATUS_FILTERS = [
    { id: 'active', label: 'Activos', icon: 'radio_button_checked' },
    { id: 'completed', label: 'Completados', icon: 'check_circle' },
    { id: 'cancelled', label: 'Cancelados', icon: 'cancel' },
    { id: 'all', label: 'Todos', icon: 'list' },
];

const STATUS_LABELS = {
    requested: 'Buscando driver',
    accepted: 'Aceptado',
    in_progress: 'En curso',
    arrived_at_dropoff: 'En destino',
    completed: 'Completado',
    cancelled: 'Cancelado',
};

const STATUS_COLORS = {
    requested: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
    accepted: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    in_progress: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    arrived_at_dropoff: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    cancelled: 'bg-red-500/15 text-red-300 border-red-500/25',
};

const VEHICLE_OPTIONS = [
    ['', 'Todos los vehículos'],
    ['moto', 'Moto'],
    ['standard', 'Carro'],
    ['van', 'Camioneta'],
];

const PAGE_SIZE = 50;
const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const fmtDate = (value) => value
    ? new Date(value).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
const fmtDuration = (seconds) => {
    const value = Number(seconds || 0);
    if (!value) return '—';
    if (value < 60) return `${Math.round(value)} s`;
    const minutes = Math.round(value / 60);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
const localDate = (date) => {
    const copy = new Date(date);
    const offset = copy.getTimezoneOffset() * 60000;
    return new Date(copy.getTime() - offset).toISOString().slice(0, 10);
};
const startOfLocalDay = (value) => value ? new Date(`${value}T00:00:00`).toISOString() : null;
const endOfLocalDayExclusive = (value) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + 1);
    return date.toISOString();
};
const presetDates = (preset) => {
    if (preset === 'all') return { from: '', to: '' };
    const now = new Date();
    const from = new Date(now);
    if (preset === 'today') from.setHours(0, 0, 0, 0);
    if (preset === '7d') from.setDate(from.getDate() - 6);
    if (preset === '30d') from.setDate(from.getDate() - 29);
    return { from: localDate(from), to: localDate(now) };
};

const MetricCard = ({ label, value, note, icon, tone }) => (
    <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 min-w-0">
        <div className="flex items-center gap-2 text-gray-400 text-xs font-bold">
            <span className={`material-symbols-outlined text-[18px] ${tone}`}>{icon}</span>
            <span className="truncate">{label}</span>
        </div>
        <p className="text-xl font-black mt-2 truncate">{value}</p>
        {note && <p className="text-[10px] text-gray-500 mt-1">{note}</p>}
    </div>
);

const InfoBlock = ({ title, children, tone = 'text-violet-300' }) => (
    <section className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4">
        <h3 className={`text-[11px] uppercase tracking-[0.16em] font-black mb-3 ${tone}`}>{title}</h3>
        {children}
    </section>
);

const Row = ({ label, value, mono = false }) => (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-white/5 last:border-0">
        <span className="text-xs text-gray-500">{label}</span>
        <span className={`text-xs text-right break-all ${mono ? 'font-mono' : 'text-gray-200'}`}>{value ?? '—'}</span>
    </div>
);

export default function AdminRidesPage() {
    const initialDates = useMemo(() => presetDates('30d'), []);
    const [status, setStatus] = useState('active');
    const [preset, setPreset] = useState('30d');
    const [dateFrom, setDateFrom] = useState(initialDates.from);
    const [dateTo, setDateTo] = useState(initialDates.to);
    const [vehicleType, setVehicleType] = useState('');
    const [promoFilter, setPromoFilter] = useState('any');
    const [incidentFilter, setIncidentFilter] = useState('any');
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [items, setItems] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [metrics, setMetrics] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [overrideLoading, setOverrideLoading] = useState(false);
    const refreshTimer = useRef(null);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [query]);

    const rpcFilters = useMemo(() => ({
        statusBucket: status,
        dateFrom: startOfLocalDay(dateFrom),
        dateTo: endOfLocalDayExclusive(dateTo),
        query: debouncedQuery,
        vehicleType,
        hasPromo: promoFilter === 'any' ? null : promoFilter === 'with',
        hasIncident: incidentFilter === 'any' ? null : incidentFilter === 'with',
    }), [status, dateFrom, dateTo, debouncedQuery, vehicleType, promoFilter, incidentFilter]);

    const fetchRows = useCallback(async ({ append = false, cursorValue = null } = {}) => {
        append ? setLoadingMore(true) : setLoading(true);
        try {
            const result = await listAdminRides({
                ...rpcFilters,
                limit: PAGE_SIZE,
                cursor: cursorValue,
            });
            const rows = Array.isArray(result?.items) ? result.items : [];
            setItems((current) => append ? [...current, ...rows] : rows);
            setCursor(result?.nextCursor || null);
            setHasMore(Boolean(result?.hasMore));
        } catch (error) {
            toast.error(error.message || 'No se pudieron cargar los viajes.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [rpcFilters]);

    const fetchMetrics = useCallback(async () => {
        try {
            const result = await getAdminRideMetrics({
                dateFrom: startOfLocalDay(dateFrom),
                dateTo: endOfLocalDayExclusive(dateTo),
            });
            setMetrics(result);
        } catch (error) {
            toast.error(error.message || 'No se pudieron calcular las métricas de viajes.');
        }
    }, [dateFrom, dateTo]);

    const refresh = useCallback(async () => {
        await Promise.all([fetchRows(), fetchMetrics()]);
    }, [fetchRows, fetchMetrics]);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        const scheduleRefresh = () => {
            window.clearTimeout(refreshTimer.current);
            refreshTimer.current = window.setTimeout(refresh, 700);
        };
        const channel = supabase
            .channel('admin-rides-operations')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (payload) => {
                if (payload.new?.service_type !== 'delivery' && payload.old?.service_type !== 'delivery') scheduleRefresh();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_offers' }, scheduleRefresh)
            .subscribe();
        return () => {
            window.clearTimeout(refreshTimer.current);
            supabase.removeChannel(channel);
        };
    }, [refresh]);

    const applyPreset = (value) => {
        setPreset(value);
        if (value !== 'custom') {
            const dates = presetDates(value);
            setDateFrom(dates.from);
            setDateTo(dates.to);
        }
    };

    const openDetail = async (rideId) => {
        setDetailLoading(true);
        setDetail({ loadingId: rideId });
        try {
            setDetail(await getAdminRideDetail(rideId));
        } catch (error) {
            setDetail(null);
            toast.error(error.message || 'No se pudo abrir el viaje.');
        } finally {
            setDetailLoading(false);
        }
    };

    const loadMore = () => {
        if (!loadingMore && hasMore && cursor) fetchRows({ append: true, cursorValue: cursor });
    };

    const exportCsv = () => {
        if (!items.length) return toast.error('No hay viajes cargados para exportar.');
        const headers = [
            'id', 'estado', 'fecha', 'pasajero', 'telefono_pasajero', 'correo_pasajero',
            'driver', 'telefono_driver', 'placa', 'vehiculo', 'origen', 'destino',
            'precio', 'tipo', 'distancia_km', 'asignacion_segundos', 'promocion', 'incidente',
        ];
        const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
        const rows = items.map((ride) => [
            ride.id, ride.status, ride.created_at, ride.passenger?.full_name, ride.passenger?.phone,
            ride.passenger?.email, ride.driver?.full_name, ride.driver?.phone, ride.driver?.license_plate,
            [ride.driver?.vehicle_brand, ride.driver?.vehicle_model].filter(Boolean).join(' '),
            ride.pickup, ride.dropoff, ride.price, ride.ride_type, ride.quoted_distance_km,
            ride.assignmentSeconds, ride.promo_code_id ? 'sí' : 'no', ride.hasIncident ? 'sí' : 'no',
        ]);
        const blob = new Blob([[headers, ...rows].map((row) => row.map(quote).join(',')).join('\n')], {
            type: 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `higo-viajes-${localDate(new Date())}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const runOverride = async (targetStatus) => {
        const ride = detail?.ride;
        if (!ride) return;
        const action = targetStatus === 'completed' ? 'marcar como completado' : 'cancelar';
        const reason = window.prompt(`Motivo obligatorio para ${action} el viaje #${ride.id}:`);
        if (!reason?.trim()) return;
        if (!window.confirm(`¿Confirmas ${action} el viaje #${ride.id}? La acción quedará auditada.`)) return;
        setOverrideLoading(true);
        try {
            await overrideAdminRideStatus({ rideId: ride.id, targetStatus, reason: reason.trim() });
            toast.success(targetStatus === 'completed' ? 'Viaje completado por Administración.' : 'Viaje cancelado por Administración.');
            await Promise.all([openDetail(ride.id), refresh()]);
        } catch (error) {
            toast.error(error.message || 'No se pudo aplicar el cambio.');
        } finally {
            setOverrideLoading(false);
        }
    };

    const metricCards = [
        ['Activos', metrics?.active || 0, `${metrics?.total || 0} en el período`, 'radio_button_checked', 'text-violet-400'],
        ['Completados', metrics?.completed || 0, `${(Number(metrics?.completionRate || 0) * 100).toFixed(1)}% finalización`, 'check_circle', 'text-emerald-400'],
        ['Cancelados', metrics?.cancelled || 0, 'Viajes no completados', 'cancel', 'text-red-400'],
        ['Volumen transado', money(metrics?.transactedVolume), 'Pasajero → driver; no es ingreso Higo', 'payments', 'text-blue-400'],
        ['Precio promedio', money(metrics?.averagePrice), 'Solo viajes completados', 'paid', 'text-cyan-400'],
        ['Asignación promedio', fmtDuration(metrics?.avgAssignmentSeconds), `${metrics?.uniqueDrivers || 0} drivers únicos`, 'person_search', 'text-amber-400'],
        ['Duración promedio', fmtDuration(metrics?.avgTripSeconds), `${metrics?.uniquePassengers || 0} pasajeros únicos`, 'timer', 'text-orange-400'],
        ['Incidentes', Number(metrics?.paymentDisputes || 0) + Number(metrics?.fraudSignals || 0), `${metrics?.paymentDisputes || 0} pagos · ${metrics?.fraudSignals || 0} alertas`, 'warning', 'text-rose-400'],
    ];

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 text-white">
            <AdminNav />

            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                        <span className="material-symbols-outlined text-3xl">route</span>
                    </div>
                    <div>
                        <p className="text-[10px] tracking-[0.22em] uppercase font-black text-violet-400">Operación y trazabilidad</p>
                        <h1 className="text-3xl font-black">Higo Viajes</h1>
                        <p className="text-sm text-gray-400">Seguimiento integral de pasajeros, drivers, rutas, precio y despacho.</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={exportCsv} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold flex items-center gap-2 hover:bg-white/10">
                        <span className="material-symbols-outlined text-[18px]">download</span> Exportar CSV
                    </button>
                    <button onClick={refresh} className="px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-300 text-sm font-bold flex items-center gap-2 hover:bg-violet-500/20">
                        <span className="material-symbols-outlined text-[18px]">refresh</span> Actualizar
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
                {metricCards.map(([label, value, note, icon, tone]) => <MetricCard key={label} label={label} value={value} note={note} icon={icon} tone={tone} />)}
            </div>

            <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-3 mb-3 flex gap-2 overflow-x-auto">
                {STATUS_FILTERS.map((filter) => (
                    <button key={filter.id} onClick={() => setStatus(filter.id)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm whitespace-nowrap ${status === filter.id ? 'bg-violet-600 text-white' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}>
                        <span className="material-symbols-outlined text-[17px]">{filter.icon}</span>{filter.label}
                    </button>
                ))}
            </div>

            <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-3 mb-6 space-y-3">
                <div className="flex gap-2 overflow-x-auto">
                    {[['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['all', 'Todo'], ['custom', 'Personalizado']].map(([id, label]) => (
                        <button key={id} onClick={() => applyPreset(id)} className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${preset === id ? 'bg-blue-600 text-white' : 'bg-[#0F1014] text-gray-400'}`}>{label}</button>
                    ))}
                </div>
                <div className="grid sm:grid-cols-2 xl:grid-cols-[150px_150px_180px_160px_160px_1fr] gap-2">
                    <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPreset('custom'); }} className="bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-sm" />
                    <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPreset('custom'); }} className="bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-sm" />
                    <select value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} className="bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-sm">
                        {VEHICLE_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
                    </select>
                    <select value={promoFilter} onChange={(event) => setPromoFilter(event.target.value)} className="bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-sm">
                        <option value="any">Promoción: todos</option><option value="with">Con promoción</option><option value="without">Sin promoción</option>
                    </select>
                    <select value={incidentFilter} onChange={(event) => setIncidentFilter(event.target.value)} className="bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-sm">
                        <option value="any">Incidentes: todos</option><option value="with">Con incidente</option><option value="without">Sin incidente</option>
                    </select>
                    <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-[19px]">search</span>
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, pasajero, driver, teléfono, correo, placa, origen o destino…" className="w-full bg-[#0F1014] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm" />
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="py-24 flex justify-center"><div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : items.length === 0 ? (
                <div className="py-20 text-center bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                    <span className="material-symbols-outlined text-5xl text-gray-600">route</span>
                    <p className="font-bold text-gray-300 mt-3">No hay viajes para estos filtros.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {items.map((ride) => {
                        const passenger = ride.passenger || {};
                        const driver = ride.driver || {};
                        const vehicle = [driver.vehicle_brand, driver.vehicle_model, driver.license_plate].filter(Boolean).join(' · ');
                        return (
                            <article key={ride.id} className={`bg-[#1A1F2E] rounded-2xl border p-4 ${ride.hasIncident ? 'border-rose-500/35' : 'border-white/5'}`}>
                                <div className="grid md:grid-cols-[120px_1fr_1fr_1.45fr_120px_56px] gap-4 items-center">
                                    <div>
                                        <p className="text-[10px] uppercase font-black text-gray-500">Viaje</p>
                                        <p className="font-mono text-lg font-black text-violet-300">#{ride.id}</p>
                                        <span className={`inline-flex mt-1 px-2 py-1 rounded-full border text-[10px] font-black ${STATUS_COLORS[ride.status] || 'bg-gray-500/10 text-gray-300 border-gray-500/20'}`}>{STATUS_LABELS[ride.status] || ride.status}</span>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] uppercase font-black text-gray-500">Pasajero</p>
                                        <p className="text-sm font-bold truncate">{passenger.full_name || '—'}</p>
                                        <p className="text-[11px] text-gray-400 truncate">{passenger.phone || passenger.email || '—'}</p>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] uppercase font-black text-gray-500">Higo Driver</p>
                                        <p className="text-sm font-bold truncate">{driver.full_name || 'Sin asignar'}</p>
                                        <p className="text-[11px] text-gray-400 truncate">{vehicle || driver.phone || '—'}</p>
                                    </div>
                                    <div className="min-w-0 space-y-1">
                                        <p className="text-xs truncate"><span className="text-emerald-400 mr-1">●</span>{ride.pickup}</p>
                                        <p className="text-xs truncate"><span className="text-red-400 mr-1">●</span>{ride.dropoff}</p>
                                        <p className="text-[10px] text-gray-500">{fmtDate(ride.created_at)} · {ride.quoted_distance_km ? `${Number(ride.quoted_distance_km).toFixed(2)} km` : 'distancia no registrada'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-black text-gray-500">Precio</p>
                                        <p className="font-mono font-black">{money(ride.price)}</p>
                                        <div className="flex gap-1 flex-wrap mt-1">
                                            {ride.promo_code_id && <span className="text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300">PROMO</span>}
                                            {ride.hasIncident && <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">INCIDENTE</span>}
                                            {ride.pricing_version === 4 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">V4</span>}
                                        </div>
                                    </div>
                                    <button onClick={() => openDetail(ride.id)} className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/25 text-violet-300 flex items-center justify-center hover:bg-violet-500/20" aria-label={`Ver viaje ${ride.id}`}>
                                        <span className="material-symbols-outlined">visibility</span>
                                    </button>
                                </div>
                                <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-gray-500">
                                    <span>Ofertas: <strong className="text-gray-300">{ride.offerSummary?.total || 0}</strong></span>
                                    <span>Ola: <strong className="text-gray-300">{ride.offerSummary?.maxWave || 0}</strong></span>
                                    <span>Asignación: <strong className="text-gray-300">{fmtDuration(ride.assignmentSeconds)}</strong></span>
                                    <span>Soporte abierto: <strong className="text-gray-300">{ride.openSupportCount || 0}</strong></span>
                                    <span>Pricing: <strong className="text-gray-300">{ride.pricing_model || 'legacy'}</strong></span>
                                </div>
                            </article>
                        );
                    })}
                    {hasMore && <div className="text-center pt-4"><button disabled={loadingMore} onClick={loadMore} className="px-6 py-3 rounded-full bg-[#1A1F2E] border border-white/10 font-bold text-sm disabled:opacity-50">{loadingMore ? 'Cargando…' : `Cargar ${PAGE_SIZE} viajes más`}</button></div>}
                </div>
            )}

            {detail && (
                <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-y-auto p-3 md:p-6">
                    <div className="max-w-6xl mx-auto bg-[#0A101F] border border-white/10 rounded-3xl my-4 overflow-hidden">
                        <div className="sticky top-0 z-10 bg-[#0A101F]/95 backdrop-blur border-b border-white/5 p-5 flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] font-black text-violet-400">Expediente operativo</p>
                                <h2 className="text-2xl font-black">{detail.ride ? `Viaje #${detail.ride.id}` : `Cargando #${detail.loadingId}…`}</h2>
                                {detail.ride && <span className={`inline-flex mt-1 px-2 py-1 rounded-full border text-[10px] font-black ${STATUS_COLORS[detail.ride.status] || ''}`}>{STATUS_LABELS[detail.ride.status] || detail.ride.status}</span>}
                            </div>
                            <button onClick={() => setDetail(null)} className="w-11 h-11 rounded-full bg-white/5 flex items-center justify-center"><span className="material-symbols-outlined">close</span></button>
                        </div>

                        {detailLoading || !detail.ride ? (
                            <div className="py-28 flex justify-center"><div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                        ) : (() => {
                            const ride = detail.ride;
                            const pricing = detail.pricing || {};
                            const snapshot = pricing.snapshot || {};
                            const multiplier = resolveEffectiveRideMultiplier({ pricing, snapshot });
                            const route = detail.route || {};
                            const mapUrl = route.pickupLat != null && route.pickupLng != null && route.dropoffLat != null && route.dropoffLng != null
                                ? `https://www.google.com/maps/dir/?api=1&origin=${route.pickupLat},${route.pickupLng}&destination=${route.dropoffLat},${route.dropoffLng}`
                                : null;
                            const milestones = [
                                ['Solicitud creada', detail.timeline?.createdAt],
                                ['Driver aceptó', detail.timeline?.acceptedAt],
                                ['Llegó al origen', detail.timeline?.arrivedPickupAt],
                                ['Viaje iniciado', detail.timeline?.startedAt],
                                ['Llegó al destino', detail.timeline?.arrivedDropoffAt],
                                ['Completado', detail.timeline?.completedAt],
                                ['Cancelado', detail.timeline?.cancelledAt],
                            ].filter(([, value]) => value);
                            return (
                                <div className="p-5 space-y-5">
                                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                                        <InfoBlock title="Pasajero" tone="text-blue-300">
                                            <Row label="Nombre" value={detail.passenger?.full_name} /><Row label="Teléfono" value={detail.passenger?.phone} mono /><Row label="Correo" value={detail.passenger?.email} /><Row label="ID" value={detail.passenger?.id} mono />
                                        </InfoBlock>
                                        <InfoBlock title="Higo Driver" tone="text-emerald-300">
                                            <Row label="Nombre" value={detail.driver?.full_name || 'Sin asignar'} /><Row label="Teléfono" value={detail.driver?.phone} mono /><Row label="Placa" value={detail.driver?.license_plate} mono /><Row label="Vehículo" value={[detail.driver?.vehicle_brand, detail.driver?.vehicle_model, detail.driver?.vehicle_color].filter(Boolean).join(' · ')} />
                                        </InfoBlock>
                                        <InfoBlock title="Viaje" tone="text-violet-300">
                                            <Row label="Tipo" value={ride.ride_type} /><Row label="Creado" value={fmtDate(ride.created_at)} /><Row label="Distancia" value={route.quotedDistanceKm ? `${Number(route.quotedDistanceKm).toFixed(3)} km` : '—'} /><Row label="Duración" value={fmtDuration(detail.metrics?.tripSeconds)} />
                                        </InfoBlock>
                                        <InfoBlock title="Indicadores" tone="text-amber-300">
                                            <Row label="Asignación" value={fmtDuration(detail.metrics?.assignmentSeconds)} /><Row label="Espera pickup" value={fmtDuration(detail.metrics?.pickupWaitSeconds)} /><Row label="Soporte" value={`${detail.supportThreads?.filter((thread) => thread.status === 'open').length || 0} abierto(s)`} /><Row label="Alertas" value={`${detail.fraudSignals?.length || 0}`} />
                                        </InfoBlock>
                                    </div>

                                    <div className="grid xl:grid-cols-2 gap-4">
                                        <InfoBlock title="Ruta y paradas" tone="text-cyan-300">
                                            <div className="space-y-3">
                                                <div><p className="text-[10px] uppercase font-black text-emerald-400">Origen</p><p className="text-sm">{route.pickup}</p><p className="text-[10px] text-gray-500 font-mono">{route.pickupLat}, {route.pickupLng}</p></div>
                                                <div><p className="text-[10px] uppercase font-black text-red-400">Destino</p><p className="text-sm">{route.dropoff}</p><p className="text-[10px] text-gray-500 font-mono">{route.dropoffLat}, {route.dropoffLng}</p></div>
                                                {Array.isArray(route.stops) && route.stops.length > 0 && <div><p className="text-[10px] uppercase font-black text-amber-400 mb-1">Paradas</p>{route.stops.map((stop, index) => <p key={`${stop.address || 'stop'}-${index}`} className="text-xs text-gray-300">{index + 1}. {stop.address || stop.label || JSON.stringify(stop)}</p>)}</div>}
                                                {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-300 text-xs font-bold"><span className="material-symbols-outlined text-[17px]">map</span>Abrir ruta en Google Maps</a>}
                                            </div>
                                        </InfoBlock>
                                        <InfoBlock title="Cronología" tone="text-fuchsia-300">
                                            <div className="space-y-3">{milestones.map(([label, value], index) => <div key={label} className="flex gap-3"><div className="flex flex-col items-center"><span className="w-2.5 h-2.5 rounded-full bg-violet-400 mt-1" />{index < milestones.length - 1 && <span className="w-px flex-1 bg-white/10 mt-1" />}</div><div><p className="text-xs font-bold">{label}</p><p className="text-[10px] text-gray-500">{fmtDate(value)}</p></div></div>)}</div>
                                        </InfoBlock>
                                    </div>

                                    <div className="grid xl:grid-cols-2 gap-4">
                                        <InfoBlock title="Desglose del precio" tone="text-emerald-300">
                                            <Row label="Tarifa base" value={money(pricing.baseAmount ?? snapshot.base)} /><Row label="Distancia" value={money(pricing.distanceAmount ?? snapshot.distanceAmount)} /><Row label="Tiempo" value={money(pricing.timeAmount ?? snapshot.timeAmount)} /><Row label="Paradas" value={money(pricing.stopsAmount ?? snapshot.stopsAmount)} /><Row label="Extras" value={money(pricing.extrasAmount ?? snapshot.extrasAmount)} /><Row label="Espera" value={`${money(ride.wait_fee)} · ${ride.wait_seconds || 0} s`} /><Row label="Multiplicador" value={`${multiplier.value.toFixed(3)} · ${multiplier.reason}`} /><Row label="Descuento" value={money(pricing.discountAmount)} /><Row label="Mínimo" value={money(pricing.minimumFare ?? snapshot.minimumFare)} /><Row label="Total" value={money(pricing.price)} /><Row label="Modelo" value={`${pricing.pricingModel || 'legacy'} · v${pricing.pricingVersion || '—'}`} mono />
                                        </InfoBlock>
                                        <InfoBlock title="Pago y promoción" tone="text-amber-300">
                                            <Row label="Método" value={detail.payment?.method} /><Row label="Referencia" value={detail.payment?.reference} mono /><Row label="Confirma pasajero" value={detail.payment?.confirmedByPassenger ? 'Sí' : 'No'} /><Row label="Confirma driver" value={detail.payment?.confirmedByDriver ? 'Sí' : 'No'} /><Row label="Confirmado" value={fmtDate(detail.payment?.confirmedAt)} /><Row label="Disputa" value={detail.payment?.hasDispute ? 'Revisión necesaria' : 'Sin señal'} /><Row label="Promoción" value={detail.promo?.code || 'Sin promoción'} /><Row label="Descuento aplicado" value={money(pricing.discountAmount)} />
                                        </InfoBlock>
                                    </div>

                                    <InfoBlock title={`Despacho progresivo · ${detail.offers?.length || 0} ofertas`} tone="text-blue-300">
                                        <div className="grid md:grid-cols-4 gap-3 mb-4"><Row label="Estado" value={detail.dispatch?.status} /><Row label="Ola final" value={detail.dispatch?.current_wave} /><Row label="Ofertas creadas" value={detail.dispatch?.offers_created} /><Row label="Inicio" value={fmtDate(detail.dispatch?.started_at)} /></div>
                                        {detail.offers?.length ? <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b border-white/10"><th className="py-2">Ola / rango</th><th>Driver</th><th>Distancia</th><th>Puntaje</th><th>Estado</th><th>Notificación</th><th>Hora</th></tr></thead><tbody>{detail.offers.map((offer) => <tr key={offer.id} className="border-b border-white/5"><td className="py-2">{offer.wave_number || '—'} / {offer.rank_position || '—'}</td><td>{offer.driverName || offer.driver_id}<br /><span className="text-gray-500">{offer.licensePlate || ''}</span></td><td>{offer.distance_km == null ? '—' : `${Number(offer.distance_km).toFixed(2)} km`}</td><td>{Number(offer.score || 0).toFixed(2)}</td><td>{offer.status}</td><td>{offer.notification_status || '—'}</td><td>{fmtDate(offer.offered_at)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-gray-500">No hay ofertas registradas para este viaje.</p>}
                                    </InfoBlock>

                                    <div className="grid xl:grid-cols-2 gap-4">
                                        <InfoBlock title={`Eventos auditados · ${detail.events?.length || 0}`} tone="text-violet-300">
                                            <div className="max-h-72 overflow-y-auto space-y-2">{detail.events?.map((event) => <div key={event.id} className="bg-[#0F1014] rounded-xl p-3"><div className="flex justify-between gap-3"><p className="text-xs font-bold">{event.event_type}</p><p className="text-[10px] text-gray-500">{fmtDate(event.created_at)}</p></div><p className="text-[10px] text-gray-400">{event.from_status || '—'} → {event.to_status} · {event.actorName || event.actor_id || 'sistema'}</p>{event.metadata && Object.keys(event.metadata).length > 0 && <pre className="text-[9px] text-gray-500 mt-2 whitespace-pre-wrap">{JSON.stringify(event.metadata, null, 2)}</pre>}</div>)}{!detail.events?.length && <p className="text-sm text-gray-500">Sin eventos registrados.</p>}</div>
                                        </InfoBlock>
                                        <InfoBlock title="Incidentes y soporte" tone="text-rose-300">
                                            <Row label="Disputa de pago" value={detail.payment?.hasDispute ? 'Sí' : 'No'} /><Row label="Señales de fraude" value={detail.fraudSignals?.length || 0} /><Row label="Conversaciones soporte" value={detail.supportThreads?.length || 0} /><Row label="Acciones admin" value={detail.auditLog?.length || 0} />
                                            {detail.fraudSignals?.map((signal, index) => <div key={`${signal.signal}-${index}`} className="mt-2 p-2 rounded-lg bg-rose-500/10 text-xs text-rose-200">{signal.signal} · {signal.severity}</div>)}
                                            <div className="flex flex-wrap gap-2 mt-4"><a href="#/admin/disputes" className="px-3 py-2 rounded-lg bg-orange-500/10 text-orange-300 text-xs font-bold">Abrir Disputas</a><a href="#/admin/support" className="px-3 py-2 rounded-lg bg-blue-500/10 text-blue-300 text-xs font-bold">Abrir Soporte</a><a href="#/admin/fraud" className="px-3 py-2 rounded-lg bg-red-500/10 text-red-300 text-xs font-bold">Abrir Alertas</a></div>
                                        </InfoBlock>
                                    </div>

                                    {ride.status !== 'completed' && ride.status !== 'cancelled' && (
                                        <InfoBlock title="Override administrativo auditado" tone="text-amber-300">
                                            <p className="text-xs text-gray-400 mb-3">Úsalo solo con evidencia clara. Se registrarán el administrador, el estado anterior, el motivo y los datos posteriores.</p>
                                            <div className="flex flex-wrap gap-2">
                                                {['accepted', 'in_progress', 'arrived_at_dropoff'].includes(ride.status) && <button disabled={overrideLoading} onClick={() => runOverride('completed')} className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-bold disabled:opacity-50">Marcar completado</button>}
                                                <button disabled={overrideLoading} onClick={() => runOverride('cancelled')} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs font-bold disabled:opacity-50">Cancelar viaje</button>
                                            </div>
                                        </InfoBlock>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
}
