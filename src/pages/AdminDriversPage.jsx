import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminNav from '../components/AdminNav';
import { useAdminContext } from '../components/AdminGuard';
import { supabase } from '../services/supabase';
import {
    archiveDriver,
    listDrivers,
    listMembershipPlans,
    recordMembership,
    setDriverException,
    voidMembership,
} from '../services/adminApi';
import { toast } from '../components/Toast';

const PAGE_SIZE = 50;
const EMPTY_DRIVER = {
    full_name: '',
    email: '',
    password: '',
    phone: '',
    vehicle_type: 'standard',
    vehicle_brand: '',
    vehicle_model: '',
    vehicle_color: '',
    license_plate: '',
    avatar_url: '',
    payment_qr_url: '',
};

const STATES = [
    ['all', 'Todos'],
    ['active', 'Vigentes'],
    ['expiring_soon', 'Por vencer'],
    ['expired', 'Vencidos'],
    ['no_membership', 'Sin membresía'],
    ['grace_period', 'Excepción'],
    ['suspended', 'Suspendidos'],
    ['archived', 'Archivados'],
];

const STATE_META = {
    active: ['Vigente', 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'],
    expiring_soon: ['Por vencer', 'bg-amber-500/15 text-amber-300 border-amber-500/30'],
    expired: ['Vencida', 'bg-red-500/15 text-red-300 border-red-500/30'],
    no_membership: ['Sin membresía', 'bg-gray-500/15 text-gray-300 border-gray-500/30'],
    grace_period: ['Excepción temporal', 'bg-blue-500/15 text-blue-300 border-blue-500/30'],
    suspended: ['Suspendido', 'bg-rose-500/15 text-rose-300 border-rose-500/30'],
    archived: ['Archivado', 'bg-gray-700/40 text-gray-400 border-gray-600/30'],
};

const fmtDate = (value) => value ? new Date(value).toLocaleDateString('es-VE') : '—';
const money = (value, currency = 'USD') => `${currency === 'USD' ? '$' : `${currency} `}${Number(value || 0).toFixed(2)}`;

const processGoogleDriveLink = (url) => {
    if (!url) return '';
    if (url.includes('drive.google.com') && url.includes('/file/d/')) {
        const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match?.[1]) return `https://drive.google.com/uc?export=view&id=${match[1]}`;
    }
    return url;
};

const compressImage = (file, maxSize = 1024, quality = 0.85) => new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
        resolve(file);
        return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('compression_failed'));
                return;
            }
            const baseName = (file.name || 'avatar').replace(/\.[^.]+$/, '');
            resolve(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image_load_failed'));
    };
    img.src = url;
});

const Modal = ({ title, children, onClose, wide = false }) => (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} bg-[#1A1F2E] border border-white/10 rounded-3xl my-8 overflow-hidden`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <h2 className="font-black text-lg">{title}</h2>
                <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5"><span className="material-symbols-outlined">close</span></button>
            </div>
            {children}
        </div>
    </div>
);

