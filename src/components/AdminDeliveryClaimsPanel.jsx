import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { toast } from './Toast';

const CLAIM_FILTERS = [
    { id: 'open',         label: 'Abiertos',        icon: 'inbox' },
    { id: 'investigating',label: 'Investigando',    icon: 'search' },
    { id: 'resolved',     label: 'Resueltos',       icon: 'check_circle' },
    { id: 'rejected',     label: 'Rechazados',      icon: 'cancel' },
];

const CLAIM_TYPE_LABEL = {
    not_delivered:   'No entregado',
    damaged:         'Dañado',
    lost:            'Perdido',
    wrong_recipient: 'Entregado al destinatario equivocado',
};

const STATUS_LABEL = {
    open:                   'Abierto',
    investigating:          'Investigando',
    resolved_for_claimant:  'Probado',
    rejected:               'Rechazado',
};

const fmtDate = (d) => d ? new Date(d).toLocaleString('es-VE') : '—';

// Resolver una signed URL a partir de un path en delivery-pods
const signPod = async (path) => {
    if (!path) return null;
    const { data } = await supabase.storage.from('delivery-pods').createSignedUrl(path, 3600);
    return data?.signedUrl || null;
};

const AdminDeliveryClaimsPanel = () => {
    const [filter, setFilter] = useState('open');
    const [loading, setLoading] = useState(true);
    const [claims, setClaims] = useState([]);
    const [rides, setRides] = useState({});
    const [profilesMap, setProfilesMap] = useState({});
    const [signedUrls, setSignedUrls] = useState({}); // path -> signedUrl
    const [activeClaim, setActiveClaim] = useState(null);
    const [resolutionNote, setResolutionNote] = useState('');
    const [actionInFlight, setActionInFlight] = useState(false);

    const fetchClaims = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('delivery_claims')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (filter === 'open') q = q.eq('status', 'open');
        else if (filter === 'investigating') q = q.eq('status', 'investigating');
        else if (filter === 'resolved') q = q.eq('status', 'resolved_for_claimant');
        else if (filter === 'rejected') q = q.eq('status', 'rejected');

        const { data, error } = await q;
        if (error) {
            toast.error(`Error cargando claims: ${error.message}`);
            setLoading(false);
            return;
        }
        setClaims(data || []);

        // Pre-cargar rides y profiles relacionados
        const rideIds = [...new Set((data || []).map(c => c.ride_id).filter(Boolean))];
        if (rideIds.length > 0) {
            const { data: rs } = await supabase
                .from('rides')
                .select('id,user_id,driver_id,pickup,dropoff,price,delivery_info,picked_up_at,delivered_at,pickup_pod_url,delivery_pod_url,service_type')
                .in('id', rideIds);
            const rideMap = {};
            (rs || []).forEach(r => { rideMap[r.id] = r; });
            setRides(rideMap);

            const userIds = new Set();
            (data || []).forEach(c => c.claimant_id && userIds.add(c.claimant_id));
            (rs || []).forEach(r => {
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
        }
        setLoading(false);
    }, [filter]);

    useEffect(() => { fetchClaims(); }, [fetchClaims]);

    const openClaimDetail = async (claim) => {
        setActiveClaim(claim);
        setResolutionNote('');
        const ride = rides[claim.ride_id];
        const paths = [];
        if (ride?.pickup_pod_url) paths.push(ride.pickup_pod_url);
        if (ride?.delivery_pod_url) paths.push(ride.delivery_pod_url);
        if (Array.isArray(claim.evidence_urls)) {
            claim.evidence_urls.forEach(u => paths.push(u));
        }
        const newSigned = { ...signedUrls };
        for (const p of paths) {
            if (newSigned[p]) continue;
            newSigned[p] = await signPod(p);
        }
        setSignedUrls(newSigned);
    };

    const closeDetail = () => {
        setActiveClaim(null);
        setResolutionNote('');
    };

    const resolveForClaimant = async () => {
        if (!activeClaim || actionInFlight) return;
        if (!resolutionNote.trim()) {
            toast.error('La nota de resolución es obligatoria — queda como audit.');
            return;
        }
        const confirmMsg = `Resolver a favor del remitente:\n\n` +
            `· El chofer será SUSPENDIDO de la plataforma.\n` +
            `· Se enviará un email al remitente con los datos identificatorios del chofer ` +
            `para que proceda por vía legal.\n` +
            `· Higo no reembolsa con caja propia (decisión de modelo de negocio).\n\n` +
            `¿Confirmás?`;
        if (!window.confirm(confirmMsg)) return;

        setActionInFlight(true);
        try {
            // 1. Llamar al RPC que suspende al chofer y marca el claim
            const { error: rpcErr } = await supabase.rpc('resolve_delivery_claim_for_claimant', {
                p_claim_id: activeClaim.id,
                p_admin_note: resolutionNote.trim(),
            });
            if (rpcErr) throw rpcErr;

            // 2. Disparar email al remitente con datos del chofer
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
                const resp = await fetch('/api/send-claim-resolution-email.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ claim_id: activeClaim.id }),
                });
                const out = await resp.json().catch(() => ({}));
                if (!out.ok) {
                    toast.error(`Claim resuelto pero el email falló: ${out.error || 'unknown'}. Revisar logs.`);
                } else {
                    toast.success(`Resuelto. Email enviado a ${out.sent_to}.`);
                }
            } else {
                toast.error('Claim resuelto pero no se pudo enviar el email (sin sesión).');
            }

            closeDetail();
            await fetchClaims();
        } catch (err) {
            console.error(err);
            toast.error(`Error: ${err.message || err}`);
        } finally {
            setActionInFlight(false);
        }
    };

    const rejectClaim = async () => {
        if (!activeClaim || actionInFlight) return;
        if (!resolutionNote.trim()) {
            toast.error('La nota de rechazo es obligatoria.');
            return;
        }
        if (!window.confirm('¿Rechazar este reclamo? El chofer no será suspendido y el remitente recibirá la respuesta en próximas consultas.')) return;

        setActionInFlight(true);
        try {
            const { error } = await supabase.rpc('reject_delivery_claim', {
                p_claim_id: activeClaim.id,
                p_admin_note: resolutionNote.trim(),
            });
            if (error) throw error;
            toast.success('Reclamo rechazado.');
            closeDetail();
            await fetchClaims();
        } catch (err) {
            toast.error(`Error: ${err.message || err}`);
        } finally {
            setActionInFlight(false);
        }
    };

    const markInvestigating = async (claim) => {
        const { error } = await supabase
            .from('delivery_claims')
            .update({ status: 'investigating' })
            .eq('id', claim.id);
        if (error) toast.error(error.message);
        else { toast.success('Marcado como en investigación.'); fetchClaims(); }
    };

    return (
        <div>
            {/* Filtros */}
            <div className="bg-[#1A1F2E] p-3 rounded-[20px] border border-white/5 mb-6 flex gap-2 overflow-x-auto">
                {CLAIM_FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${filter === f.id
                            ? 'bg-[#2C3345] text-white shadow-lg'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                    >
                        <span className="material-symbols-outlined text-[16px]">{f.icon}</span>
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Lista */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : claims.length === 0 ? (
                <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                    <span className="material-symbols-outlined text-gray-500 text-4xl">inventory_2</span>
                    <p className="text-gray-400 font-medium mt-2">No hay reclamos en este filtro.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {claims.map(c => {
                        const ride = rides[c.ride_id] || {};
                        const claimant = profilesMap[c.claimant_id] || {};
                        const driver = profilesMap[ride.driver_id] || {};
                        const isResolved = c.status === 'resolved_for_claimant';
                        const isRejected = c.status === 'rejected';
                        const stripe = isResolved ? 'bg-red-500' : isRejected ? 'bg-gray-500' : 'bg-orange-500';

                        return (
                            <div key={c.id} className="bg-[#1A1F2E] p-5 rounded-[20px] border border-white/5 relative overflow-hidden">
                                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${stripe}`}></div>
                                <div className="pl-3 grid md:grid-cols-5 gap-4 items-center">
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Reclamo</p>
                                        <p className="font-bold text-orange-400 text-sm">{CLAIM_TYPE_LABEL[c.type] || c.type}</p>
                                        <p className="text-[10px] text-gray-500 font-mono mt-1">{fmtDate(c.created_at)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Remitente / Chofer</p>
                                        <p className="text-sm text-white truncate">{claimant.full_name || '—'}</p>
                                        <p className="text-xs text-gray-400 truncate">
                                            → {driver.full_name || '—'}
                                            {driver.suspended_at && <span className="ml-1 text-red-400 text-[10px]">[SUSP]</span>}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Ride · Valor declarado</p>
                                        <p className="font-mono text-violet-400 text-sm">#{c.ride_id}</p>
                                        <p className="text-xs text-gray-300 mt-0.5">USD {Number(c.declared_value_usd || 0).toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Estado</p>
                                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                                            isResolved ? 'bg-red-500/20 text-red-400'
                                            : isRejected ? 'bg-gray-500/20 text-gray-400'
                                            : c.status === 'investigating' ? 'bg-amber-500/20 text-amber-400'
                                            : 'bg-orange-500/20 text-orange-400'
                                        }`}>{STATUS_LABEL[c.status]}</span>
                                    </div>
                                    <div className="flex gap-2 justify-end flex-wrap">
                                        {(c.status === 'open') && (
                                            <button
                                                onClick={() => markInvestigating(c)}
                                                className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                                            >
                                                Investigar
                                            </button>
                                        )}
                                        <button
                                            onClick={() => openClaimDetail(c)}
                                            className="px-3 py-2 rounded-lg text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 flex items-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">visibility</span>
                                            Detalle
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal detalle */}
            {activeClaim && (() => {
                const ride = rides[activeClaim.ride_id] || {};
                const claimant = profilesMap[activeClaim.claimant_id] || {};
                const driver = profilesMap[ride.driver_id] || {};
                const isOpen = activeClaim.status === 'open' || activeClaim.status === 'investigating';
                const pickupUrl = signedUrls[ride.pickup_pod_url];
                const deliveryUrl = signedUrls[ride.delivery_pod_url];
                const evidenceUrls = (activeClaim.evidence_urls || []).map(p => signedUrls[p]).filter(Boolean);

                return (
                    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
                        <div className="bg-[#0a101f] rounded-3xl border border-gray-800 w-full max-w-2xl my-8">
                            <div className="p-5 border-b border-white/5 flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-bold text-white">Reclamo #{activeClaim.id.slice(0, 8)}</h2>
                                    <p className="text-xs text-gray-400">
                                        {CLAIM_TYPE_LABEL[activeClaim.type]} · Ride #{activeClaim.ride_id}
                                    </p>
                                </div>
                                <button onClick={closeDetail} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
                                {/* Datos del ride */}
                                <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                    <h3 className="text-emerald-400 text-xs font-bold uppercase mb-2">Envío</h3>
                                    <div className="text-sm text-gray-200 space-y-1">
                                        <p><span className="text-gray-500">Origen:</span> {ride.pickup}</p>
                                        <p><span className="text-gray-500">Destino:</span> {ride.dropoff}</p>
                                        <p><span className="text-gray-500">Recogido:</span> {fmtDate(ride.picked_up_at)}</p>
                                        <p><span className="text-gray-500">Entregado:</span> {fmtDate(ride.delivered_at)}</p>
                                        {ride.delivery_info?.package_description && (
                                            <p><span className="text-gray-500">Paquete:</span> {ride.delivery_info.package_description}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Partes */}
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                        <h3 className="text-emerald-400 text-xs font-bold uppercase mb-2">Remitente</h3>
                                        <p className="text-white text-sm font-bold">{claimant.full_name || '—'}</p>
                                        <p className="text-gray-400 text-xs">{claimant.phone || '—'}</p>
                                    </div>
                                    <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                        <h3 className="text-red-400 text-xs font-bold uppercase mb-2">
                                            Chofer {driver.suspended_at && <span className="text-red-500 ml-1">[SUSPENDIDO]</span>}
                                        </h3>
                                        <p className="text-white text-sm font-bold">{driver.full_name || '—'}</p>
                                        <p className="text-gray-400 text-xs">{driver.phone || '—'}</p>
                                        <p className="text-gray-400 text-xs">{driver.vehicle_model} · {driver.license_plate}</p>
                                    </div>
                                </div>

                                {/* Descripción del claim */}
                                <div className="bg-[#1A1F2E] p-4 rounded-2xl">
                                    <h3 className="text-orange-400 text-xs font-bold uppercase mb-2">Descripción del reclamo</h3>
                                    <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                                        {activeClaim.description || '(sin descripción)'}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-3">Valor declarado: <strong className="text-white">USD {Number(activeClaim.declared_value_usd || 0).toFixed(2)}</strong></p>
                                </div>

                                {/* Fotos */}
                                <div>
                                    <h3 className="text-violet-400 text-xs font-bold uppercase mb-2">Fotos POD del chofer + evidencia del remitente</h3>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {pickupUrl && (
                                            <div>
                                                <img src={pickupUrl} alt="POD pickup" className="w-full h-32 object-cover rounded-xl border border-white/10" />
                                                <p className="text-[10px] text-emerald-400 mt-1 text-center font-bold">POD PICKUP</p>
                                            </div>
                                        )}
                                        {deliveryUrl && (
                                            <div>
                                                <img src={deliveryUrl} alt="POD delivery" className="w-full h-32 object-cover rounded-xl border border-white/10" />
                                                <p className="text-[10px] text-emerald-400 mt-1 text-center font-bold">POD DELIVERY</p>
                                            </div>
                                        )}
                                        {evidenceUrls.map((u, i) => (
                                            <div key={i}>
                                                <img src={u} alt={`Evidencia ${i+1}`} className="w-full h-32 object-cover rounded-xl border border-orange-500/30" />
                                                <p className="text-[10px] text-orange-400 mt-1 text-center font-bold">EVIDENCIA #{i+1}</p>
                                            </div>
                                        ))}
                                        {!pickupUrl && !deliveryUrl && evidenceUrls.length === 0 && (
                                            <p className="col-span-full text-xs text-gray-500 italic">Sin fotos disponibles.</p>
                                        )}
                                    </div>
                                </div>

                                {/* Si ya está resuelto: mostrar nota */}
                                {!isOpen && (
                                    <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-white/5">
                                        <h3 className="text-gray-400 text-xs font-bold uppercase mb-2">
                                            Resolución previa ({STATUS_LABEL[activeClaim.status]})
                                        </h3>
                                        <p className="text-gray-200 text-sm whitespace-pre-wrap">{activeClaim.admin_resolution_note || '—'}</p>
                                        <p className="text-xs text-gray-500 mt-2">{fmtDate(activeClaim.resolved_at)}</p>
                                        {activeClaim.driver_contact_shared && (
                                            <p className="text-xs text-emerald-400 mt-1">✓ Datos del chofer ya compartidos con el remitente</p>
                                        )}
                                    </div>
                                )}

                                {/* Actions */}
                                {isOpen && (
                                    <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-amber-500/30">
                                        <h3 className="text-amber-400 text-xs font-bold uppercase mb-3">Resolución</h3>
                                        <textarea
                                            value={resolutionNote}
                                            onChange={e => setResolutionNote(e.target.value)}
                                            placeholder="Nota interna obligatoria — quedará en el audit y se incluirá en el email al remitente si resolvés a su favor."
                                            className="w-full bg-[#0a101f] rounded-xl p-3 text-sm text-white border border-white/10 focus:border-amber-500 outline-none h-24 resize-none mb-3"
                                        />
                                        <div className="flex gap-3">
                                            <button
                                                onClick={rejectClaim}
                                                disabled={actionInFlight}
                                                className="flex-1 py-3 rounded-full bg-gray-700 hover:bg-gray-600 text-white font-bold text-sm disabled:opacity-50"
                                            >
                                                Rechazar
                                            </button>
                                            <button
                                                onClick={resolveForClaimant}
                                                disabled={actionInFlight}
                                                className="flex-1 py-3 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold text-sm disabled:opacity-50"
                                            >
                                                {actionInFlight ? 'Procesando…' : 'Probar a favor del remitente'}
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-gray-500 mt-3 leading-snug">
                                            "Probar" suspende al chofer y dispara email al remitente con datos identificatorios. Higo NO indemniza con caja propia.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default AdminDeliveryClaimsPanel;
