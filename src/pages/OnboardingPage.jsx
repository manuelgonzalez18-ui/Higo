import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import LegalConsentText from '../components/LegalConsentText';
import { LEGAL_VERSION } from '../constants/legalUrls';

// Onboarding del pasajero (Fase 9 D.P1). Gateado desde App.jsx tras
// el primer login si user_preferences.onboarded_at IS NULL y el role
// es 'passenger'.
//
// 3 pasos (4 pantallas con welcome):
//   0. Welcome — bienvenida + razón. Empezar / Saltar por ahora.
//   1. Contacto de emergencia — name, phone, relationship.
//   2. Direcciones — home + work (autocomplete con LocationInput).
//   3. Método de pago default — pago_movil / cash / higopay.
//
// Si el user salta desde Welcome o desde cualquier paso, escribimos
// onboarded_at = now() de todas formas para respetar la decisión y
// no nag forever. Lo que ya completó se guarda; el resto queda null.
// El user puede volver a llenarlo desde una eventual /settings
// (no en MVP).

const PAYMENT_OPTIONS = [
    {
        id: 'pago_movil',
        label: 'Pago móvil',
        desc:  'Pagás al final del viaje al chofer con tu app del banco.',
        icon:  'phone_iphone',
    },
    {
        id: 'cash',
        label: 'Efectivo',
        desc:  'Pagás en efectivo al chofer al terminar el viaje.',
        icon:  'payments',
    },
    {
        id: 'higopay',
        label: 'HigoPay',
        desc:  'Saldo precargado en tu cuenta Higo (más rápido en cada viaje).',
        icon:  'account_balance_wallet',
    },
];

const RELATIONSHIP_OPTIONS = [
    'Pareja', 'Madre', 'Padre', 'Hermano/a', 'Hijo/a', 'Amigo/a', 'Otro',
];