export default function AdminDriversPage() {
    const navigate = useNavigate();
    const adminContext = useAdminContext();
    const canCreateDriver = Boolean(adminContext?.permissions?.manage_drivers);
    const [drivers, setDrivers] = useState([]);
    const [plans, setPlans] = useState([]);
    const [query, setQuery] = useState('');
    const [state, setState] = useState('all');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [selected, setSelected] = useState(null);
    const [modal, setModal] = useState(null);
    const [busy, setBusy] = useState(false);
    const [docs, setDocs] = useState([]);
    const [docUrls, setDocUrls] = useState({});
    const [form, setForm] = useState({ planId: '', paymentMethod: 'pago_movil', reference: '', notes: '', amount: '' });
    const [newDriver, setNewDriver] = useState(EMPTY_DRIVER);
    const [avatarFile, setAvatarFile] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState('');

    const load = useCallback(async ({ append = false } = {}) => {
        append ? setLoadingMore(true) : setLoading(true);
        try {
            const rows = await listDrivers({ query, state, limit: PAGE_SIZE, offset: append ? drivers.length : 0 });
            setDrivers(prev => append ? [...prev, ...(rows || [])] : (rows || []));
            setHasMore((rows || []).length === PAGE_SIZE);
            return rows || [];
        } catch (err) {
            toast.error(`No se pudieron cargar los drivers: ${err.message}`);
            if (!append) setDrivers([]);
            return [];
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [query, state, drivers.length]);

    useEffect(() => {
        listMembershipPlans().then(rows => {
            setPlans(rows || []);
            if (rows?.[0]) setForm(f => ({ ...f, planId: f.planId || rows[0].id }));
        }).catch(err => toast.error(`No se pudieron cargar los planes: ${err.message}`));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => load(), 300);
        return () => clearTimeout(timer);
    }, [query, state]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => () => {
        if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    }, [avatarPreview]);

    const selectedPlan = useMemo(() => plans.find(p => p.id === form.planId), [plans, form.planId]);

    const openMembership = (driver) => {
        const vehicle = String(driver.vehicle_type || '').toLowerCase();
        const plan = plans.find(p => !p.vehicle_type || vehicle.includes(p.vehicle_type) || (p.vehicle_type === 'standard' && ['carro', 'car', 'standard'].some(v => vehicle.includes(v)))) || plans[0];
        setSelected(driver);
        setForm({ planId: plan?.id || '', paymentMethod: 'pago_movil', reference: '', notes: '', amount: plan?.amount ?? '' });
        setModal('membership');
    };

    const submitMembership = async () => {
        if (!selected || !form.planId || !form.paymentMethod.trim()) return;
        setBusy(true);
        try {
            await recordMembership({
                driverId: selected.id,
                planId: form.planId,
                paymentMethod: form.paymentMethod,
                paymentReference: form.reference,
                notes: form.notes,
                amount: form.amount,
            });
            toast.success('Membresía registrada y estado del driver reconciliado.');
            setModal(null);
            await load();
        } catch (err) {
            toast.error(err.message.includes('duplicate') ? 'La referencia de pago ya fue utilizada.' : err.message);
        } finally {
            setBusy(false);
        }
    };

    const registerDriver = async () => {
        if (!newDriver.full_name.trim() || !newDriver.email.trim()) {
            toast.error('Nombre y correo son obligatorios.');
            return;
        }
        setBusy(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            if (!accessToken) throw new Error('La sesión expiró. Iniciá sesión nuevamente.');

            const body = new FormData();
            Object.entries(newDriver).forEach(([key, value]) => {
                body.append(key, key.endsWith('_url') ? processGoogleDriveLink(value || '') : (value || ''));
            });
            if (avatarFile) {
                let prepared = avatarFile;
                try {
                    prepared = await compressImage(avatarFile);
                } catch {
                    prepared = avatarFile;
                }
                body.append('avatar_file', prepared, prepared.name);
            }

            const productionHosts = ['higoapp.com', 'www.higoapp.com'];
            const endpoint = productionHosts.includes(window.location.hostname)
                ? '/api/welcome-driver.php'
                : 'https://higoapp.com/api/welcome-driver.php';

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
                body,
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok || !result.user_id) {
                throw new Error(result.detail || result.error || `No se pudo crear el driver (HTTP ${response.status}).`);
            }

            const createdDriver = {
                id: result.user_id,
                full_name: newDriver.full_name.trim(),
                email: newDriver.email.trim().toLowerCase(),
                phone: newDriver.phone.trim(),
                vehicle_type: newDriver.vehicle_type,
                vehicle_brand: newDriver.vehicle_brand.trim(),
                vehicle_model: newDriver.vehicle_model.trim(),
                vehicle_color: newDriver.vehicle_color.trim(),
                license_plate: newDriver.license_plate.trim(),
                membership_state: 'no_membership',
            };

            try {
                await setDriverException({
                    driverId: result.user_id,
                    action: 'suspend',
                    reason: 'Alta administrativa pendiente de registrar membresía',
                });
            } catch (reconcileError) {
                console.error('[AdminDrivers] initial membership reconciliation failed:', reconcileError);
                throw new Error(`El conductor fue creado, pero no se pudo dejar pendiente de membresía: ${reconcileError.message}`);
            }

            toast.success(result.email_sent
                ? 'Higo Driver creado. Correo de bienvenida enviado.'
                : 'Higo Driver creado. El correo de bienvenida no pudo enviarse.');

            setNewDriver(EMPTY_DRIVER);
            setAvatarFile(null);
            if (avatarPreview) URL.revokeObjectURL(avatarPreview);
            setAvatarPreview('');
            await load();
            openMembership(createdDriver);
        } catch (err) {
            toast.error(err.message || 'No se pudo registrar el Higo Driver.');
        } finally {
            setBusy(false);
        }
    };

    const suspend = async (driver) => {
        const reason = prompt('Motivo obligatorio de la suspensión:', '');
        if (!reason?.trim()) return;
        setBusy(true);
        try {
            await setDriverException({ driverId: driver.id, action: 'suspend', reason });
            toast.success('Driver suspendido con registro de auditoría.');
            await load();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };

    const grantGrace = async (driver) => {
        const daysRaw = prompt('Días de excepción temporal:', '3');
        const days = Number(daysRaw);
        if (!Number.isFinite(days) || days <= 0 || days > 30) return toast.error('Ingresá entre 1 y 30 días.');
        const reason = prompt('Motivo obligatorio de la excepción:', '');
        if (!reason?.trim()) return;
        const until = new Date(Date.now() + days * 86400e3).toISOString();
        setBusy(true);
        try {
            await setDriverException({ driverId: driver.id, action: 'grace', reason, until });
            toast.success(`Excepción concedida por ${days} días.`);
            await load();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };

    const clearException = async (driver) => {
        const reason = prompt('Motivo para quitar la excepción o suspensión:', 'Estado regularizado');
        if (!reason?.trim()) return;
        setBusy(true);
        try {
            await setDriverException({ driverId: driver.id, action: 'clear', reason });
            toast.success('Estado reconciliado con la membresía real.');
            await load();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };

    const archive = async (driver) => {
        const reason = prompt(`Archivar a ${driver.full_name || 'este driver'} sin borrar su historial. Motivo obligatorio:`, '');
        if (!reason?.trim()) return;
        if (!confirm('El driver dejará de operar, pero sus datos e historial se conservarán. ¿Continuar?')) return;
        setBusy(true);
        try {
            await archiveDriver(driver.id, reason);
            toast.success('Driver archivado.');
            await load();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };

    const undoMembership = async (driver) => {
        if (!driver.membership_id) return;
        const reason = prompt('Motivo obligatorio para anular esta membresía:', '');
        if (!reason?.trim()) return;
        if (!confirm('La membresía quedará anulada, no eliminada. ¿Continuar?')) return;
        setBusy(true);
        try {
            await voidMembership(driver.membership_id, reason);
            toast.success('Membresía anulada y estado recalculado.');
            await load();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };

    const openSupport = async (driver) => {
        const { data: existing } = await supabase.from('support_threads').select('id').eq('user_id', driver.id).eq('role_context', 'driver').maybeSingle();
        let id = existing?.id;
        if (!id) {
            const { data, error } = await supabase.from('support_threads').upsert({ user_id: driver.id, role_context: 'driver' }, { onConflict: 'user_id,role_context' }).select('id').single();
            if (error) return toast.error(error.message);
            id = data.id;
        }
        navigate(`/admin/support?thread=${id}`);
    };

    const openDocs = async (driver) => {
        setSelected(driver);
        setModal('docs');
        setDocs([]);
        setDocUrls({});
        const { data, error } = await supabase.from('driver_documents').select('*').eq('user_id', driver.id).order('submitted_at', { ascending: false });
        if (error) return toast.error(error.message);
        setDocs(data || []);
        const urls = {};
        await Promise.all((data || []).map(async doc => {
            const { data: signed } = await supabase.storage.from('driver-docs').createSignedUrl(doc.file_path, 300);
            if (signed?.signedUrl) urls[doc.id] = signed.signedUrl;
        }));
        setDocUrls(urls);
    };

    const reviewDoc = async (doc, status) => {
        const reason = status === 'rejected' ? prompt('Motivo de rechazo visible para el driver:', '') : null;
        if (status === 'rejected' && !reason?.trim()) return;
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('driver_documents').update({ status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, rejection_reason: reason?.trim() || null }).eq('id', doc.id);
        if (error) return toast.error(error.message);
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status, rejection_reason: reason?.trim() || null } : d));
    };

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-black">Drivers y membresías</h1>
                    <p className="text-sm text-gray-400 mt-1">Creá la cuenta del Higo Driver y registrá su membresía como operaciones separadas y auditables.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    {canCreateDriver && (
                        <button onClick={() => setModal('register')} className="px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 font-bold flex items-center justify-center gap-2">
                            <span className="material-symbols-outlined">person_add</span>
                            Registrar Higo Driver
                        </button>
                    )}
                    <div className="text-xs text-gray-500 bg-white/5 rounded-xl px-4 py-3">Sin membresía vigente, el driver no puede operar.</div>
                </div>
            </div>

            <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 mb-5">
                <div className="flex flex-col lg:flex-row gap-3">
                    <div className="relative flex-1">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">search</span>
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar en todos los drivers por nombre, teléfono, placa o referencia…" className="w-full bg-[#0F1014] border border-white/10 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-violet-500" />
                    </div>
                    <select value={state} onChange={e => setState(e.target.value)} className="bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 outline-none">
                        {STATES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                    <button onClick={() => load()} className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10"><span className="material-symbols-outlined">refresh</span></button>
                </div>
            </div>

            {loading ? <div className="py-28 flex justify-center"><div className="w-9 h-9 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div> : (
                <div className="space-y-3">
                    {drivers.map(driver => {
                        const [label, cls] = STATE_META[driver.membership_state] || [driver.membership_state, STATE_META.no_membership[1]];
                        return (
                            <article key={driver.id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 grid xl:grid-cols-[1.4fr_1fr_1fr_auto] gap-4 items-center">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-12 h-12 rounded-full bg-[#0F1014] bg-cover bg-center shrink-0" style={{ backgroundImage: driver.avatar_url ? `url(${driver.avatar_url})` : undefined }}>
                                        {!driver.avatar_url && <span className="material-symbols-outlined w-full h-full flex items-center justify-center text-gray-600">person</span>}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold truncate">{driver.full_name || 'Sin nombre'}</p>
                                        <p className="text-xs text-gray-400 truncate">{driver.phone || 'Sin teléfono'} · {driver.license_plate || 'Sin placa'}</p>
                                        <p className="text-[10px] text-gray-600 mt-1">{driver.vehicle_brand || driver.vehicle_type || 'Vehículo sin registrar'} {driver.vehicle_model || ''}</p>
                                    </div>
                                </div>
                                <div>
                                    <span className={`inline-flex border rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>
                                    <p className="text-xs text-gray-400 mt-2">{driver.membership_plan || 'Sin plan'}</p>
                                    <p className="text-[10px] text-gray-600">Vence: {fmtDate(driver.expires_at)}</p>
                                </div>
                                <div className="text-sm">
                                    <p className="font-mono text-white">{driver.membership_amount != null ? money(driver.membership_amount, driver.currency) : '—'}</p>
                                    <p className="text-xs text-gray-500">Pago: {fmtDate(driver.paid_at)}</p>
                                    <p className="text-[10px] text-gray-600 truncate">Ref: {driver.payment_reference || '—'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 xl:justify-end">
                                    <button disabled={busy || driver.membership_state === 'archived'} onClick={() => openMembership(driver)} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold">Registrar membresía</button>
                                    <button onClick={() => openDocs(driver)} className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400" title="Documentos"><span className="material-symbols-outlined text-lg">badge</span></button>
                                    <button onClick={() => openSupport(driver)} className="w-9 h-9 rounded-lg bg-fuchsia-500/10 text-fuchsia-400" title="Soporte"><span className="material-symbols-outlined text-lg">chat</span></button>
                                    <details className="relative">
                                        <summary className="list-none w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center cursor-pointer"><span className="material-symbols-outlined">more_vert</span></summary>
                                        <div className="absolute right-0 top-11 z-20 min-w-52 bg-[#252A3A] border border-white/10 rounded-xl p-2 shadow-2xl space-y-1">
                                            <button onClick={() => grantGrace(driver)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs">Excepción temporal</button>
                                            <button onClick={() => suspend(driver)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-amber-300">Suspender</button>
                                            <button onClick={() => clearException(driver)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs">Reconciliar estado</button>
                                            {driver.membership_id && <button onClick={() => undoMembership(driver)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-orange-300">Anular última membresía</button>}
                                            {driver.membership_state !== 'archived' && <button onClick={() => archive(driver)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/10 text-xs text-red-300">Archivar driver</button>}
                                        </div>
                                    </details>
                                </div>
                            </article>
                        );
                    })}
                    {!drivers.length && <div className="py-20 text-center bg-[#1A1F2E] border border-dashed border-white/10 rounded-2xl text-gray-400">No hay drivers para este filtro.</div>}
                    {hasMore && <div className="text-center pt-4"><button disabled={loadingMore} onClick={() => load({ append: true })} className="px-6 py-3 rounded-full bg-[#1A1F2E] border border-white/10 text-sm font-bold">{loadingMore ? 'Cargando…' : 'Cargar más'}</button></div>}
                </div>
            )}

            {modal === 'register' && canCreateDriver && (
                <Modal wide title="Registrar nuevo Higo Driver" onClose={() => setModal(null)}>
                    <div className="p-6 space-y-5">
                        <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-4 text-sm text-violet-200">
                            Primero se crea la cuenta. Al finalizar se abrirá el registro de membresía para seleccionar el plan y guardar el pago.
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                            <label className="text-xs font-bold text-gray-400">Nombre completo *<input value={newDriver.full_name} onChange={e => setNewDriver(v => ({ ...v, full_name: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Correo *<input type="email" value={newDriver.email} onChange={e => setNewDriver(v => ({ ...v, email: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Teléfono<input value={newDriver.phone} onChange={e => setNewDriver(v => ({ ...v, phone: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Contraseña inicial<input type="password" value={newDriver.password} onChange={e => setNewDriver(v => ({ ...v, password: e.target.value }))} placeholder="Vacía = se genera automáticamente" className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Tipo de vehículo<select value={newDriver.vehicle_type} onChange={e => setNewDriver(v => ({ ...v, vehicle_type: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white"><option value="moto">Moto</option><option value="standard">Carro</option><option value="van">Camioneta</option></select></label>
                            <label className="text-xs font-bold text-gray-400">Placa<input value={newDriver.license_plate} onChange={e => setNewDriver(v => ({ ...v, license_plate: e.target.value.toUpperCase() }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Marca<input value={newDriver.vehicle_brand} onChange={e => setNewDriver(v => ({ ...v, vehicle_brand: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Modelo<input value={newDriver.vehicle_model} onChange={e => setNewDriver(v => ({ ...v, vehicle_model: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Color<input value={newDriver.vehicle_color} onChange={e => setNewDriver(v => ({ ...v, vehicle_color: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl text-white" /></label>
                            <label className="text-xs font-bold text-gray-400">Foto del driver<input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0] || null; if (avatarPreview) URL.revokeObjectURL(avatarPreview); setAvatarFile(file); setAvatarPreview(file ? URL.createObjectURL(file) : ''); }} className="mt-1 block w-full text-xs text-gray-400" /></label>
                        </div>
                        {avatarPreview && <img src={avatarPreview} alt="Vista previa" className="w-24 h-24 rounded-2xl object-cover border border-white/10" />}
                        <p className="text-xs text-gray-500">Los documentos se pueden revisar y aprobar después desde el botón de credencial en la ficha del driver.</p>
                        <button disabled={busy} onClick={registerDriver} className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 font-bold disabled:opacity-50">{busy ? 'Creando cuenta…' : 'Crear cuenta y continuar con membresía'}</button>
                    </div>
                </Modal>
            )}

            {modal === 'membership' && selected && <Modal title={`Registrar membresía · ${selected.full_name}`} onClose={() => setModal(null)}>
                <div className="p-6 space-y-4">
                    <div><label className="text-xs uppercase font-bold text-gray-500">Plan</label><select value={form.planId} onChange={e => { const p = plans.find(x => x.id === e.target.value); setForm(f => ({ ...f, planId: e.target.value, amount: p?.amount ?? f.amount })); }} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl">{plans.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.amount, p.currency)}</option>)}</select></div>
                    <div className="grid grid-cols-2 gap-3"><div><label className="text-xs uppercase font-bold text-gray-500">Monto</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl" /></div><div><label className="text-xs uppercase font-bold text-gray-500">Método</label><select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl"><option value="pago_movil">Pago móvil</option><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="cortesia">Cortesía autorizada</option></select></div></div>
                    <div><label className="text-xs uppercase font-bold text-gray-500">Referencia</label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Única cuando aplique" className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl" /></div>
                    <div><label className="text-xs uppercase font-bold text-gray-500">Notas</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl min-h-24" /></div>
                    <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200">Vigencia: {selectedPlan?.duration_days || 0} días. Esta acción queda registrada en auditoría.</div>
                    <button disabled={busy} onClick={submitMembership} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold disabled:opacity-50">{busy ? 'Registrando…' : 'Confirmar membresía'}</button>
                </div>
            </Modal>}

            {modal === 'docs' && selected && <Modal wide title={`Documentos · ${selected.full_name}`} onClose={() => setModal(null)}>
                <div className="p-6 grid md:grid-cols-2 gap-3">
                    {docs.map(doc => <div key={doc.id} className="bg-[#0F1014] border border-white/5 rounded-xl p-4"><div className="flex justify-between gap-3"><div><p className="font-bold capitalize">{doc.document_type?.replaceAll('_', ' ')}</p><p className="text-xs text-gray-500">{doc.status || 'pending'}</p></div>{docUrls[doc.id] && <a target="_blank" rel="noreferrer" href={docUrls[doc.id]} className="text-xs text-blue-400">Abrir</a>}</div>{doc.rejection_reason && <p className="text-xs text-red-300 mt-2">{doc.rejection_reason}</p>}<div className="flex gap-2 mt-3"><button onClick={() => reviewDoc(doc, 'approved')} className="px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs">Aprobar</button><button onClick={() => reviewDoc(doc, 'rejected')} className="px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-xs">Rechazar</button></div></div>)}
                    {!docs.length && <p className="text-gray-500 text-sm md:col-span-2 text-center py-12">No hay documentos cargados.</p>}
                </div>
            </Modal>}
        </div>
    );
}
