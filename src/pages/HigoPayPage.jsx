import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { supabase } from '../services/supabase';
import { validateBanescoPayment, VENEZUELAN_BANKS } from '../services/banesco';
import { getOfficialBcvRate } from '../services/bcv';
import { listDriverCheckoutPlans } from '../services/membershipApi';
import { apiUrl } from '../utils/apiUrl';
import { normalizeBanescoReference, normalizeTransferReference } from '../utils/paymentReference';
import { useDriverMembership } from '../hooks/useDriverMembership';

const RECEIVER = Object.freeze({
    bank: 'BANESCO',
    rif: 'J-402638850',
    accountNumber: '01340332563321061868',
    phone: '04120330315',
});

const PAYMENT_METHODS = Object.freeze([
    { id: 'pm_banesco', label: 'Pago Móvil', sub: 'Banesco → Banesco', icon: 'phone_android', mode: 'pm' },
    { id: 'pm_otros', label: 'Pago Móvil', sub: 'Otros → Banesco', icon: 'phone_iphone', mode: 'pm' },
    { id: 'tf_banesco', label: 'Transferencia', sub: 'Banesco → Banesco', icon: 'swap_horiz', mode: 'tf' },
    { id: 'tf_otros', label: 'Transferencia', sub: 'Otros → Banesco', icon: 'compare_arrows', mode: 'tf' },
]);

const today = () => new Date().toISOString().slice(0, 10);
const fmtUsd = (value) => `$${Number(value || 0).toFixed(2)}`;
const fmtBs = (value) => `${Number(value || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})} Bs`;
const isNative = Capacitor.isNativePlatform();

const normalizeLegacyPlan = (row, vehicleType) => row ? ({
    id: null,
    code: `${vehicleType}-${row.period || 'monthly'}-legacy`,
    name: row.display_name || `Plan ${vehicleType}`,
    vehicle_type: vehicleType,
    period: row.period || 'monthly',
    duration_days: row.period === 'weekly' ? 7 : 30,
    amount: Number(row.amount_usd || 0),
    currency: 'USD',
    legacy_amount_bs: row.amount_bs == null ? null : Number(row.amount_bs),
}) : null;

