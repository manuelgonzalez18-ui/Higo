import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import { toast } from '../components/Toast';

const STATUS_FILTERS = [
    { id: 'active',    label: 'Activos',     icon: 'pending', q: ['requested','accepted','in_progress','arrived_at_dropoff'] },
    { id: 'completed', label: 'Completados', icon: 'check_circle', q: ['completed'] },
    { id: 'cancelled', label: 'Cancelados',  icon: 'cancel', q: ['cancelled'] },
    { id: 'all',       label: 'Todos',       icon: 'list', q: null },
];

const COD_FILTERS = [
    { id: 'any',       label: 'COD: todos' },
    { id: 'with',      label: 'Con COD' },
    { id: 'without',   label: 'Sin COD' },
];

const STATUS_LABEL = {
    requested:           'Solicitado',
    accepted:            'Aceptado',
    in_progress:         'En camino',
    arrived_at_dropoff:  'En destino',
    completed:           'Entregado',
    cancelled:           'Cancelado',
};

const STATUS_COLOR = {
    requested:           'bg-gray-500/20 text-gray-300',
    accepted:            'bg-blue-500/20 text-blue-300',
    in_progress:         'bg-amber-500/20 text-amber-300',
    arrived_at_dropoff:  'bg-orange-500/20 text-orange-300',
    completed:           'bg-emerald-500/20 text-emerald-400',
    cancelled:           'bg-red-500/20 text-red-400',
};

const fmtDate = (d) => d ? new Date(d).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const diffMin = (a, b) => {
    if (!a || !b) return null;
    return Math.round((new Date(b) - new Date(a)) / 60000);
};

const AdminDeliveriesPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [items, setItems] = useState([]);
    const PAGE_SIZE = 50;
    const [profilesMap, setProfilesMap] = useState({});
    const [claimsByRide, setClaimsByRide] = useState({});
    const [statusFilter, setStatusFilter] = useState('active');
    const [codFilter, setCodFilter] = useState('any');
    const [search, setSearch] = useState('');
    const [activeRide, setActiveRide] = useState(null);
    const [signedUrls, setSignedUrls] = useState({});

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
        })();
    }, [navigate]);

    // H4.4 — cursor pagination en lugar de .limit(200) arbitrario.
    // reset=true: empieza de cero (mount + cambio de filtro).
    // reset=false: pagina con `cursor` (created_at del último item local).
    // El caller pasa el cursor explícito para evitar dependencias circulares
    // en el useCallback (si dependiera de `items`, cada llegada de página
    // dispararía un re-fetch en el useEffect).
    const fetchData = useCallback(async (reset = true, cursor = null) => {
        if (!authorized) return;
        if (reset) setLoading(true);
        else setLoadingMore(true);

        let q = supabase
            .from('rides')
            .select('id,user_id,driver_id,pickup,dropoff,status,price,ride_type,service_type,delivery_info,picked_up_at,arrived_at_dropoff_at,delivered_at,created_at,cod_amount,cod_collected,pickup_pod_url,delivery_pod_url,payer')
            .eq('service_type', 'delivery')
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE);

        const statusBucket = STATUS_FILTERS.find(s => s.id === statusFilter);
        if (statusBucket?.q) q = q.in('status', statusBucket.q);

        if (codFilter === 'with') q = q.not('cod_amount', 'is', null).gt('cod_amount', 0);
        if (codFilter === 'without') q = q.or('cod_amount.is.null,cod_amount.eq.0');

        if (cursor) q = q.lt('created_at', cursor);

        const { data, error } = await q;
        if (error) {
            toast.error(error.message);
            setLoading(false);
            setLoadingMore(false);
            return;
        }
        const rows = data || [];
        // Usar functional setter para no depender de `items` en useCallback.
        setItems(prev => reset ? rows : [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);

        const userIds = new Set();
        (data || []).forEach(r => {
            if (r.user_id) userIds.add(r.user_id);
            if (r.driver_id) userIds.add(r.driver_id);
        });
        if (userIds.size > 0) {
            const { data: pp } = await supabase
                .from('profiles')
                .select('id,full_name,phone,license_plate,vehicle_model,suspended_at')
                .in('id', Array.from(userIds));
            const pMap = {};
            (pp || []).forEach(p => { pMap[p.id] = p; });
            setProfilesMap(pMap);
        }

        // Claims por ride para badge
        const rideIds = (data || []).map(r => r.id);
        if (rideIds.length > 0) {
            const { data: cs } = await supabase
                .from('delivery_claims')
                .select('id,ride_id,status')
                .in('ride_id', rideIds);
            const cMap = {};
            (cs || []).forEach(c => {
                cMap[c.ride_id] = cMap[c.ride_id] || [];
                cMap[c.ride_id].push(c);
            });
            // H4.4 — merge con los claims existentes (no pisa los de páginas previas)
            setClaimsByRide(prev => reset ? cMap : { ...prev, ...cMap });
        } else if (reset) {
            setClaimsByRide({});
        }

        setLoading(false);
        setLoadingMore(false);
    }, [authorized, statusFilter, codFilter]);

    const loadMore = async () => {
        if (loadingMore || !hasMore) return;
        const cursor = items[items.length - 1]?.created_at;
        await fetchData(false, cursor);
    };

    useEffect(() => { fetchData(); }, [fetchData]);

    // Realtime subscription para que el listado se refresque al cambiar status
    useEffect(() => {
        if (!authorized) return;
        const ch = supabase
            .channel('admin_deliveries_rides')
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rides' },
                (payload) => {
                    if (payload.new?.service_type === 'delivery') fetchData();
                })
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [authorized, fetchData]);

    const openDetail = async (ride) => {
        setActiveRide(ride);
        const paths = [ride.pickup_pod_url, ride.delivery_pod_url].filter(Boolean);
        const newSigned = { ...signedUrls };
        for (const p of paths) {
            if (newSigned[p]) continue;
            const { data } = await supabase.storage.from('delivery-pods').createSignedUrl(p, 3600);
            newSigned[p] = data?.signedUrl || null;
        }
        setSignedUrls(newSigned);
    };

    const forceCancel = async (ride) => {
        if (!window.confirm(`¿Cancelar el envío #${ride.id}? El chofer y el remitente verán el cambio.`)) return;
        const { error } = await supabase.from('rides').update({ status: 'cancelled' }).eq('id', ride.id);
        if (error) toast.error(error.message);
        else { toast.success('Cancelado.'); fetchData(); }
    };

    const forceComplete = async (ride) => {
        if (!window.confirm(`¿Forzar entrega completada para envío #${ride.id}? Solo si tenés evidencia clara.`)) return;
        const { error } = await supabase.from('rides').update({ status: 'completed' }).eq('id', ride.id);
        if (error) toast.error(error.message);
        else { toast.success('Marcado como entregado.'); fetchData(); }
    };

    const filtered = items.filter(r => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        const driver = profilesMap[r.driver_id];
        const user = profilesMap[r.user_id];
        return [
            r.id?.toString(),
            r.pickup,
            r.dropoff,
            r.delivery_info?.package_description,
            r.delivery_info?.receiverName,
            r.delivery_info?.receiverPhone,
            r.delivery_info?.senderName,
            driver?.full_name, driver?.phone, driver?.license_plate,
            user?.full_name, user?.phone,
        ].some(v => v && v.toString().toLowerCase().includes(s));
    });

    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex items-center gap-4 mb-6">
                <div className="bg-gradient-to-br from-orange-500 to-amber-500 p-3 rounded-2xl shadow-lg shadow-orange-500/20">
                    <span className="material-symbols-outlined text-white text-2xl">inventory_2</span>
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-white">Higo Envíos</h1>
                    <p className="text-gray-400 text-sm font-medium">Operación de envíos · {items.length} en este filtro</p>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-[#1A1F2E] p-3 rounded-[20px] border border-white/5 mb-3 flex gap-2 overflow-x-auto">
                {STATUS_FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setStatusFilter(f.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${statusFilter === f.id
                            ? 'bg-[#2C3345] text-white shadow-lg'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                    >
                        <span className="material-symbols-outlined text-[16px]">{f.icon}</span>
                        {f.label}
                    </button>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <select
                    value={codFilter}
                    onChange={e => setCodFilter(e.target.value)}
                    className="bg-[#1A1F2E] border border-white/5 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-orange-500"
                >
                    {COD_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <input
                    type="text"
                    placeholder="Buscar por nombre, teléfono, dirección, placa…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="flex-1 bg-[#1A1F2E] border border-white/5 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-orange-500"
                />
                <button
                    onClick={fetchData}
                    className="px-4 py-2 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-xl font-bold text-sm hover:bg-orange-500/20"
                >
                    <span className="material-symbols-outlined text-base align-middle">refresh</span>
                </button>
            </div>

            {/* Lista */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                    <span className="material-symbols-outlined text-gray-500 text-4xl">inventory_2</span>
                    <p className="text-gray-400 font-medium mt-2">No hay envíos para mostrar.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(r => {
                        const driver = profilesMap[r.driver_id] || {};
                        const user = profilesMap[r.user_id] || {};
                        const claims = claimsByRide[r.id] || [];
                        const hasOpenClaim = claims.some(c => c.status === 'open' || c.status === 'investigating');
                        const hasResolvedClaim = claims.some(c => c.status === 'resolved_for_claimant');
                        const dInfo = r.delivery_info || {};
                        const transitMin = diffMin(r.picked_up_at, r.delivered_at);

                        return (
                            <div key={r.id} className={`bg-[#1A1F2E] p-4 rounded-[20px] border ${hasOpenClaim ? 'border-orange-500/40' : hasResolvedClaim ? 'border-red-500/40' : 'border-white/5'} relative overflow-hidden`}>
                                <div className="grid md:grid-cols-6 gap-3 items-center">
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Envío</p>
                                        <p className="font-mono font-bold text-orange-400">#{r.id}</p>
                                        <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLOR[r.status]}`}>
                                            {STATUS_LABEL[r.status] || r.status}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Remitente</p>
                                        <p className="text-xs text-white truncate">{dInfo.senderName || user.full_name || '—'}</p>
                                        <p className="text-[10px] text-gray-400">{dInfo.senderPhone || user.phone || '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Chofer</p>
                                        <p className="text-xs text-white truncate">
                                            {driver.full_name || '—'}
                                            {driver.suspended_at && <span className="ml-1 text-red-400 text-[10px]">[SUSP]</span>}
                                        </p>
                                        <p className="text-[10px] text-gray-400">{driver.license_plate || '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Paquete</p>
                                        <p className="text-xs text-white truncate">{dInfo.package_description || '—'}</p>
                                        <p className="text-[10px] text-gray-400">
                                            {dInfo.package_weight_kg ? `${dInfo.package_weight_kg} kg` : '—'}
                                            {dInfo.is_fragile && <span className="text-red-400 ml-1">· FRÁGIL</span>}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Precio · COD</p>
                                        <p className="font-mono text-sm text-white">${Number(r.price || 0).toFixed(2)}</p>
                                        {r.cod_amount > 0 && (
                                            <p className={`text-[10px] ${r.cod_collected ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                COD ${Number(r.cod_amount).toFixed(2)} {r.cod_collected ? '✓' : '⌛'}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex gap-2 justify-end flex-wrap">
                                        {hasOpenClaim && (
                                            <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-orange-500/20 text-orange-400 self-center">
                                                CLAIM ABIERTO
                                            </span>
                                        )}
                                        {hasResolvedClaim && (
                                            <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-red-500/20 text-red-400 self-center">
                                                RESUELTO
                                            </span>
                                        )}
                                        <button
                                            onClick={() => openDetail(r)}
                                            className="px-3 py-2 rounded-lg text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20"
                                            title="Ver detalle"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">visibility</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-3 pt-3 border-t border-white/5 flex gap-4 text-[11px] text-gray-400 flex-wrap">
                                    <span className="flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px] text-emerald-400">my_location</span>
                                        {r.pickup}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px] text-red-400">place</span>
                                        {r.dropoff}
                                    </span>
                                    {transitMin !== null && (
                                        <span className="ml-auto text-[10px] bg-white/5 px-2 py-0.5 rounded-full">
                                            ⏱ {transitMin} min en tránsito
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* H4.4 — paginación cursor */}
            {!loading && items.length > 0 && hasMore && (
                <div className="flex justify-center pt-6">
                    <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="px-6 py-3 rounded-full bg-[#1A1F2E] text-gray-300 text-sm font-bold hover:bg-[#252A3A] disabled:opacity-50 border border-white/10"
                    >
                        {loadingMore ? 'Cargando…' : `Cargar más envíos (de a ${PAGE_SIZE})`}
                    </button>
                </div>
            )}
            {!loading && items.length > 0 && !hasMore && (
                <p className="text-center text-xs text-gray-500 pt-6">
                    — fin de la lista ({items.length} envíos) —
                </p>
            )}

            {/* Modal detalle */}
            {activeRide && (() => {
                const driver = profilesMap[activeRide.driver_id] || {};
                const user = profilesMap[activeRide.user_id] || {};
                const dInfo = activeRide.delivery_info || {};
                const claims = claimsByRide[activeRide.id] || [];
                const pickupUrl = signedUrls[activeRide.pickup_pod_url];
                const deliveryUrl = signedUrls[activeRide.delivery_pod_url];

                return (
                    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
                        <div className="bg-[#0a101f] rounded-3xl border border-gray-800 w-full max-w-3xl my-8">
                            <div className="p-5 border-b border-white/5 flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-bold text-white">Envío #{activeRide.id}</h2>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${STATUS_COLOR[activeRide.status]}`}>
                                        {STATUS_LABEL[activeRide.status] || activeRide.status}
                                    </span>
                                </div>
                                <button onClick={() => setActiveRide(null)} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
                                {/* Timeline */}
                                <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                    <h3 className="text-emerald-400 text-xs font-bold uppercase mb-3">Hitos</h3>
                                    <div className="space-y-2 text-sm">
                                        <p><span className="text-gray-500 text-xs">Solicitado:</span> <span className="text-white">{fmtDate(activeRide.created_at)}</span></p>
                                        <p><span className="text-gray-500 text-xs">Recogido:</span> <span className="text-white">{fmtDate(activeRide.picked_up_at)}</span></p>
                                        <p><span className="text-gray-500 text-xs">En destino:</span> <span className="text-white">{fmtDate(activeRide.arrived_at_dropoff_at)}</span></p>
                                        <p><span className="text-gray-500 text-xs">Entregado:</span> <span className="text-white">{fmtDate(activeRide.delivered_at)}</span></p>
                                    </div>
                                </div>

                                {/* Partes */}
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                        <h3 className="text-emerald-400 text-xs font-bold uppercase mb-2">Remitente</h3>
                                        <p className="text-white font-bold">{dInfo.senderName || user.full_name || '—'}</p>
                                        <p className="text-gray-400 text-xs">{dInfo.senderPhone || user.phone || '—'}</p>
                                    </div>
                                    <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                        <h3 className="text-red-400 text-xs font-bold uppercase mb-2">
                                            Destinatario / Chofer
                                        </h3>
                                        <p className="text-white text-sm">Recibe: <strong>{dInfo.receiverName || '—'}</strong></p>
                                        <p className="text-gray-400 text-xs">{dInfo.receiverPhone || '—'}</p>
                                        <p className="text-white text-sm mt-2">Chofer: <strong>{driver.full_name || '—'}</strong></p>
                                        <p className="text-gray-400 text-xs">{driver.license_plate || '—'} · {driver.phone || '—'}</p>
                                    </div>
                                </div>

                                {/* Paquete */}
                                <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                    <h3 className="text-orange-400 text-xs font-bold uppercase mb-2">Paquete</h3>
                                    <p className="text-gray-200 text-sm">{dInfo.package_description || '—'}</p>
                                    <div className="flex gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                                        <span>Peso: <strong className="text-white">{dInfo.package_weight_kg || '—'}</strong></span>
                                        <span>Valor declarado: <strong className="text-white">USD {Number(dInfo.package_value_usd || 0).toFixed(2)}</strong></span>
                                        <span>Categoría: <strong className="text-white">{dInfo.category || 'normal'}</strong></span>
                                        {dInfo.is_fragile && <span className="text-red-400 font-bold">FRÁGIL</span>}
                                    </div>
                                    {activeRide.cod_amount > 0 && (
                                        <p className={`text-sm mt-2 ${activeRide.cod_collected ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            COD: USD {Number(activeRide.cod_amount).toFixed(2)} {activeRide.cod_collected ? '✓ Cobrado' : '⌛ Pendiente'}
                                        </p>
                                    )}
                                </div>

                                {/* Fotos POD */}
                                {(pickupUrl || deliveryUrl) && (
                                    <div>
                                        <h3 className="text-violet-400 text-xs font-bold uppercase mb-2">Fotos de prueba</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            {pickupUrl && (
                                                <div>
                                                    <img src={pickupUrl} alt="POD pickup" className="w-full h-40 object-cover rounded-xl border border-white/10" />
                                                    <p className="text-[10px] text-emerald-400 mt-1 text-center font-bold">PICKUP</p>
                                                </div>
                                            )}
                                            {deliveryUrl && (
                                                <div>
                                                    <img src={deliveryUrl} alt="POD delivery" className="w-full h-40 object-cover rounded-xl border border-white/10" />
                                                    <p className="text-[10px] text-emerald-400 mt-1 text-center font-bold">DELIVERY</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {claims.length > 0 && (
                                    <div className="bg-orange-500/10 border border-orange-500/30 p-3 rounded-2xl">
                                        <p className="text-orange-400 text-sm font-bold">{claims.length} reclamo{claims.length > 1 ? 's' : ''} asociado{claims.length > 1 ? 's' : ''}</p>
                                        <button
                                            onClick={() => { setActiveRide(null); navigate('/admin/disputes'); }}
                                            className="text-xs text-orange-300 underline mt-1"
                                        >
                                            Ver en Disputas → tab Envíos
                                        </button>
                                    </div>
                                )}

                                {/* Override actions */}
                                <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-amber-500/20">
                                    <h3 className="text-amber-400 text-xs font-bold uppercase mb-3">Override admin</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {activeRide.status !== 'completed' && activeRide.status !== 'cancelled' && (
                                            <button
                                                onClick={() => forceComplete(activeRide)}
                                                className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                                            >
                                                Marcar entregado
                                            </button>
                                        )}
                                        {activeRide.status !== 'cancelled' && activeRide.status !== 'completed' && (
                                            <button
                                                onClick={() => forceCancel(activeRide)}
                                                className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                                            >
                                                Cancelar envío
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-gray-500 mt-3">Usar solo con evidencia clara. Las acciones quedan en logs.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default AdminDeliveriesPage;