const Step = ({ active, label, num }) => (
    <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
            active
                ? 'bg-blue-600 text-white'
                : 'bg-[#1A1F2E] text-gray-500 border border-white/10'
        }`}>{num}</div>
        <span className={`text-xs font-bold ${active ? 'text-white' : 'text-gray-500'}`}>{label}</span>
    </div>
);

const OnboardingPage = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState(null);
    const [step, setStep] = useState(0); // 0=welcome, 1=emergency, 2=address, 3=payment
    const [saving, setSaving] = useState(false);

    // Step 1 — emergency contact.
    const [contactName, setContactName] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [contactRel, setContactRel] = useState('');

    // Step 2 — addresses.
    const [homeAddr, setHomeAddr] = useState('');
    const [workAddr, setWorkAddr] = useState('');

    // Step 3 — payment.
    const [paymentMethod, setPaymentMethod] = useState('pago_movil');

    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                navigate('/auth');
                return;
            }
            setUserId(user.id);
        })();
    }, [navigate]);

    // Upsert helper para user_preferences. PK es user_id, así que
    // upsert garantiza que la primera escritura inserta y las
    // siguientes actualizan sin tocar columnas no provistas.
    const upsertPreferences = async (patch) => {
        if (!userId) return { error: new Error('no user') };
        return supabase
            .from('user_preferences')
            .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
    };

    const markOnboarded = async () => {
        await upsertPreferences({ onboarded_at: new Date().toISOString() });
    };

    const handleSkipAll = async () => {
        if (!confirm('¿Saltar el onboarding? Podés cargar tus datos más tarde desde Mi Perfil.')) return;
        setSaving(true);
        await markOnboarded();
        try {
            await supabase.from('terms_acceptances').insert({
                user_id: userId,
                terms_kind: 'general',
                terms_version: LEGAL_VERSION,
                accepted_at: new Date().toISOString(),
            });
        } catch (err) {
            console.warn('terms_acceptances insert failed:', err);
        }
        setSaving(false);
        navigate('/', { replace: true });
    };

    const handleSaveEmergencyContact = async () => {
        if (!contactName.trim() || !contactPhone.trim()) {
            setStep(2);
            return;
        }
        setSaving(true);
        await supabase.from('emergency_contacts').upsert({
            user_id: userId,
            name: contactName.trim(),
            phone: contactPhone.trim(),
            relationship: contactRel || null,
        }, { onConflict: 'user_id,phone' });
        setSaving(false);
        setStep(2);
    };

    const handleSaveAddresses = async () => {
        setSaving(true);
        await upsertPreferences({
            home_address: homeAddr.trim() || null,
            work_address: workAddr.trim() || null,
        });
        setSaving(false);
        setStep(3);
    };

    const handleFinish = async () => {
        setSaving(true);
        await upsertPreferences({
            default_payment_method: paymentMethod,
            onboarded_at: new Date().toISOString(),
        });
        // Registro de aceptación de T&C globales al completar onboarding
        // (mig 63). Best-effort: no bloqueamos el navigate si falla.
        try {
            await supabase.from('terms_acceptances').insert({
                user_id: userId,
                terms_kind: 'general',
                terms_version: LEGAL_VERSION,
                accepted_at: new Date().toISOString(),
            });
        } catch (err) {
            console.warn('terms_acceptances insert failed:', err);
        }
        setSaving(false);
        navigate('/', { replace: true });
    };

    if (!userId) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] text-white flex flex-col">
            {/* Header progreso */}
            <header className="px-4 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-x-auto">
                    {step > 0 && <Step active={step >= 1} num="1" label="Emergencia" />}
                    {step > 0 && <span className="text-gray-700">›</span>}
                    {step > 0 && <Step active={step >= 2} num="2" label="Direcciones" />}
                    {step > 0 && <span className="text-gray-700">›</span>}
                    {step > 0 && <Step active={step >= 3} num="3" label="Pago" />}
                </div>
                {step > 0 && (
                    <button
                        onClick={handleSkipAll}
                        disabled={saving}
                        className="text-xs text-gray-400 hover:text-white px-2 py-1"
                    >
                        Saltar
                    </button>
                )}
            </header>

            <main className="flex-1 flex flex-col px-6 py-8 max-w-md mx-auto w-full">
                {step === 0 && (
                    <>
                        <div className="flex-1 flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center mb-6 shadow-lg shadow-blue-600/30">
                                <span className="material-symbols-outlined text-white text-4xl">waving_hand</span>
                            </div>
                            <h1 className="text-3xl font-black mb-3">Bienvenido a Higo</h1>
                            <p className="text-gray-400 text-base max-w-xs leading-relaxed">
                                Vamos a hacer un set-up rápido (1 minuto) para personalizar tu experiencia: contacto de emergencia, direcciones frecuentes y forma de pago favorita.
                            </p>
                        </div>
                        <div className="space-y-2 mt-6">
                            <button
                                onClick={() => setStep(1)}
                                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-base active:scale-[0.99] transition"
                            >
                                Empezar
                            </button>
                            <button
                                onClick={handleSkipAll}
                                disabled={saving}
                                className="w-full py-3 text-gray-400 hover:text-white text-sm font-medium"
                            >
                                Saltar por ahora
                            </button>
                            <LegalConsentText actionLabel="Empezar o Saltar" className="mt-4" />
                        </div>
                    </>
                )}

                {step === 1 && (
                    <>
                        <div className="flex-1">
                            <h2 className="text-2xl font-black mb-1">Contacto de emergencia</h2>
                            <p className="text-gray-400 text-sm mb-6">
                                Si usás el botón SOS durante un viaje, le avisamos a esta persona junto al 911. Es opcional pero te lo recomendamos.
                            </p>
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    value={contactName}
                                    onChange={e => setContactName(e.target.value)}
                                    placeholder="Nombre y apellido"
                                    className="w-full bg-[#1A1F2E] border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500/50 outline-none"
                                />
                                <input
                                    type="tel"
                                    value={contactPhone}
                                    onChange={e => setContactPhone(e.target.value)}
                                    placeholder="Teléfono (ej. 04141234567)"
                                    className="w-full bg-[#1A1F2E] border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500/50 outline-none"
                                />
                                <select
                                    value={contactRel}
                                    onChange={e => setContactRel(e.target.value)}
                                    className="w-full bg-[#1A1F2E] border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500/50 outline-none appearance-none"
                                >
                                    <option value="">Relación (opcional)</option>
                                    {RELATIONSHIP_OPTIONS.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="space-y-2 mt-6">
                            <button
                                onClick={handleSaveEmergencyContact}
                                disabled={saving}
                                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-base active:scale-[0.99] transition disabled:opacity-50"
                            >
                                {saving ? 'Guardando…' : (contactName && contactPhone ? 'Guardar y seguir' : 'Sin contacto, seguir')}
                            </button>
                        </div>
                    </>
                )}

                {step === 2 && (
                    <>
                        <div className="flex-1">
                            <h2 className="text-2xl font-black mb-1">Tus direcciones</h2>
                            <p className="text-gray-400 text-sm mb-6">
                                Las usamos para sugerirte destinos rápidos al pedir un viaje. Podés saltar este paso y agregarlas después.
                            </p>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-gray-400 font-bold mb-1 block flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px] text-emerald-400">home</span>
                                        Casa
                                    </label>
                                    <input
                                        type="text"
                                        value={homeAddr}
                                        onChange={e => setHomeAddr(e.target.value)}
                                        placeholder="Dirección de tu casa"
                                        className="w-full bg-[#1A1F2E] border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500/50 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 font-bold mb-1 block flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px] text-blue-400">work</span>
                                        Trabajo
                                    </label>
                                    <input
                                        type="text"
                                        value={workAddr}
                                        onChange={e => setWorkAddr(e.target.value)}
                                        placeholder="Dirección del trabajo"
                                        className="w-full bg-[#1A1F2E] border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500/50 outline-none"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2 mt-6">
                            <button
                                onClick={handleSaveAddresses}
                                disabled={saving}
                                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-base active:scale-[0.99] transition disabled:opacity-50"
                            >
                                {saving ? 'Guardando…' : 'Siguiente'}
                            </button>
                            <button
                                onClick={() => setStep(1)}
                                disabled={saving}
                                className="w-full py-3 text-gray-400 hover:text-white text-sm font-medium"
                            >
                                Atrás
                            </button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <div className="flex-1">
                            <h2 className="text-2xl font-black mb-1">Forma de pago favorita</h2>
                            <p className="text-gray-400 text-sm mb-6">
                                Vas a poder cambiarla en cada viaje, pero la usamos como preseleccionada para que sea más rápido.
                            </p>
                            <div className="space-y-2">
                                {PAYMENT_OPTIONS.map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => setPaymentMethod(opt.id)}
                                        className={`w-full text-left p-4 rounded-2xl border transition ${
                                            paymentMethod === opt.id
                                                ? 'bg-blue-600/10 border-blue-500'
                                                : 'bg-[#1A1F2E] border-white/10 hover:border-white/20'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                                paymentMethod === opt.id ? 'bg-blue-600 text-white' : 'bg-[#0F1014] text-gray-400'
                                            }`}>
                                                <span className="material-symbols-outlined text-[20px]">{opt.icon}</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm">{opt.label}</p>
                                                <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                                            </div>
                                            {paymentMethod === opt.id && (
                                                <span className="material-symbols-outlined text-blue-400 text-[20px]">check_circle</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2 mt-6">
                            <button
                                onClick={handleFinish}
                                disabled={saving}
                                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-base active:scale-[0.99] transition disabled:opacity-50"
                            >
                                {saving ? 'Guardando…' : 'Listo, empezar a usar Higo'}
                            </button>
                            <button
                                onClick={() => setStep(2)}
                                disabled={saving}
                                className="w-full py-3 text-gray-400 hover:text-white text-sm font-medium"
                            >
                                Atrás
                            </button>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
};

export default OnboardingPage;
