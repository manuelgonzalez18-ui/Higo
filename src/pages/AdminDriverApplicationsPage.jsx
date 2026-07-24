import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import {
    convertDriverApplication,
    getDriverApplication,
    listDriverApplications,
    requestDriverApplicationDocuments,
    reviewDriverApplicationDocument,
    setDriverApplicationStatus,
} from '../services/adminApi';
import { toast } from '../components/Toast';

const PAGE_SIZE = 50;
const STATUSES = [
    ['all', 'Todas'],
    ['received', 'Recibidas'],
    ['under_review', 'En revisión'],
    ['documents_requested', 'Documentos solicitados'],
    ['documents_submitted', 'Documentos recibidos'],
    ['correction_requested', 'Corrección pendiente'],
    ['approved', 'Aprobadas'],
    ['waitlist', 'Lista de espera'],
    ['rejected', 'Rechazadas'],
    ['converted', 'Registradas'],
    ['delivery_failed', 'Entrega fallida'],
];

const STATUS_META = {
    pending_delivery: ['Procesando', 'bg-slate-500/15 text-slate-300 border-slate-500/30'],
    delivery_failed: ['Entrega fallida', 'bg-red-500/15 text-red-300 border-red-500/30'],
    received: ['Recibida', 'bg-blue-500/15 text-blue-300 border-blue-500/30'],
    under_review: ['En revisión', 'bg-amber-500/15 text-amber-300 border-amber-500/30'],
    documents_requested: ['Documentos solicitados', 'bg-violet-500/15 text-violet-300 border-violet-500/30'],
    documents_submitted: ['Documentos recibidos', 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'],
    correction_requested: ['Corrección pendiente', 'bg-orange-500/15 text-orange-300 border-orange-500/30'],
    approved: ['Aprobada', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'],
    converted: ['Driver registrado', 'bg-green-500/15 text-green-300 border-green-500/30'],
    waitlist: ['Lista de espera', 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30'],
    rejected: ['Rechazada', 'bg-rose-500/15 text-rose-300 border-rose-500/30'],
};

const DOCUMENT_LABELS = {
    identity: 'Cédula / identidad',
    driver_license: 'Licencia de conducir',
    vehicle_registration: 'Certificado de circulación',
    rcv: 'RCV',
    vehicle_photo: 'Fotografía del vehículo',
    health_certificate: 'Certificado de salud',
    payment_details: 'Datos de pago',
    other: 'Otro documento',
};

const fmtDate = (value) => value ? new Date(value).toLocaleString('es-VE') : '—';
const vehicleLabel = (value) => ({ moto: 'Moto', carro: 'Carro', camioneta: 'Camioneta' }[value] || value || '—');

function StatusBadge({ status }) {
    const meta = STATUS_META[status] || [status || 'Sin estado', 'bg-gray-500/15 text-gray-300 border-gray-500/30'];
    return <span className={`inline-flex px-2.5 py-1 rounded-full border text-[11px] font-black ${meta[1]}`}>{meta[0]}</span>;
}

function DetailField({ label, value }) {
    return (
        <div className="rounded-2xl bg-white/[0.035] border border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-black">{label}</p>
            <p className="mt-1 text-sm font-semibold text-gray-100 break-words">{value || '—'}</p>
        </div>
    );
}

export default function AdminDriverApplicationsPage() {
    const navigate = useNavigate();
    const [rows, setRows] = useState([]);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [selectedCode, setSelectedCode] = useState('');
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async ({ append = false } = {}) => {
        append ? setLoadingMore(true) : setLoading(true);
        try {
            const result = await listDriverApplications({
                query,
                status,
                limit: PAGE_SIZE,
                offset: append ? rows.length : 0,
            });
            setRows((previous) => append ? [...previous, ...(result || [])] : (result || []));
            setHasMore((result || []).length === PAGE_SIZE);
        } catch (error) {
            toast.error(`No se pudieron cargar las solicitudes: ${error.message}`);
            if (!append) setRows([]);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [query, status, rows.length]);

    const loadDetail = useCallback(async (applicationCode) => {
        if (!applicationCode) return;
        setDetailLoading(true);
        try {
            const result = await getDriverApplication(applicationCode);
            setDetail(result || null);
            setReason(result?.status_reason || '');
        } catch (error) {
            toast.error(`No se pudo abrir la solicitud: ${error.message}`);
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => load(), 300);
        return () => clearTimeout(timer);
    }, [query, status]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (selectedCode) loadDetail(selectedCode);
    }, [selectedCode, loadDetail]);

    const refresh = async () => {
        await load();
        if (selectedCode) await loadDetail(selectedCode);
    };

    const performStatus = async (nextStatus) => {
        if (!detail) return;
        if (['rejected', 'correction_requested', 'waitlist'].includes(nextStatus) && !reason.trim()) {
            toast.error('Indica una observación o motivo antes de continuar.');
            return;
        }
        setBusy(nextStatus);
        try {
            const result = await setDriverApplicationStatus({
                applicationCode: detail.application_code,
                status: nextStatus,
                reason: reason.trim(),
            });
            if (result.email_sent) toast.success('Estado actualizado y correo enviado.');
            else toast.success('Estado actualizado. El correo no pudo confirmarse.');
            await refresh();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy('');
        }
    };

    const requestDocuments = async () => {
        if (!detail) return;
        setBusy('request_documents');
        try {
            const result = await requestDriverApplicationDocuments({
                applicationCode: detail.application_code,
                reason: reason.trim(),
            });
            if (result.email_sent) toast.success('Enlace seguro enviado al aspirante por correo.');
            else toast.error('Se generó el enlace, pero el correo no pudo enviarse.');
            await refresh();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy('');
        }
    };

    const reviewDocument = async (document, reviewStatus) => {
        if (!detail) return;
        const notes = reviewStatus === 'rejected'
            ? window.prompt('Indica qué debe corregirse en este documento:', document.review_notes || '')
            : '';
        if (reviewStatus === 'rejected' && !notes?.trim()) return;
        setBusy(`document-${document.id}`);
        try {
            await reviewDriverApplicationDocument({
                applicationCode: detail.application_code,
                documentId: document.id,
                reviewStatus,
                notes: notes || '',
            });
            toast.success(reviewStatus === 'approved' ? 'Documento aprobado.' : 'Documento marcado para corrección.');
            await loadDetail(detail.application_code);
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy('');
        }
    };

    const openDocument = async (document) => {
        try {
            const { data, error } = await supabase.storage
                .from('driver-applications')
                .createSignedUrl(document.storage_path, 600);
            if (error || !data?.signedUrl) throw error || new Error('signed_url_failed');
            window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
        } catch (error) {
            toast.error(`No se pudo abrir el documento: ${error.message}`);
        }
    };

    const convert = async () => {
        if (!detail) return;
        const confirmed = window.confirm(`Se creará la cuenta Higo Driver para ${detail.full_name} y se enviará el acceso a ${detail.email}. ¿Continuar?`);
        if (!confirmed) return;
        setBusy('convert');
        try {
            const result = await convertDriverApplication({ applicationCode: detail.application_code });
            if (result.email_sent) toast.success('Driver registrado y correo de bienvenida enviado.');
            else toast.success('Driver registrado. El correo de bienvenida requiere revisión manual.');
            await refresh();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy('');
        }
    };

    const documentSummary = useMemo(() => {
        const docs = detail?.documents || [];
        return {
            total: docs.length,
            approved: docs.filter((item) => item.review_status === 'approved').length,
            rejected: docs.filter((item) => item.review_status === 'rejected').length,
            pending: docs.filter((item) => item.review_status === 'pending').length,
        };
    }, [detail]);

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-6">
            <div className="max-w-[1500px] mx-auto">
                <AdminNav />

                <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-6">
                    <div>
                        <p className="text-violet-400 text-xs font-black uppercase tracking-[0.18em]">Captación y onboarding</p>
                        <h1 className="text-3xl md:text-4xl font-black mt-1">Solicitudes de Higo Drivers</h1>
                        <p className="text-gray-400 mt-2">Revisa aspirantes, solicita requisitos, valida documentos y registra la cuenta final.</p>
                    </div>
                    <button onClick={() => navigate('/admin/drivers')} className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 font-bold text-sm">
                        Ver drivers registrados
                    </button>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)] gap-5 items-start">
                    <section className="bg-[#171A23] border border-white/5 rounded-3xl overflow-hidden">
                        <div className="p-4 border-b border-white/5 flex flex-col md:flex-row gap-3">
                            <div className="relative flex-1">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">search</span>
                                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código, nombre, correo, teléfono o placa"
                                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 py-3 outline-none focus:border-violet-500" />
                            </div>
                            <select value={status} onChange={(event) => setStatus(event.target.value)}
                                className="bg-black/20 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-violet-500">
                                {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </div>

                        {loading ? (
                            <div className="p-12 text-center text-gray-500">Cargando solicitudes…</div>
                        ) : rows.length === 0 ? (
                            <div className="p-12 text-center text-gray-500">No hay solicitudes para este filtro.</div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {rows.map((row) => (
                                    <button key={row.application_code} onClick={() => setSelectedCode(row.application_code)}
                                        className={`w-full text-left p-4 hover:bg-white/[0.035] transition-colors ${selectedCode === row.application_code ? 'bg-violet-500/[0.08]' : ''}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="font-black text-base truncate">{row.full_name}</p>
                                                    <StatusBadge status={row.status} />
                                                </div>
                                                <p className="text-xs text-violet-300 font-mono mt-1">{row.application_code}</p>
                                                <p className="text-sm text-gray-400 mt-2 truncate">{row.city} · {vehicleLabel(row.vehicle_type)} · {row.vehicle_brand} {row.vehicle_model}</p>
                                                <p className="text-xs text-gray-600 mt-1">{row.email} · {row.phone}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs text-gray-500">{fmtDate(row.created_at)}</p>
                                                <p className="text-xs text-gray-400 mt-2">{row.documents_count || 0} docs</p>
                                                {Number(row.pending_documents_count || 0) > 0 && <p className="text-[11px] text-amber-300 mt-1">{row.pending_documents_count} por revisar</p>}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                        {hasMore && <div className="p-4 border-t border-white/5"><button disabled={loadingMore} onClick={() => load({ append: true })} className="w-full py-3 rounded-xl bg-white/5 font-bold disabled:opacity-50">{loadingMore ? 'Cargando…' : 'Cargar más'}</button></div>}
                    </section>

                    <aside className="xl:sticky xl:top-4 bg-[#171A23] border border-white/5 rounded-3xl overflow-hidden max-h-[calc(100vh-2rem)] overflow-y-auto">
                        {!selectedCode ? (
                            <div className="p-12 text-center text-gray-500">
                                <span className="material-symbols-outlined text-5xl text-gray-700">assignment_ind</span>
                                <p className="mt-3">Selecciona una solicitud para administrarla.</p>
                            </div>
                        ) : detailLoading ? (
                            <div className="p-12 text-center text-gray-500">Abriendo solicitud…</div>
                        ) : detail ? (
                            <div>
                                <div className="p-5 border-b border-white/5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-mono text-violet-300">{detail.application_code}</p>
                                            <h2 className="text-2xl font-black mt-1">{detail.full_name}</h2>
                                            <p className="text-sm text-gray-500 mt-1">Actualizada {fmtDate(detail.updated_at)}</p>
                                        </div>
                                        <StatusBadge status={detail.status} />
                                    </div>
                                </div>

                                <div className="p-5 space-y-6">
                                    <div className="grid grid-cols-2 gap-2">
                                        <DetailField label="Correo" value={detail.email} />
                                        <DetailField label="Teléfono" value={detail.phone} />
                                        <DetailField label="Cédula" value={detail.cedula} />
                                        <DetailField label="Ciudad / zona" value={detail.city} />
                                        <DetailField label="Modalidad" value={vehicleLabel(detail.vehicle_type)} />
                                        <DetailField label="Vehículo" value={`${detail.vehicle_brand || ''} ${detail.vehicle_model || ''}`.trim()} />
                                        <DetailField label="Año / color" value={`${detail.vehicle_year || '—'} · ${detail.vehicle_color || '—'}`} />
                                        <DetailField label="Placa" value={detail.license_plate} />
                                    </div>

                                    <div>
                                        <label className="text-xs uppercase tracking-wider text-gray-500 font-black">Observación o motivo</label>
                                        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3}
                                            placeholder="Se incluirá en el correo cuando corresponda."
                                            className="mt-2 w-full bg-black/20 border border-white/10 rounded-xl px-3 py-3 outline-none focus:border-violet-500 resize-y" />
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {['received', 'waitlist'].includes(detail.status) && <button disabled={!!busy} onClick={() => performStatus('under_review')} className="px-4 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm disabled:opacity-50">Iniciar revisión</button>}
                                        {['received', 'under_review', 'correction_requested'].includes(detail.status) && <button disabled={!!busy} onClick={requestDocuments} className="px-4 py-2.5 rounded-xl bg-violet-600 font-black text-sm disabled:opacity-50">Solicitar requisitos</button>}
                                        {['under_review', 'documents_submitted'].includes(detail.status) && <button disabled={!!busy} onClick={() => performStatus('approved')} className="px-4 py-2.5 rounded-xl bg-emerald-500 text-black font-black text-sm disabled:opacity-50">Aprobar solicitud</button>}
                                        {detail.status === 'approved' && <button disabled={!!busy} onClick={convert} className="px-4 py-2.5 rounded-xl bg-green-500 text-black font-black text-sm disabled:opacity-50">Registrar driver y enviar acceso</button>}
                                        {!['converted', 'rejected', 'waitlist'].includes(detail.status) && <button disabled={!!busy} onClick={() => performStatus('waitlist')} className="px-4 py-2.5 rounded-xl bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 font-bold text-sm disabled:opacity-50">Lista de espera</button>}
                                        {!['converted', 'rejected'].includes(detail.status) && <button disabled={!!busy} onClick={() => performStatus('rejected')} className="px-4 py-2.5 rounded-xl bg-red-500/15 text-red-300 border border-red-500/30 font-bold text-sm disabled:opacity-50">Rechazar</button>}
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <div><p className="text-xs uppercase tracking-wider text-gray-500 font-black">Documentos</p><p className="text-sm text-gray-400 mt-1">{documentSummary.approved} aprobados · {documentSummary.pending} pendientes · {documentSummary.rejected} rechazados</p></div>
                                        </div>
                                        {(detail.documents || []).length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-gray-500">Todavía no hay documentos cargados.</div>
                                        ) : (
                                            <div className="space-y-2">
                                                {detail.documents.map((document) => (
                                                    <div key={document.id} className="rounded-2xl bg-black/20 border border-white/5 p-3">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="font-bold text-sm">{DOCUMENT_LABELS[document.document_type] || document.document_type}</p>
                                                                <p className="text-xs text-gray-500 truncate mt-1">{document.file_name} · {(Number(document.size_bytes || 0) / 1024 / 1024).toFixed(2)} MB</p>
                                                                {document.review_notes && <p className="text-xs text-orange-300 mt-2">{document.review_notes}</p>}
                                                            </div>
                                                            <StatusBadge status={document.review_status === 'pending' ? 'pending_delivery' : document.review_status === 'approved' ? 'approved' : 'rejected'} />
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 mt-3">
                                                            <button onClick={() => openDocument(document)} className="px-3 py-2 rounded-lg bg-white/5 text-xs font-bold">Abrir</button>
                                                            <button disabled={busy === `document-${document.id}`} onClick={() => reviewDocument(document, 'approved')} className="px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-bold disabled:opacity-50">Aprobar</button>
                                                            <button disabled={busy === `document-${document.id}`} onClick={() => reviewDocument(document, 'rejected')} className="px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-xs font-bold disabled:opacity-50">Solicitar corrección</button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-gray-500 font-black mb-3">Historial</p>
                                        <div className="space-y-3">
                                            {(detail.events || []).slice(0, 20).map((event) => (
                                                <div key={event.id} className="pl-4 border-l border-violet-500/30">
                                                    <p className="text-sm font-bold">{event.event_type.replaceAll('_', ' ')}</p>
                                                    <p className="text-xs text-gray-500 mt-1">{fmtDate(event.created_at)}{event.to_status ? ` · ${STATUS_META[event.to_status]?.[0] || event.to_status}` : ''}</p>
                                                </div>
                                            ))}
                                            {(detail.events || []).length === 0 && <p className="text-sm text-gray-500">Sin eventos registrados.</p>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="p-12 text-center text-red-300">No se pudo cargar la solicitud.</div>
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}
