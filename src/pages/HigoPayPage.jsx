import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { validateBanescoPayment, VENEZUELAN_BANKS } from '../services/banesco';
import { getOfficialBcvRate } from '../services/bcv';
import { useDriverMembership } from '../hooks/useDriverMembership';

const RECEIVER = {
    bank:          'BANESCO',
    rif:           'J-402638850',
    accountNumber: '01340332563321061868',
    phone:         '04120330315',
};

const PAYMENT_METHODS = [
    { id: 'pm_banesco', label: 'Pago Móvil',    sub: 'Banesco → Banesco', icon: 'phone_android', mode: 'pm' },
    { id: 'pm_otros',   label: 'Pago Móvil',    sub: 'Otros → Banesco',   icon: 'phone_iphone',  mode: 'pm' },
    { id: 'tf_banesco', label: 'Transferencia',  sub: 'Banesco → Banesco', icon: 'swap_horiz',    mode: 'tf' },
    { id: 'tf_otros',   label: 'Transferencia',  sub: 'Otros → Banesco',   icon: 'compare_arrows',mode: 'tf' },
];

const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtBs  = (n) => `${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
const today  = () => new Date().toISOString().slice(0, 10);

const HigoPayPage = () => {
    const navigate = useNavigate();

    const [user, setUser]       = useState(null);
    const [profile, setProfile] = useState(null);
    const [plan, setPlan]       = useState(null);
    const [bcv, setBcv]         = useState(null);
    const [rides, setRides]     = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);

    // Payment method selector
    const [paymentType, setPaymentType] = useState('pm_banesco');

    // Form state
    const [bank, setBank]           = useState('0102');
    const [phone, setPhone]         = useState('');
    const [reference, setReference] = useState('');
    const [date, setDate]           = useState(today());
    const [amount, setAmount]       = useState('');
    const [receiptFile, setReceiptFile] = useState(null);
    const fileInputRef = useRef(null);

    const [submitting, setSubmitting] = useState(false);
    const [result, setResult]         = useState(null); // {ok, msg, kind}

    const currentMethod = PAYMENT_METHODS.find(m => m.id === paymentType);
    const isPm = currentMethod?.mode === 'pm';
    const isTf = currentMethod?.mode === 'tf';
    const needsBankSelector = paymentType === 'pm_otros' || paymentType === 'tf_otros';
    const refMaxLen = isPm ? 8 : 12;

    useEffect(() => {
        const load = async () => {
            const { data: { user: u } } = await supabase.auth.getUser();
            if (!u) { navigate('/auth'); return; }
            setUser(u);

            const { data: prof } = await supabase
                .from('profiles')
                .select('id, full_name, role, vehicle_model, subscription_status, last_payment_date, avatar_url')
                .eq('id', u.id)
                .single();
            if (!prof || prof.role !== 'driver') { navigate('/'); return; }
            setProfile(prof);

            const planKey = ['moto', 'standard', 'van'].includes(prof.vehicle_model)
                ? prof.vehicle_model
                : 'standard';
            const [{ data: planRow }, bcvRate] = await Promise.all([
                supabase
                    .from('membership_plans')
                    .select('plan, period, amount_usd, amount_bs, bs_updated_at')
                    .eq('plan', planKey)
                    .maybeSingle(),
                getOfficialBcvRate(),
            ]);
            setPlan(planRow || null);
            setBcv(bcvRate);

            const live = (planRow?.amount_usd && bcvRate?.rate)
                ? Number(planRow.amount_usd) * Number(bcvRate.rate)
                : null;
            const fallback = planRow?.amount_bs ? Number(planRow.amount_bs) : null;
            const computed = live ?? fallback;
            if (computed) setAmount(computed.toFixed(2));

            const { data: ridesData } = await supabase
                .from('rides')
                .select('id, price, status, created_at')
                .eq('driver_id', u.id)
                .eq('status', 'completed')
                .gte('created_at', new Date(Date.now() - 30 * 86400e3).toISOString())
                .order('created_at', { ascending: false })
                .limit(200);
            setRides(ridesData || []);

            const { data: reportsData } = await supabase
                .from('payment_reports')
                .select('id, payment_type, bank_origin, reference_last6, amount_reported, amount_real, trn_date, status, error_message, receipt_url, created_at')
                .eq('driver_id', u.id)
                .order('created_at', { ascending: false })
                .limit(10);
            setReports(reportsData || []);

            setLoading(false);
        };
        load();
    }, [navigate]);

    const { expiresAt, daysLeft, severity, refresh: refreshMembership } = useDriverMembership(user?.id);

    const monthlyEarnings = useMemo(() => rides.reduce((s, r) => s + Number(r.price || 0), 0), [rides]);

    const membershipActive = profile?.subscription_status === 'active';

    const liveBsAmount = useMemo(() => {
        if (plan?.amount_usd && bcv?.rate) return Number(plan.amount_usd) * Number(bcv.rate);
        return plan?.amount_bs ? Number(plan.amount_bs) : null;
    }, [plan, bcv]);

    // Reset form fields when payment type changes
    const switchMethod = (id) => {
        setPaymentType(id);
        setReference('');
        setPhone('');
        setReceiptFile(null);
        setResult(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        const method = PAYMENT_METHODS.find(m => m.id === id);
        if (method?.id === 'pm_banesco' || method?.id === 'tf_banesco') {
            setBank('0134');
        } else {
            setBank('0102');
        }
    };

    const notifyAdmin = async ({ status, errorMessage = '', receiptUrl = '' }) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;
            await fetch('/api/notify-payment.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    driver_name:   profile?.full_name || user?.email || '',
                    driver_email:  user?.email || '',
                    payment_type:  paymentType,
                    amount_bs:     amount,
                    reference,
                    trn_date:      date,
                    status,
                    receipt_url:   receiptUrl,
                    error_message: errorMessage,
                }),
            });
        } catch { /* fire and forget */ }
    };

    const uploadReceipt = async (file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage
            .from('payment-receipts')
            .upload(path, file, { upsert: false });
        if (error) return null;
        const { data } = await supabase.storage
            .from('payment-receipts')
            .createSignedUrl(path, 60 * 60 * 24 * 30);
        return data?.signedUrl || null;
    };

    const handlePagoMovil = async () => {
        if (!/^\d{1,8}$/.test(reference)) {
            setResult({ kind: 'bad', msg: 'La referencia debe ser numérica (1–8 dígitos).' });
            return;
        }
        const amt = Number(amount);
        if (!(amt > 0)) {
            setResult({ kind: 'bad', msg: 'Monto inválido.' });
            return;
        }

        const bankCode = paymentType === 'pm_banesco' ? '0134' : bank;

        // Subir comprobante si se adjuntó (opcional en PM)
        let receiptUrl = '';
        if (receiptFile) {
            receiptUrl = (await uploadReceipt(receiptFile)) || '';
        }

        const r = await validateBanescoPayment({ reference, amount: amt, phone, date, bank: bankCode });

        if (!r.ok && r.errorCode === 'BAD_TOKEN') {
            setResult({ kind: 'bad', msg: 'Tu sesión expiró. Volvé a iniciar sesión.' });
            setTimeout(() => navigate('/auth'), 1200);
            return;
        }

        if (!r.ok) {
            if (r.errorCode !== 'ALREADY_VALIDATED') {
                await supabase.from('payment_reports').insert({
                    driver_id:        user.id,
                    payment_type:     paymentType,
                    bank_origin:      bankCode,
                    reference_last6:  reference,
                    sender_phone:     phone || null,
                    amount_reported:  amt,
                    amount_real:      null,
                    trn_date:         date,
                    banesco_status:   r.statusCode || r.errorCode || null,
                    status:           'rejected',
                    error_message:    r.errorMessage || 'Error desconocido',
                    raw_response:     r.raw || null,
                    receipt_url:      receiptUrl || null,
                });
            }
            await notifyAdmin({ status: 'rejected', errorMessage: r.errorMessage, receiptUrl });
            setResult({ kind: 'bad', msg: r.errorMessage || 'No se pudo validar.' });
            await refreshReports();
            return;
        }

        if (!r.withinTolerance) {
            const expected = Number(r.expectedBs) || 0;
            await supabase.from('payment_reports').insert({
                driver_id:       user.id,
                payment_type:    paymentType,
                bank_origin:     bankCode,
                reference_last6: reference,
                sender_phone:    phone || null,
                amount_reported: amt,
                amount_real:     r.amountReal,
                trn_date:        r.trnDate || date,
                banesco_status:  r.statusCode,
                status:          'rejected',
                error_message:   `Monto insuficiente. Banesco recibió ${r.amountReal} Bs; el plan cuesta ${expected} Bs.`,
                raw_response:    r.raw || null,
                receipt_url:     receiptUrl || null,
            });
            await notifyAdmin({ status: 'rejected', errorMessage: `Monto insuficiente: ${r.amountReal} Bs recibido`, receiptUrl });
            setResult({ kind: 'warn', msg: `Banesco confirmó el pago, pero el monto no alcanza: recibió ${fmtBs(r.amountReal)} y el plan cuesta ${fmtBs(expected)}.` });
            await refreshReports();
            return;
        }

        const { data: rpcData, error: rpcErr } = await supabase.rpc('register_membership_payment', {
            p_bank_origin:     bankCode,
            p_reference_last6: reference,
            p_sender_phone:    phone || null,
            p_amount_reported: amt,
            p_amount_real:     r.amountReal,
            p_trn_date:        r.trnDate || date,
            p_banesco_status:  r.statusCode,
            p_raw_response:    r.raw || null,
        });

        if (rpcErr) {
            const dup = (rpcErr.message || '').toLowerCase().includes('duplicate');
            await notifyAdmin({ status: 'rejected', errorMessage: rpcErr.message, receiptUrl });
            setResult({ kind: 'bad', msg: dup ? 'Esta referencia ya fue registrada como pago válido.' : `Error al registrar: ${rpcErr.message}` });
            return;
        }

        // Guardar receipt_url en el report recién creado por el RPC (si lo hay)
        if (receiptUrl && rpcData?.report_id) {
            await supabase.from('payment_reports')
                .update({ receipt_url: receiptUrl })
                .eq('id', rpcData.report_id);
        }

        const expires = rpcData?.expires_at ? new Date(rpcData.expires_at).toLocaleDateString('es-VE') : '—';
        await notifyAdmin({ status: 'validated', receiptUrl });
        setResult({ kind: 'ok', msg: `✓ Pago validado. Membresía activa hasta ${expires}.` });
        setReference('');
        setReceiptFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        await Promise.all([refreshProfile(), refreshReports(), refreshMembership()]);
    };

    const handleTransferencia = async () => {
        if (!receiptFile) {
            setResult({ kind: 'bad', msg: 'Debés adjuntar el comprobante de pago.' });
            return;
        }
        if (!/^\d{4,12}$/.test(reference)) {
            setResult({ kind: 'bad', msg: 'La referencia debe ser numérica (4–12 dígitos).' });
            return;
        }
        const amt = Number(amount);
        if (!(amt > 0)) {
            setResult({ kind: 'bad', msg: 'Monto inválido.' });
            return;
        }

        const bankCode = paymentType === 'tf_banesco' ? '0134' : bank;

        const receiptUrl = await uploadReceipt(receiptFile);
        if (!receiptUrl) {
            setResult({ kind: 'bad', msg: 'No se pudo subir el comprobante. Intentá de nuevo.' });
            return;
        }

        const { error } = await supabase.from('payment_reports').insert({
            driver_id:       user.id,
            payment_type:    paymentType,
            bank_origin:     bankCode,
            reference_last6: reference,
            sender_phone:    null,
            amount_reported: amt,
            amount_real:     null,
            trn_date:        date,
            status:          'pending',
            receipt_url:     receiptUrl,
        });

        if (error) {
            setResult({ kind: 'bad', msg: `Error al registrar: ${error.message}` });
            return;
        }

        await notifyAdmin({ status: 'pending', receiptUrl });
        setResult({ kind: 'warn', msg: '⏳ Transferencia registrada. Un administrador la revisará y activará tu membresía.' });
        setReference('');
        setReceiptFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        await refreshReports();
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return;
        setResult(null);
        setSubmitting(true);
        try {
            if (isPm) await handlePagoMovil();
            else      await handleTransferencia();
        } finally {
            setSubmitting(false);
        }
    };

    const copyOne = async (label, value) => {
        await navigator.clipboard.writeText(value);
        setResult({ kind: 'ok', msg: `${label} copiado.` });
        setTimeout(() => setResult(prev => prev?.msg === `${label} copiado.` ? null : prev), 2000);
    };

    const copyAll = async () => {
        const lines = isPm
            ? [`Banco: ${RECEIVER.bank}`, `RIF: ${RECEIVER.rif}`, `Teléfono: ${RECEIVER.phone}`, liveBsAmount ? `Monto: ${fmtBs(liveBsAmount)}` : '']
            : [`Banco: ${RECEIVER.bank}`, `RIF: ${RECEIVER.rif}`, `Cuenta: ${RECEIVER.accountNumber}`, liveBsAmount ? `Monto: ${fmtBs(liveBsAmount)}` : ''];
        await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
        setResult({ kind: 'ok', msg: 'Datos copiados.' });
        setTimeout(() => setResult(prev => prev?.msg === 'Datos copiados.' ? null : prev), 2200);
    };

    const refreshProfile = async () => {
        const { data } = await supabase
            .from('profiles')
            .select('id, full_name, role, vehicle_model, subscription_status, last_payment_date, avatar_url')
            .eq('id', user.id).single();
        if (data) setProfile(data);
    };
    const refreshReports = async () => {
        const { data } = await supabase
            .from('payment_reports')
            .select('id, payment_type, bank_origin, reference_last6, amount_reported, amount_real, trn_date, status, error_message, receipt_url, created_at')
            .eq('driver_id', user.id)
            .order('created_at', { ascending: false })
            .limit(10);
        setReports(data || []);
    };

    const logout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('session_id');
        navigate('/auth');
    };

    if (loading) {
        return <div className="h-screen flex items-center justify-center bg-[#0F1014] text-white">Cargando…</div>;
    }

    return (
        <div className="min-h-screen bg-[#0F1014] text-white pb-20">
            {/* Header */}
            <header className="sticky top-0 z-20 bg-[#0F1014]/95 backdrop-blur-md border-b border-white/5">
                <div className="px-4 py-4 flex items-center gap-3 max-w-2xl mx-auto">
                    <button onClick={() => navigate('/driver')} className="w-10 h-10 bg-[#1A1F2E] rounded-full flex items-center justify-center" aria-label="Volver">
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <div className="flex-1">
                        <h1 className="text-xl font-black tracking-tight">
                            Higo <span className="text-cyan-400">Pay</span>
                        </h1>
                        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    </div>
                    <button onClick={logout} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5">
                        Cerrar sesión
                    </button>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5">

                {/* Membresía */}
                <section className="bg-gradient-to-br from-cyan-600/15 to-blue-600/15 border border-cyan-500/30 rounded-3xl p-5">
                    <div className="flex items-center gap-4">
                        {profile?.avatar_url ? (
                            <img src={profile.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border border-white/10" />
                        ) : (
                            <div className="w-14 h-14 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-300 font-black text-xl">
                                {(profile?.full_name || user?.email || '?')[0]?.toUpperCase()}
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg truncate">{profile?.full_name || 'Conductor'}</p>
                            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                        </div>
                        <MembershipBadge active={membershipActive} severity={severity} daysLeft={daysLeft} />
                    </div>
                    {expiresAt ? (
                        <div className="mt-3">
                            <p className="text-[11px] text-gray-400">
                                {membershipActive ? 'Vence' : 'Venció'} el{' '}
                                <span className="font-mono text-white">
                                    {expiresAt.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                                {daysLeft !== null && membershipActive && daysLeft <= 7 && (
                                    <span className={`ml-2 font-bold ${severity === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>
                                        · {daysLeft} {daysLeft === 1 ? 'día restante' : 'días restantes'}
                                    </span>
                                )}
                            </p>
                        </div>
                    ) : (
                        <p className="text-[11px] text-gray-500 mt-3">
                            Aún no registrás pagos. Reportá uno abajo para activar tu membresía.
                        </p>
                    )}
                </section>

                {/* KPIs */}
                <section className="grid grid-cols-2 gap-3">
                    <div className="bg-[#1A1F2E] rounded-2xl p-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Ganancias 30d</p>
                        <p className="text-2xl font-black text-emerald-400">{fmtUsd(monthlyEarnings)}</p>
                    </div>
                    <div className="bg-[#1A1F2E] rounded-2xl p-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Viajes 30d</p>
                        <p className="text-2xl font-black">{rides.length}</p>
                    </div>
                </section>

                {/* Selector de método de pago */}
                <section className="bg-[#1A1F2E] rounded-3xl p-4">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-3">Método de pago</p>
                    <div className="grid grid-cols-2 gap-2">
                        {PAYMENT_METHODS.map(m => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => switchMethod(m.id)}
                                className={`flex items-center gap-3 p-3 rounded-2xl border text-left transition-all ${
                                    paymentType === m.id
                                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white'
                                        : 'bg-[#0F1014] border-white/5 text-gray-400 hover:border-white/15'
                                }`}
                            >
                                <span className={`material-symbols-outlined text-xl shrink-0 ${paymentType === m.id ? 'text-cyan-400' : 'text-gray-500'}`}>
                                    {m.icon}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold truncate">{m.label}</p>
                                    <p className="text-[10px] text-gray-500 truncate">{m.sub}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                {/* Datos de recepción */}
                <section className="bg-[#1A1F2E] border border-cyan-500/20 rounded-3xl overflow-hidden">
                    <div className="bg-cyan-500/10 px-5 py-4 border-b border-cyan-500/20 flex items-center justify-between">
                        <div>
                            <p className="text-cyan-300 text-xs font-bold tracking-wider uppercase">
                                {isPm ? 'Datos para Pago Móvil' : 'Datos para Transferencia'}
                            </p>
                            <p className="text-sm text-gray-300 mt-0.5">Banco {RECEIVER.bank} · Higo</p>
                        </div>
                        {liveBsAmount && (
                            <div className="text-right">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Monto</p>
                                <p className="text-lg font-black text-cyan-300">{fmtBs(liveBsAmount)}</p>
                            </div>
                        )}
                    </div>
                    <div className="p-5 space-y-3 text-sm">
                        <Field label="RIF / Cédula" value={RECEIVER.rif} onCopy={() => copyOne('RIF', RECEIVER.rif)} />
                        {isPm ? (
                            <Field label="Teléfono Pago Móvil" value={RECEIVER.phone} onCopy={() => copyOne('Teléfono', RECEIVER.phone)} mono />
                        ) : (
                            <Field label="Número de cuenta" value={RECEIVER.accountNumber} onCopy={() => copyOne('Cuenta', RECEIVER.accountNumber)} mono />
                        )}
                        {bcv?.rate ? (
                            <p className="text-[10px] text-gray-500 pt-1">
                                Tasa BCV: <span className="font-mono text-gray-300">{bcv.rate.toFixed(2)} Bs/USD</span>
                                {plan?.amount_usd && <> · {fmtUsd(plan.amount_usd)}</>}
                                {' · '}{bcv.stale ? 'cache vencido' : 'actualizada hoy'}
                            </p>
                        ) : plan?.bs_updated_at && (
                            <p className="text-[10px] text-gray-500">
                                Tasa actualizada: {new Date(plan.bs_updated_at).toLocaleDateString('es-VE')}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={copyAll}
                        className="w-full bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-bold text-sm py-3 border-t border-cyan-500/20 flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
                    >
                        <span className="material-symbols-outlined text-base">content_copy</span>
                        Copiar datos
                    </button>
                </section>

                {/* Formulario */}
                <form onSubmit={onSubmit} className="bg-[#1A1F2E] rounded-3xl p-5 space-y-4">
                    <div>
                        <h2 className="text-base font-bold">Reportar pago</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {isPm
                                ? 'Validamos automáticamente con Banesco. Ingresá el monto exacto que aparece arriba.'
                                : 'Adjuntá el comprobante. Un administrador activará tu membresía.'}
                        </p>
                    </div>

                    {/* Email del conductor (read-only) */}
                    <FormField label="Tu correo Higo">
                        <input
                            readOnly
                            value={user?.email || ''}
                            className="w-full bg-[#0F1014]/60 border border-white/5 rounded-xl px-4 py-3 text-sm text-gray-400 cursor-not-allowed"
                        />
                    </FormField>

                    {/* Banco origen (solo para pm_otros y tf_otros) */}
                    {needsBankSelector && (
                        <FormField label="Banco origen (tu banco)">
                            <select
                                value={bank}
                                onChange={e => setBank(e.target.value)}
                                className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
                            >
                                {VENEZUELAN_BANKS.filter(b => b.code !== '0134').map(b => (
                                    <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                                ))}
                            </select>
                        </FormField>
                    )}

                    {/* Teléfono (solo para pago móvil) */}
                    {isPm && (
                        <FormField label="Teléfono emisor (el tuyo)">
                            <input
                                value={phone}
                                onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                                placeholder="04121234567"
                                inputMode="numeric"
                                className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-cyan-500"
                            />
                        </FormField>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <FormField label={isPm ? 'Referencia (últimos 6–8)' : 'Referencia (hasta 12 dígitos)'}>
                            <input
                                value={reference}
                                onChange={e => setReference(e.target.value.replace(/\D/g, '').slice(0, refMaxLen))}
                                placeholder={isPm ? '376765' : '123456789012'}
                                inputMode="numeric"
                                required
                                className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-cyan-500"
                            />
                        </FormField>
                        <FormField label="Fecha del pago">
                            <input
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                                max={today()}
                                required
                                className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
                            />
                        </FormField>
                    </div>

                    {/* Monto */}
                    <FormField label="Monto pagado (Bs)">
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            required
                            className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-cyan-500"
                        />
                    </FormField>

                    {/* Comprobante (todos los métodos; requerido solo en transferencias) */}
                    <FormField label={`Comprobante de pago${isTf ? ' *' : ' (opcional)'}`}>
                        <label className={`flex items-center gap-3 w-full bg-[#0F1014] border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                            receiptFile ? 'border-cyan-500/50 text-cyan-200' : 'border-white/10 text-gray-400 hover:border-white/20'
                        }`}>
                            <span className="material-symbols-outlined text-base shrink-0">
                                {receiptFile ? 'check_circle' : 'attach_file'}
                            </span>
                            <span className="text-sm truncate">
                                {receiptFile ? receiptFile.name : 'Seleccionar archivo…'}
                            </span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                className="sr-only"
                                onChange={e => setReceiptFile(e.target.files?.[0] || null)}
                            />
                        </label>
                    </FormField>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black tracking-wider uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all"
                    >
                        {submitting ? (
                            <>
                                <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                                {isPm ? 'Validando con Banesco…' : 'Enviando comprobante…'}
                            </>
                        ) : (
                            <>
                                <span className="material-symbols-outlined text-base">{isPm ? 'verified' : 'upload'}</span>
                                {isPm ? 'Validar pago' : 'Enviar comprobante'}
                            </>
                        )}
                    </button>

                    {result && (
                        <div className={`rounded-2xl px-4 py-3 text-sm border ${
                            result.kind === 'ok'   ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' :
                            result.kind === 'warn' ? 'bg-amber-500/10  border-amber-500/30  text-amber-200'  :
                                                     'bg-red-500/10    border-red-500/30    text-red-200'
                        }`}>
                            {result.msg}
                        </div>
                    )}
                </form>

                {/* Historial */}
                <section>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 px-1">
                        Historial reciente
                    </h2>
                    {reports.length === 0 ? (
                        <div className="bg-[#1A1F2E] rounded-2xl p-6 text-center text-gray-500 text-sm">
                            Aún no has reportado pagos.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {reports.map(r => {
                                const methodLabel = PAYMENT_METHODS.find(m => m.id === r.payment_type)?.sub || r.payment_type || '—';
                                return (
                                    <div key={r.id} className="bg-[#1A1F2E] rounded-2xl p-4 flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`w-2 h-2 rounded-full shrink-0 ${
                                                    r.status === 'validated' ? 'bg-emerald-400' :
                                                    r.status === 'rejected'  ? 'bg-red-400' : 'bg-amber-400'
                                                }`} />
                                                <span className="text-xs text-gray-500">
                                                    {new Date(r.created_at).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <p className="text-sm font-mono">Ref {r.reference_last6}</p>
                                            <p className="text-[10px] text-gray-500">{methodLabel}</p>
                                            {r.error_message && (
                                                <p className="text-[11px] text-red-300/80 mt-1 truncate">{r.error_message}</p>
                                            )}
                                            {r.receipt_url && (
                                                <a
                                                    href={r.receipt_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] text-cyan-400/80 underline mt-1 inline-block"
                                                >
                                                    Ver comprobante
                                                </a>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className={`font-bold text-sm ${r.status === 'validated' ? 'text-emerald-400' : 'text-gray-300'}`}>
                                                {fmtBs(r.amount_real ?? r.amount_reported)}
                                            </p>
                                            <p className={`text-[10px] uppercase mt-1 ${
                                                r.status === 'validated' ? 'text-emerald-400' :
                                                r.status === 'rejected'  ? 'text-red-400' : 'text-amber-400'
                                            }`}>{r.status}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                <p className="text-center text-[10px] text-gray-600 pt-4">
                    Higo Pay · v2
                </p>
            </main>
        </div>
    );
};

const MembershipBadge = ({ active, severity, daysLeft }) => {
    if (!active) {
        return (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                Vencida
            </span>
        );
    }
    const tone =
        severity === 'critical' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
        severity === 'warn'     ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                                  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    const label = daysLeft !== null && daysLeft <= 7
        ? `Vence en ${daysLeft}${daysLeft === 1 ? ' día' : ' días'}`
        : 'Activa';
    return (
        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${tone}`}>
            {label}
        </span>
    );
};

const Field = ({ label, value, onCopy, mono = false }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className={`${mono ? 'font-mono' : 'font-bold'} text-white truncate`}>{value}</p>
        </div>
        {onCopy && (
            <button
                type="button"
                onClick={onCopy}
                className="shrink-0 w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-cyan-300 active:scale-95 transition-all"
            >
                <span className="material-symbols-outlined text-base">content_copy</span>
            </button>
        )}
    </div>
);

const FormField = ({ label, children }) => (
    <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1.5">{label}</span>
        {children}
    </label>
);

export default HigoPayPage;