const Field = ({ label, value, onCopy, mono = false }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className={`text-sm text-white truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
        </div>
        <button type="button" onClick={onCopy} className="w-9 h-9 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10" aria-label={`Copiar ${label}`}>
            <span className="material-symbols-outlined text-lg">content_copy</span>
        </button>
    </div>
);

const FormField = ({ label, children }) => (
    <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1.5">{label}</span>
        {children}
    </label>
);

const MembershipBadge = ({ active, severity, daysLeft }) => {
    const styles = active
        ? severity === 'critical'
            ? 'bg-red-500/15 text-red-300 border-red-500/30'
            : severity === 'warn'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : 'bg-gray-500/15 text-gray-300 border-gray-500/30';
    const text = active
        ? daysLeft == null ? 'Activa' : `${Math.max(daysLeft, 0)}d`
        : 'Inactiva';
    return <span className={`px-3 py-1.5 rounded-full border text-xs font-black ${styles}`}>{text}</span>;
};

const ResultBanner = ({ result }) => {
    if (!result) return null;
    const style = result.kind === 'ok'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
        : result.kind === 'warn'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
            : 'bg-red-500/10 border-red-500/30 text-red-200';
    return <div className={`rounded-2xl border p-4 text-sm ${style}`}>{result.msg}</div>;
};

export default function HigoPayPage() {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [plans, setPlans] = useState([]);
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [bcv, setBcv] = useState(null);
    const [rides, setRides] = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);

    const [paymentType, setPaymentType] = useState('pm_banesco');
    const [bank, setBank] = useState('0134');
    const [phone, setPhone] = useState('');
    const [reference, setReference] = useState('');
    const [date, setDate] = useState(today());
    const [amount, setAmount] = useState('');
    const [receiptFile, setReceiptFile] = useState(null);
    const [receiptBase64, setReceiptBase64] = useState(null);
    const [receiptMimeType, setReceiptMimeType] = useState('image/jpeg');
    const [receiptPreview, setReceiptPreview] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState(null);

    const { expiresAt, daysLeft, severity, refresh: refreshMembership } = useDriverMembership(user?.id);

    const selectedPlan = useMemo(
        () => plans.find((plan) => String(plan.id || plan.code) === selectedPlanId) || plans[0] || null,
        [plans, selectedPlanId],
    );
    const currentMethod = PAYMENT_METHODS.find((method) => method.id === paymentType);
    const isPagoMovil = currentMethod?.mode === 'pm';
    const needsBankSelector = paymentType === 'pm_otros' || paymentType === 'tf_otros';
    const referenceMaxLength = isPagoMovil ? undefined : 12;
    const monthlyEarnings = useMemo(
        () => rides.reduce((sum, ride) => sum + Number(ride.price || 0), 0),
        [rides],
    );
    const membershipActive = profile?.subscription_status === 'active' && (daysLeft == null || daysLeft > 0);
    const expectedBs = useMemo(() => {
        if (!selectedPlan) return null;
        if (selectedPlan.amount && bcv?.rate) return Number(selectedPlan.amount) * Number(bcv.rate);
        return selectedPlan.legacy_amount_bs || null;
    }, [selectedPlan, bcv]);

    const refreshReports = async (driverId = user?.id) => {
        if (!driverId) return;
        const { data } = await supabase
            .from('payment_reports')
            .select('id, payment_type, bank_origin, reference_last6, amount_reported, amount_real, trn_date, status, error_message, receipt_url, created_at, membership_plan_code')
            .eq('driver_id', driverId)
            .order('created_at', { ascending: false })
            .limit(10);
        setReports(data || []);
    };

    const refreshProfile = async (driverId = user?.id) => {
        if (!driverId) return;
        const { data } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, vehicle_type, vehicle_model, subscription_status, last_payment_date, avatar_url, referral_code, referral_credit_balance')
            .eq('id', driverId)
            .single();
        if (data) setProfile(data);
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const { data: { user: currentUser } } = await supabase.auth.getUser();
                if (!currentUser) {
                    navigate('/auth');
                    return;
                }

                const { data: currentProfile } = await supabase
                    .from('profiles')
                    .select('id, full_name, email, role, vehicle_type, vehicle_model, subscription_status, last_payment_date, avatar_url, referral_code, referral_credit_balance')
                    .eq('id', currentUser.id)
                    .single();
                if (!currentProfile || currentProfile.role !== 'driver') {
                    navigate('/');
                    return;
                }

                let checkoutPlans = [];
                try {
                    checkoutPlans = await listDriverCheckoutPlans();
                } catch (error) {
                    console.warn('[HigoPay] unified checkout unavailable; using legacy fallback:', error?.message || error);
                }

                if (!checkoutPlans?.length) {
                    const vehicleType = ['moto', 'standard', 'van'].includes(currentProfile.vehicle_type)
                        ? currentProfile.vehicle_type
                        : 'standard';
                    const { data: legacyRow } = await supabase
                        .from('membership_plans')
                        .select('plan, period, amount_usd, amount_bs, display_name')
                        .eq('plan', vehicleType)
                        .maybeSingle();
                    const normalized = normalizeLegacyPlan(legacyRow, vehicleType);
                    checkoutPlans = normalized ? [normalized] : [];
                }

                const [officialRate, ridesResult, reportsResult] = await Promise.all([
                    getOfficialBcvRate(),
                    supabase
                        .from('rides')
                        .select('id, price, status, created_at')
                        .eq('driver_id', currentUser.id)
                        .eq('status', 'completed')
                        .gte('created_at', new Date(Date.now() - 30 * 86400e3).toISOString())
                        .order('created_at', { ascending: false })
                        .limit(200),
                    supabase
                        .from('payment_reports')
                        .select('id, payment_type, bank_origin, reference_last6, amount_reported, amount_real, trn_date, status, error_message, receipt_url, created_at, membership_plan_code')
                        .eq('driver_id', currentUser.id)
                        .order('created_at', { ascending: false })
                        .limit(10),
                ]);

                if (cancelled) return;
                setUser(currentUser);
                setProfile(currentProfile);
                setPlans(checkoutPlans || []);
                const preferred = checkoutPlans?.find((plan) => plan.period === 'monthly') || checkoutPlans?.[0];
                setSelectedPlanId(preferred ? String(preferred.id || preferred.code) : '');
                setBcv(officialRate);
                setRides(ridesResult.data || []);
                setReports(reportsResult.data || []);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [navigate]);

    useEffect(() => {
        if (expectedBs) setAmount(Number(expectedBs).toFixed(2));
    }, [expectedBs, selectedPlanId]);

    const clearReceipt = () => {
        setReceiptFile(null);
        setReceiptBase64(null);
        setReceiptPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const switchMethod = (methodId) => {
        setPaymentType(methodId);
        setBank(methodId === 'pm_banesco' || methodId === 'tf_banesco' ? '0134' : '0102');
        setPhone('');
        setReference('');
        clearReceipt();
        setResult(null);
    };

    const pickReceiptNative = async (source) => {
        try {
            const photo = await Camera.getPhoto({
                resultType: CameraResultType.Base64,
                source,
                quality: 80,
                allowEditing: false,
                saveToGallery: false,
            });
            setReceiptBase64(photo.base64String || null);
            setReceiptMimeType(photo.format === 'png' ? 'image/png' : 'image/jpeg');
            setReceiptPreview(photo.base64String ? `data:image/${photo.format};base64,${photo.base64String}` : null);
            setReceiptFile(null);
        } catch (error) {
            if (!/cancelled|dismissed/i.test(String(error))) {
                setResult({ kind: 'bad', msg: 'No se pudo obtener la foto.' });
            }
        }
    };

    const uploadReceipt = async (fileOrBase64, mimeType = 'image/jpeg') => {
        let blob;
        let extension;
        if (typeof fileOrBase64 === 'string') {
            const chars = atob(fileOrBase64);
            const bytes = new Uint8Array(chars.length);
            for (let index = 0; index < chars.length; index += 1) bytes[index] = chars.charCodeAt(index);
            blob = new Blob([bytes], { type: mimeType });
            extension = mimeType === 'image/png' ? 'png' : 'jpg';
        } else {
            blob = fileOrBase64;
            extension = String(fileOrBase64.name || 'receipt.jpg').split('.').pop().toLowerCase();
        }
        const path = `${user.id}/${Date.now()}.${extension}`;
        const { error } = await supabase.storage.from('payment-receipts').upload(path, blob, {
            upsert: false,
            contentType: typeof fileOrBase64 === 'string' ? mimeType : undefined,
        });
        if (error) throw error;
        const { data } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 60 * 60 * 24 * 30);
        return data?.signedUrl || null;
    };

    const notifyAdmin = async ({ status, errorMessage = '', receiptUrl = '' }) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;
            await fetch(apiUrl('/api/notify-payment.php'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    driver_name: profile?.full_name || user?.email || '',
                    driver_email: user?.email || '',
                    payment_type: paymentType,
                    plan_code: selectedPlan?.code || '',
                    amount_bs: amount,
                    reference,
                    trn_date: date,
                    status,
                    receipt_url: receiptUrl,
                    error_message: errorMessage,
                }),
            });
        } catch {
            // Notification is ancillary and must never change payment outcome.
        }
    };

    const insertRejectedReport = async ({ bankCode, receiptUrl, validation, message }) => {
        const payload = {
            driver_id: user.id,
            payment_type: paymentType,
            bank_origin: bankCode,
            reference_last6: reference,
            sender_phone: phone || null,
            amount_reported: Number(amount),
            amount_real: validation?.amountReal ?? null,
            trn_date: validation?.trnDate || date,
            banesco_status: validation?.statusCode || validation?.errorCode || null,
            status: 'rejected',
            error_message: message,
            receipt_url: receiptUrl || null,
        };
        if (selectedPlan?.id) {
            payload.membership_plan_id = selectedPlan.id;
            payload.membership_plan_code = selectedPlan.code;
        }
        await supabase.from('payment_reports').insert(payload);
    };

    const handlePagoMovil = async () => {
        if (!selectedPlan) throw new Error('Seleccioná un plan de membresía.');
        if (!/^\d{6}$/.test(reference)) throw new Error('Ingresa los últimos 6 dígitos de la referencia.');
        if (!phone) throw new Error('Ingresá el teléfono emisor.');
        const paidAmount = Number(amount);
        if (!(paidAmount > 0)) throw new Error('Monto inválido.');

        let receiptUrl = '';
        if (receiptBase64) receiptUrl = await uploadReceipt(receiptBase64, receiptMimeType) || '';
        else if (receiptFile) receiptUrl = await uploadReceipt(receiptFile) || '';

        const bankCode = paymentType === 'pm_banesco' ? '0134' : bank;
        const validation = await validateBanescoPayment({
            reference,
            amount: paidAmount,
            phone,
            date,
            bank: bankCode,
            planId: selectedPlan.id,
            paymentType,
        });

        if (!validation.ok) {
            if (validation.errorCode !== 'ALREADY_VALIDATED') {
                await insertRejectedReport({
                    bankCode,
                    receiptUrl,
                    validation,
                    message: validation.errorMessage || 'No se pudo validar el pago.',
                });
            }
            await notifyAdmin({ status: 'rejected', errorMessage: validation.errorMessage, receiptUrl });
            throw new Error(validation.errorMessage || 'No se pudo validar el pago.');
        }

        if (!validation.withinTolerance) {
            const expected = Number(validation.expectedBs || expectedBs || 0);
            const message = `Monto insuficiente. Banesco recibió ${fmtBs(validation.amountReal)} y el plan cuesta ${fmtBs(expected)}.`;
            await insertRejectedReport({ bankCode, receiptUrl, validation, message });
            await notifyAdmin({ status: 'rejected', errorMessage: message, receiptUrl });
            setResult({ kind: 'warn', msg: message });
            await refreshReports();
            return;
        }

        if (receiptUrl && validation.reportId) {
            await supabase.from('payment_reports').update({ receipt_url: receiptUrl }).eq('id', validation.reportId);
        }
        const expiry = validation.expiresAt
            ? new Date(validation.expiresAt).toLocaleDateString('es-VE')
            : '—';
        await notifyAdmin({ status: 'validated', receiptUrl });
        setResult({ kind: 'ok', msg: `Pago validado. ${validation.planName || selectedPlan.name} activo hasta ${expiry}.` });
        setReference('');
        clearReceipt();
        await Promise.all([refreshProfile(), refreshReports(), refreshMembership()]);
    };

    const handleTransfer = async () => {
        if (!selectedPlan) throw new Error('Seleccioná un plan de membresía.');
        if (!receiptFile && !receiptBase64) throw new Error('Debés adjuntar el comprobante.');
        if (!/^\d{4,12}$/.test(reference)) throw new Error('La referencia debe tener entre 4 y 12 dígitos.');
        const paidAmount = Number(amount);
        if (!(paidAmount > 0)) throw new Error('Monto inválido.');

        const receiptUrl = receiptBase64
            ? await uploadReceipt(receiptBase64, receiptMimeType)
            : await uploadReceipt(receiptFile);
        if (!receiptUrl) throw new Error('No se pudo subir el comprobante.');

        const payload = {
            driver_id: user.id,
            payment_type: paymentType,
            bank_origin: paymentType === 'tf_banesco' ? '0134' : bank,
            reference_last6: reference,
            sender_phone: null,
            amount_reported: paidAmount,
            amount_real: null,
            trn_date: date,
            status: 'pending',
            receipt_url: receiptUrl,
        };
        if (selectedPlan.id) {
            payload.membership_plan_id = selectedPlan.id;
            payload.membership_plan_code = selectedPlan.code;
        }
        const { error } = await supabase.from('payment_reports').insert(payload);
        if (error) throw error;

        await notifyAdmin({ status: 'pending', receiptUrl });
        setResult({ kind: 'warn', msg: `Transferencia registrada para ${selectedPlan.name}. Un administrador verificará el pago.` });
        setReference('');
        clearReceipt();
        await refreshReports();
    };

    const onSubmit = async (event) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setResult(null);
        try {
            if (isPagoMovil) await handlePagoMovil();
            else await handleTransfer();
        } catch (error) {
            setResult({ kind: 'bad', msg: error?.message || 'No se pudo registrar el pago.' });
        } finally {
            setSubmitting(false);
        }
    };

    const copyValue = async (label, value) => {
        await navigator.clipboard.writeText(value);
        setResult({ kind: 'ok', msg: `${label} copiado.` });
    };

    const copyAll = async () => {
        const rows = isPagoMovil
            ? [`Banco: ${RECEIVER.bank}`, `RIF: ${RECEIVER.rif}`, `Teléfono: ${RECEIVER.phone}`]
            : [`Banco: ${RECEIVER.bank}`, `RIF: ${RECEIVER.rif}`, `Cuenta: ${RECEIVER.accountNumber}`];
        if (expectedBs) rows.push(`Monto: ${fmtBs(expectedBs)}`);
        await navigator.clipboard.writeText(rows.join('\n'));
        setResult({ kind: 'ok', msg: 'Datos bancarios copiados.' });
    };

    const logout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('session_id');
        navigate('/auth');
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-[#0F1014] text-white">Cargando Higo Pay…</div>;
    }

    return (
        <div className="min-h-screen bg-[#0F1014] text-white pb-20">
            <header className="sticky top-0 z-20 bg-[#0F1014]/95 backdrop-blur-md border-b border-white/5">
                <div className="px-4 py-4 flex items-center gap-3 max-w-2xl mx-auto">
                    <button onClick={() => navigate('/driver')} className="w-10 h-10 bg-[#1A1F2E] rounded-full flex items-center justify-center" aria-label="Volver">
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <div className="flex-1">
                        <h1 className="text-xl font-black">Higo <span className="text-cyan-400">Pay</span></h1>
                        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    </div>
                    <button onClick={logout} className="text-xs text-gray-400 px-3 py-2 rounded-lg hover:bg-white/5">Cerrar sesión</button>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
                <section className="bg-gradient-to-br from-cyan-600/15 to-blue-600/15 border border-cyan-500/30 rounded-3xl p-5">
                    <div className="flex items-center gap-4">
                        {profile?.avatar_url
                            ? <img src={profile.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border border-white/10" />
                            : <div className="w-14 h-14 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-300 font-black text-xl">{(profile?.full_name || user?.email || '?')[0]?.toUpperCase()}</div>}
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg truncate">{profile?.full_name || 'Higo Driver'}</p>
                            <p className="text-xs text-gray-400">{profile?.vehicle_type || 'standard'}</p>
                        </div>
                        <MembershipBadge active={membershipActive} severity={severity} daysLeft={daysLeft} />
                    </div>
                    <p className="text-xs text-gray-400 mt-3">
                        {expiresAt
                            ? `${membershipActive ? 'Membresía vigente hasta' : 'La membresía venció el'} ${expiresAt.toLocaleDateString('es-VE')}`
                            : 'Todavía no hay una membresía registrada.'}
                    </p>
                </section>

                <section className="grid grid-cols-2 gap-3">
                    <div className="bg-[#1A1F2E] rounded-2xl p-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500">Ganancias 30 días</p>
                        <p className="text-2xl font-black text-emerald-400 mt-1">{fmtUsd(monthlyEarnings)}</p>
                    </div>
                    <div className="bg-[#1A1F2E] rounded-2xl p-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500">Viajes completados</p>
                        <p className="text-2xl font-black mt-1">{rides.length}</p>
                    </div>
                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <h2 className="font-black">Seleccioná tu membresía</h2>
                            <p className="text-xs text-gray-500">Los planes corresponden al vehículo registrado.</p>
                        </div>
                        {bcv?.rate && <span className="text-[10px] text-cyan-300 font-mono">BCV {Number(bcv.rate).toFixed(2)}</span>}
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        {plans.map((plan) => {
                            const key = String(plan.id || plan.code);
                            const selected = key === selectedPlanId;
                            const amountBs = plan.amount && bcv?.rate
                                ? Number(plan.amount) * Number(bcv.rate)
                                : plan.legacy_amount_bs;
                            return (
                                <button key={key} type="button" onClick={() => setSelectedPlanId(key)}
                                    className={`text-left p-4 rounded-2xl border transition ${selected ? 'border-cyan-400 bg-cyan-500/15' : 'border-white/10 bg-[#0F1014] hover:border-white/20'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-bold">{plan.name}</p>
                                            <p className="text-xs text-gray-500 capitalize">{plan.period} · {plan.duration_days} días</p>
                                        </div>
                                        {selected && <span className="material-symbols-outlined text-cyan-300">check_circle</span>}
                                    </div>
                                    <p className="text-xl font-black text-cyan-300 mt-3">{fmtUsd(plan.amount)}</p>
                                    {amountBs && <p className="text-xs text-gray-400">{fmtBs(amountBs)}</p>}
                                </button>
                            );
                        })}
                        {!plans.length && <p className="text-sm text-red-300 sm:col-span-2">No hay planes disponibles para este vehículo. Contactá soporte.</p>}
                    </div>
                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-4">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-3">Método de pago</p>
                    <div className="grid grid-cols-2 gap-2">
                        {PAYMENT_METHODS.map((method) => (
                            <button key={method.id} type="button" onClick={() => switchMethod(method.id)}
                                className={`flex items-center gap-3 p-3 rounded-2xl border text-left ${paymentType === method.id ? 'bg-cyan-500/15 border-cyan-500/50' : 'bg-[#0F1014] border-white/5 text-gray-400'}`}>
                                <span className={`material-symbols-outlined ${paymentType === method.id ? 'text-cyan-300' : 'text-gray-500'}`}>{method.icon}</span>
                                <div className="min-w-0"><p className="text-xs font-bold truncate">{method.label}</p><p className="text-[10px] text-gray-500 truncate">{method.sub}</p></div>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="bg-[#1A1F2E] border border-cyan-500/20 rounded-3xl overflow-hidden">
                    <div className="bg-cyan-500/10 px-5 py-4 border-b border-cyan-500/20 flex justify-between gap-4">
                        <div><p className="text-xs font-bold text-cyan-300 uppercase">Datos para {isPagoMovil ? 'Pago Móvil' : 'Transferencia'}</p><p className="text-sm text-gray-300">Banco {RECEIVER.bank}</p></div>
                        {expectedBs && <div className="text-right"><p className="text-[10px] text-gray-500">Monto esperado</p><p className="font-black text-cyan-300">{fmtBs(expectedBs)}</p></div>}
                    </div>
                    <div className="p-5 space-y-3">
                        <Field label="RIF" value={RECEIVER.rif} onCopy={() => copyValue('RIF', RECEIVER.rif)} />
                        {isPagoMovil
                            ? <Field label="Teléfono" value={RECEIVER.phone} mono onCopy={() => copyValue('Teléfono', RECEIVER.phone)} />
                            : <Field label="Cuenta" value={RECEIVER.accountNumber} mono onCopy={() => copyValue('Cuenta', RECEIVER.accountNumber)} />}
                    </div>
                    <button type="button" onClick={copyAll} className="w-full py-3 bg-cyan-500/15 text-cyan-200 font-bold text-sm border-t border-cyan-500/20">Copiar todos los datos</button>
                </section>

                <form onSubmit={onSubmit} className="bg-[#1A1F2E] rounded-3xl p-5 space-y-4">
                    <div><h2 className="font-black">Reportar pago</h2><p className="text-xs text-gray-500">{isPagoMovil ? 'La validación y activación son automáticas.' : 'La transferencia será revisada por Administración.'}</p></div>

                    {isPagoMovil && <FormField label="Teléfono emisor"><input value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="04121234567" required className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono" /></FormField>}

                    {needsBankSelector && <FormField label="Banco origen"><select value={bank} onChange={(event) => setBank(event.target.value)} className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm">{VENEZUELAN_BANKS.filter((item) => item.code !== '0134').map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></FormField>}

                    <div className="grid grid-cols-2 gap-3">
                        <FormField label={isPagoMovil ? 'Referencia · Últimos 6 dígitos' : 'Referencia'}>
                  <input
                      value={reference}
                      onChange={(event) => setReference(isPagoMovil
                          ? normalizeBanescoReference(event.target.value)
                          : normalizeTransferReference(event.target.value))}
                      onPaste={(event) => {
                          const pasted = event.clipboardData?.getData('text') || '';
                          if (!pasted) return;
                          event.preventDefault();
                          setReference(isPagoMovil
                              ? normalizeBanescoReference(pasted)
                              : normalizeTransferReference(pasted));
                      }}
                      inputMode="numeric"
                      maxLength={referenceMaxLength}
                      placeholder={isPagoMovil ? 'Ej. 229907' : ''}
                      required
                      className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono"
                  />
              </FormField>
                        <FormField label="Fecha"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} max={today()} required className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm" /></FormField>
                    </div>

                    <FormField label="Monto pagado (Bs)"><input type="number" step="0.01" min="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono" /></FormField>

                    <FormField label={isPagoMovil ? 'Comprobante (opcional)' : 'Comprobante (obligatorio)'}>
                        {isNative ? (
                            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => pickReceiptNative(CameraSource.Camera)} className="py-3 rounded-xl bg-white/5 text-sm">Tomar foto</button><button type="button" onClick={() => pickReceiptNative(CameraSource.Photos)} className="py-3 rounded-xl bg-white/5 text-sm">Galería</button></div>
                        ) : (
                            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={(event) => { const file = event.target.files?.[0] || null; setReceiptFile(file); setReceiptBase64(null); setReceiptPreview(file?.type.startsWith('image/') ? URL.createObjectURL(file) : null); }} className="block w-full text-xs text-gray-400" />
                        )}
                    </FormField>
                    {receiptPreview && <img src={receiptPreview} alt="Comprobante" className="max-h-56 rounded-2xl object-contain bg-black/20 w-full" />}

                    <ResultBanner result={result} />
                    <button disabled={submitting || !selectedPlan} className="w-full py-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-black disabled:opacity-50">{submitting ? 'Procesando…' : isPagoMovil ? 'Validar y activar membresía' : 'Enviar para revisión'}</button>
                </form>

                <section className="bg-[#1A1F2E] rounded-3xl p-5">
                    <h2 className="font-black mb-4">Historial de pagos</h2>
                    <div className="space-y-3">
                        {reports.map((report) => (
                            <div key={report.id} className="bg-[#0F1014] border border-white/5 rounded-2xl p-4 flex items-start justify-between gap-3">
                                <div className="min-w-0"><p className="font-bold text-sm">{report.membership_plan_code || report.payment_type}</p><p className="text-xs text-gray-500">Ref. {report.reference_last6 || '—'} · {report.trn_date || new Date(report.created_at).toLocaleDateString('es-VE')}</p>{report.error_message && <p className="text-xs text-red-300 mt-1 line-clamp-2">{report.error_message}</p>}</div>
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${report.status === 'validated' ? 'bg-emerald-500/15 text-emerald-300' : report.status === 'pending' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>{report.status}</span>
                            </div>
                        ))}
                        {!reports.length && <p className="text-sm text-gray-500 text-center py-6">No hay pagos registrados.</p>}
                    </div>
                </section>
            </main>
        </div>
    );
}
