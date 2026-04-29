import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { validateBanescoPayment, VENEZUELAN_BANKS } from '../services/banesco';
import { getOfficialBcvRate } from '../services/bcv';

// Datos de recepción del comerciante (Higo). Pueden venir del backend en
// el futuro; por ahora son constantes acordadas con Banesco.
const RECEIVER = {
    bank: 'BANESCO',
    rif: 'J-402638850',
    accountNumber: '01340332563321061868',
    phone: '04120330315',
};

const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtBs  = (n) => `${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
const today  = () => new Date().toISOString().slice(0, 10);

const HigoPayPage = () => {
    const navigate = useNavigate();

    const [user, setUser]         = useState(null);
    const [profile, setProfile]   = useState(null);
    const [plan, setPlan]         = useState(null);            // membership_plans row
    const [bcv, setBcv]           = useState(null);            // {rate, fetchedAt, ...} | null
    const [rides, setRides]       = useState([]);
    const [reports, setReports]   = useState([]);
    const [loading, setLoading]   = useState(true);

    // Form state
    const [bank, setBank]           = useState('0102');
    const [phone, setPhone]         = useState('');
    const [reference, setReference] = useState('');
    const [date, setDate]           = useState(today());
    const [amount, setAmount]       = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult]       = useState(null);          // {ok, msg, kind: 'ok'|'warn'|'bad'}

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

            // Monto a pagar: USD del plan × tasa BCV (preferido).
            // Fallback: lo que esté guardado en amount_bs si la tasa falla.
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
                .select('id, bank_origin, reference_last6, amount_reported, amount_real, trn_date, status, banesco_status, error_message, created_at')
                .eq('driver_id', u.id)
                .order('created_at', { ascending: false })
                .limit(10);
            setReports(reportsData || []);

            setLoading(false);
        };
        load();
    }, [navigate]);

    const monthlyEarnings = useMemo(
        () => rides.reduce((s, r) => s + Number(r.price || 0), 0),
        [rides]
    );
    const monthlyTrips = rides.length;

    const membershipActive = profile?.subscription_status === 'active';

    const copyAll = async () => {
        const liveBs = (plan?.amount_usd && bcv?.rate) ? Number(plan.amount_usd) * Number(bcv.rate) : null;
        const monto  = liveBs ?? (plan?.amount_bs ? Number(plan.amount_bs) : null);
        const text =
            `Banco: ${RECEIVER.bank}\n` +
            `RIF: ${RECEIVER.rif}\n` +
            `Cuenta: ${RECEIVER.accountNumber}\n` +
            `Teléfono: ${RECEIVER.phone}\n` +
            (monto ? `Monto: ${fmtBs(monto)}\n` : '');
        await navigator.clipboard.writeText(text);
        setResult({ kind: 'ok', msg: 'Datos copiados al portapapeles.' });
        setTimeout(() => setResult(prev => prev?.msg === 'Datos copiados al portapapeles.' ? null : prev), 2500);
    };

    const copyOne = async (label, value) => {
        await navigator.clipboard.writeText(value);
        setResult({ kind: 'ok', msg: `${label} copiado.` });
        setTimeout(() => setResult(prev => prev?.msg === `${label} copiado.` ? null : prev), 2000);
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return;
        setResult(null);

        // Validación local antes de gastar una llamada a Banesco.
        if (!/^\d{1,8}$/.test(reference)) {
            setResult({ kind: 'bad', msg: 'La referencia debe ser numérica (1–8 dígitos).' });
            return;
        }
        const amt = Number(amount);
        if (!(amt > 0)) {
            setResult({ kind: 'bad', msg: 'Monto inválido.' });
            return;
        }

        setSubmitting(true);
        const r = await validateBanescoPayment({
            reference,
            amount: amt,
            phone,
            date,
            bank,
        });

        // Sesión expirada → mandar a re-loguear, no dejar un report basura.
        if (!r.ok && r.errorCode === 'BAD_TOKEN') {
            setResult({ kind: 'bad', msg: 'Tu sesión expiró. Volvé a iniciar sesión.' });
            setSubmitting(false);
            setTimeout(() => navigate('/auth'), 1200);
            return;
        }

        // Caso 1: Banesco no encontró / error / duplicado
        if (!r.ok) {
            // ALREADY_VALIDATED ya está auditado server-side, no insertamos otro.
            if (r.errorCode !== 'ALREADY_VALIDATED') {
                await supabase.from('payment_reports').insert({
                    driver_id: user.id,
                    bank_origin: bank,
                    reference_last6: reference,
                    sender_phone: phone || null,
                    amount_reported: amt,
                    amount_real: null,
                    trn_date: date,
                    banesco_status: r.statusCode || r.errorCode || null,
                    status: 'rejected',
                    error_message: r.errorMessage || 'Error desconocido',
                    raw_response: r.raw || null,
                });
            }
            setResult({ kind: 'bad', msg: r.errorMessage || 'No se pudo validar.' });
            await refreshReports();
            setSubmitting(false);
            return;
        }

        // Caso 2: Banesco confirmó pero el monto no alcanza el del plan.
        if (!r.withinTolerance) {
            const expected = Number(r.expectedBs) || 0;
            await supabase.from('payment_reports').insert({
                driver_id: user.id,
                bank_origin: bank,
                reference_last6: reference,
                sender_phone: phone || null,
                amount_reported: amt,
                amount_real: r.amountReal,
                trn_date: r.trnDate || date,
                banesco_status: r.statusCode,
                status: 'rejected',
                error_message: `Monto insuficiente. Banesco recibió ${r.amountReal} Bs; el plan cuesta ${expected} Bs.`,
                raw_response: r.raw || null,
            });
            setResult({
                kind: 'warn',
                msg: `Banesco confirmó el pago, pero el monto no alcanza: recibió ${fmtBs(r.amountReal)} y el plan cuesta ${fmtBs(expected)}.`,
            });
            await refreshReports();
            setSubmitting(false);
            return;
        }

        // Caso 3: éxito → RPC atómico crea membresía + report
        const { data: rpcData, error: rpcErr } = await supabase.rpc('register_membership_payment', {
            p_bank_origin:     bank,
            p_reference_last6: reference,
            p_sender_phone:    phone || null,
            p_amount_reported: amt,
            p_amount_real:     r.amountReal,
            p_trn_date:        r.trnDate || date,
            p_banesco_status:  r.statusCode,
            p_raw_response:    r.raw || null,
        });

        if (rpcErr) {
            // Caso típico: referencia ya usada (uq_payment_reports_ref_validated).
            const dup = (rpcErr.message || '').toLowerCase().includes('duplicate');
            setResult({
                kind: 'bad',
                msg: dup
                    ? 'Esta referencia ya fue registrada como pago válido.'
                    : `Error al registrar: ${rpcErr.message}`,
            });
            setSubmitting(false);
            return;
        }

        const expires = rpcData?.expires_at ? new Date(rpcData.expires_at).toLocaleDateString('es-VE') : '—';
        setResult({ kind: 'ok', msg: `✓ Pago validado. Membresía activa hasta ${expires}.` });
        setReference('');
        await Promise.all([refreshProfile(), refreshReports()]);
        setSubmitting(false);
    };

    const refreshProfile = async () => {
        const { data } = await supabase
            .from('profiles')
            .select('id, full_name, role, vehicle_model, subscription_status, last_payment_date, avatar_url')
            .eq('id', user.id)
            .single();
        if (data) setProfile(data);
    };
    const refreshReports = async () => {
        const { data } = await supabase
            .from('payment_reports')
            .select('id, bank_origin, reference_last6, amount_reported, amount_real, trn_date, status, banesco_status, error_message, created_at')
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

            <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">

                {/* Cuenta + membresía */}
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
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                            membershipActive
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-red-500/20 text-red-300 border border-red-500/40'
                        }`}>
                            {membershipActive ? 'Activa' : 'Vencida'}
                        </span>
                    </div>
                    {profile?.last_payment_date && (
                        <p className="text-[11px] text-gray-400 mt-3">
                            Último pago: <span className="font-mono text-white">{new Date(profile.last_payment_date).toLocaleString('es-VE')}</span>
                        </p>
                    )}
                </section>

                {/* Resumen ganancias */}
                <section className="grid grid-cols-2 gap-3">
                    <div className="bg-[#1A1F2E] rounded-2xl p-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Ganancias 30d</p>
                        <p className="text-2xl font-black text-emerald-400">{fmtUsd(monthlyEarnings)}</p>
                    </div>
                    <div className="bg-[#1A1F2E] rounded-2xl p-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Viajes 30d</p>
                        <p className="text-2xl font-black">{monthlyTrips}</p>
                    </div>
                </section>

                {/* Datos de recepción */}
                <section className="bg-[#1A1F2E] border border-cyan-500/20 rounded-3xl overflow-hidden">
                    <div className="bg-cyan-500/10 px-5 py-4 border-b border-cyan-500/20">
                        <p className="text-cyan-300 text-xs font-bold tracking-wider uppercase">Datos de recepción</p>
                        <p className="text-sm text-gray-300 mt-0.5">Banco {RECEIVER.bank} · Higo</p>
                    </div>
                    <div className="p-5 space-y-3 text-sm">
                        <Field label="RIF / Cédula"      value={RECEIVER.rif}           onCopy={() => copyOne('RIF', RECEIVER.rif)} />
                        <Field label="Número de cuenta"  value={RECEIVER.accountNumber} onCopy={() => copyOne('Cuenta', RECEIVER.accountNumber)} mono />
                        <Field label="Teléfono Pago Móvil" value={RECEIVER.phone}       onCopy={() => copyOne('Teléfono', RECEIVER.phone)} mono />
                        {(() => {
                            const liveBs   = (plan?.amount_usd && bcv?.rate) ? Number(plan.amount_usd) * Number(bcv.rate) : null;
                            const stored   = plan?.amount_bs ? Number(plan.amount_bs) : null;
                            const display  = liveBs ?? stored;
                            return (
                                <Field
                                    label="Monto a pagar"
                                    value={display ? fmtBs(display) : (plan?.amount_usd ? `${fmtUsd(plan.amount_usd)} (consultar tasa)` : '—')}
                                    onCopy={display ? () => copyOne('Monto', display.toFixed(2)) : null}
                                    highlight
                                />
                            );
                        })()}
                        {bcv?.rate ? (
                            <p className="text-[10px] text-gray-500">
                                Tasa BCV: <span className="font-mono text-gray-300">{bcv.rate.toFixed(2)} Bs/USD</span>
                                {' · '}
                                {plan?.amount_usd && <>equivale a <span className="text-cyan-300/80">{fmtUsd(plan.amount_usd)}</span> · </>}
                                {bcv.stale ? 'cache vencido' : 'actualizada hoy'}
                            </p>
                        ) : plan?.bs_updated_at && (
                            <p className="text-[10px] text-gray-500">
                                Tasa actualizada: {new Date(plan.bs_updated_at).toLocaleDateString('es-VE')}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={copyAll}
                        className="w-full bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-bold text-sm py-3 border-t border-cyan-500/20 flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
                    >
                        <span className="material-symbols-outlined text-base">content_copy</span>
                        Copiar todos los datos
                    </button>
                </section>

                {/* Formulario reportar pago */}
                <form onSubmit={onSubmit} className="bg-[#1A1F2E] rounded-3xl p-5 space-y-4">
                    <div>
                        <h2 className="text-base font-bold">Reportar pago</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Validamos automáticamente con Banesco. Tomá el monto exacto que aparece arriba.
                        </p>
                    </div>

                    <FormField label="Banco origen">
                        <select
                            value={bank}
                            onChange={e => setBank(e.target.value)}
                            className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
                        >
                            {VENEZUELAN_BANKS.map(b => (
                                <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                            ))}
                        </select>
                    </FormField>

                    <div className="grid grid-cols-2 gap-3">
                        <FormField label="Teléfono emisor">
                            <input
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="04121234567"
                                inputMode="numeric"
                                className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-cyan-500"
                            />
                        </FormField>
                        <FormField label="Referencia (últimos 6–8)">
                            <input
                                value={reference}
                                onChange={e => setReference(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                placeholder="376765"
                                inputMode="numeric"
                                required
                                className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-cyan-500"
                            />
                        </FormField>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
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
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black tracking-wider uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all"
                    >
                        {submitting ? (
                            <>
                                <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                                Validando con Banesco…
                            </>
                        ) : (
                            <>
                                <span className="material-symbols-outlined text-base">send</span>
                                Validar pago
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
                            {reports.map(r => (
                                <div key={r.id} className="bg-[#1A1F2E] rounded-2xl p-4 flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`w-2 h-2 rounded-full ${
                                                r.status === 'validated' ? 'bg-emerald-400' :
                                                r.status === 'rejected'  ? 'bg-red-400' : 'bg-amber-400'
                                            }`} />
                                            <span className="text-xs text-gray-500">
                                                {new Date(r.created_at).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <p className="text-sm font-mono">Ref {r.reference_last6} · banco {r.bank_origin}</p>
                                        {r.error_message && (
                                            <p className="text-[11px] text-red-300/80 mt-1 truncate">{r.error_message}</p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <p className={`font-bold text-sm ${r.status === 'validated' ? 'text-emerald-400' : 'text-gray-300'}`}>
                                            {fmtBs(r.amount_real ?? r.amount_reported)}
                                        </p>
                                        <p className="text-[10px] text-gray-500 uppercase mt-1">{r.status}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <p className="text-center text-[10px] text-gray-600 pt-4">
                    Higo Pay · validación contra Banesco · v1
                </p>
            </main>
        </div>
    );
};

const Field = ({ label, value, onCopy, mono = false, highlight = false }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className={`${mono ? 'font-mono' : 'font-bold'} ${highlight ? 'text-cyan-300 text-lg' : 'text-white'} truncate`}>{value}</p>
        </div>
        {onCopy && (
            <button
                type="button"
                onClick={onCopy}
                className="shrink-0 w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-cyan-300 active:scale-95 transition-all"
                aria-label={`Copiar ${label}`}
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
