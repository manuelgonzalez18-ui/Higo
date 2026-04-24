import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';

// Destino de pago Higo — se muestra al driver como instrucciones de Pago Móvil.
// TODO: mover a pricing_config / admin UI si Higo rota la cuenta.
const HIGO_PAGO_MOVIL = {
    bank: '0134 · Banesco',
    phone: '0424-0000000',
    id: 'J-40263885-0',
    name: 'Inversiones Tu Super PC 2013 C.A',
};

const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback sin prompts intrusivos; en iOS el clipboard necesita un gesture.
    }
};

const DriverMembershipPaymentPage = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [info, setInfo] = useState(null);
    const [profile, setProfile] = useState(null);
    const [activated, setActivated] = useState(false);
    const [error, setError] = useState(null);
    const [copiedKey, setCopiedKey] = useState(null);

    const fetchInfo = useCallback(async () => {
        try {
            const prof = await getUserProfile();
            if (!prof || prof.role !== 'driver') {
                navigate('/');
                return;
            }
            setProfile(prof);
            if (prof.subscription_status === 'active') {
                setActivated(true);
            }

            const { data, error: rpcErr } = await supabase.rpc('get_expected_membership_amount');
            if (rpcErr) throw rpcErr;
            setInfo(data);
        } catch (err) {
            setError(err.message || 'No se pudo calcular tu monto');
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => { fetchInfo(); }, [fetchInfo]);

    // Polling: cada 10s refrescamos el profile para detectar activación.
    // El cron del poller corre c/2min, así que la activación llegará
    // típicamente 1-3 min después de que el driver confirme el pago.
    useEffect(() => {
        if (activated) return;
        const iv = setInterval(async () => {
            const prof = await getUserProfile();
            if (prof?.subscription_status === 'active') {
                setActivated(true);
                setProfile(prof);
            }
        }, 10000);
        return () => clearInterval(iv);
    }, [activated]);

    const handleCopy = async (key, text) => {
        await copyToClipboard(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1500);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#0F1014] p-6 text-white">
                <button onClick={() => navigate('/driver')} className="text-sm text-gray-400 mb-6 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">arrow_back</span> Volver
                </button>
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
                    {error}
                </div>
            </div>
        );
    }

    const amountBs = info?.amount_bs;
    const amountUsd = info?.amount_usd;
    const rate = info?.bcv_rate;
    const plan = info?.plan;
    const driverPhone = info?.phone || profile?.phone;

    return (
        <div className="min-h-screen bg-[#0F1014] text-white">
            <div className="max-w-xl mx-auto p-4 md:p-8">
                {/* Header */}
                <button
                    onClick={() => navigate('/driver')}
                    className="text-sm text-gray-400 mb-6 flex items-center gap-1 hover:text-white transition-colors"
                >
                    <span className="material-symbols-outlined text-sm">arrow_back</span> Volver al panel
                </button>

                <div className="flex items-center gap-4 mb-8">
                    <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">credit_card</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Pagar Membresía</h1>
                        <p className="text-gray-400 text-sm font-medium">Plan {plan?.toUpperCase() || '—'}</p>
                    </div>
                </div>

                {activated && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 mb-6 flex items-start gap-3">
                        <span className="material-symbols-outlined text-emerald-400 text-3xl">check_circle</span>
                        <div>
                            <p className="font-bold text-emerald-300">¡Membresía activa!</p>
                            <p className="text-sm text-emerald-400/80">Ya podés conectarte y recibir viajes.</p>
                        </div>
                    </div>
                )}

                {/* Monto a pagar */}
                <div className="bg-gradient-to-br from-violet-600/20 to-fuchsia-600/10 border border-violet-500/30 rounded-[24px] p-6 mb-6">
                    <p className="text-xs font-bold text-violet-300 uppercase tracking-wider mb-2">Monto a pagar</p>
                    {rate ? (
                        <>
                            <p className="text-4xl font-black text-white mb-1">
                                Bs {amountBs?.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-sm text-gray-400">
                                = ${amountUsd} USD &nbsp;·&nbsp; Tasa BCV: Bs {Number(rate).toFixed(2)}/USD
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                                Se acepta ±1% de tolerancia en el monto.
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-amber-400">
                            No pudimos obtener la tasa BCV en este momento. Intenta de nuevo en unos minutos.
                        </p>
                    )}
                </div>

                {/* Tu teléfono registrado */}
                <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5 mb-6">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Tu teléfono registrado</p>
                    <p className="text-xl font-bold font-mono">{driverPhone || '—'}</p>
                    <p className="text-xs text-amber-400/80 mt-2 flex items-start gap-1.5">
                        <span className="material-symbols-outlined text-sm mt-0.5">info</span>
                        Debes hacer el pago móvil <b className="text-amber-300">desde este mismo número</b> para
                        que la activación sea automática.
                    </p>
                </div>

                {/* Datos del pago móvil Higo */}
                <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5 mb-6">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Datos para el Pago Móvil</p>
                    <div className="space-y-3">
                        <PaymentField
                            label="Banco destino"
                            value={HIGO_PAGO_MOVIL.bank}
                            copyKey="bank"
                            onCopy={handleCopy}
                            copiedKey={copiedKey}
                        />
                        <PaymentField
                            label="Teléfono"
                            value={HIGO_PAGO_MOVIL.phone}
                            copyKey="phone"
                            onCopy={handleCopy}
                            copiedKey={copiedKey}
                        />
                        <PaymentField
                            label="RIF / Cédula"
                            value={HIGO_PAGO_MOVIL.id}
                            copyKey="id"
                            onCopy={handleCopy}
                            copiedKey={copiedKey}
                        />
                        <PaymentField
                            label="Titular"
                            value={HIGO_PAGO_MOVIL.name}
                            copyKey="name"
                            onCopy={handleCopy}
                            copiedKey={copiedKey}
                        />
                        {rate && (
                            <PaymentField
                                label="Monto exacto"
                                value={`Bs ${amountBs?.toFixed(2)}`}
                                copyKey="amount"
                                onCopy={handleCopy}
                                copiedKey={copiedKey}
                                highlight
                            />
                        )}
                    </div>
                </div>

                {/* Estado de activación */}
                {!activated && (
                    <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5 flex items-center gap-4">
                        <div className="w-10 h-10 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
                        <div>
                            <p className="font-bold text-sm">Esperando confirmación de Banesco…</p>
                            <p className="text-xs text-gray-500 mt-1">
                                Después de hacer el pago, la activación llega automática en 1–3 min.
                                No cierres la app.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const PaymentField = ({ label, value, copyKey, onCopy, copiedKey, highlight = false }) => (
    <div className="flex items-center justify-between gap-3 p-3 bg-[#0F1014] rounded-xl border border-white/5">
        <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</p>
            <p className={`font-mono text-sm truncate ${highlight ? 'text-emerald-400 font-bold' : 'text-white'}`}>
                {value}
            </p>
        </div>
        <button
            onClick={() => onCopy(copyKey, value)}
            className="shrink-0 w-9 h-9 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 flex items-center justify-center text-violet-300 transition-colors"
            aria-label={`Copiar ${label}`}
        >
            <span className="material-symbols-outlined text-[18px]">
                {copiedKey === copyKey ? 'check' : 'content_copy'}
            </span>
        </button>
    </div>
);

export default DriverMembershipPaymentPage;
