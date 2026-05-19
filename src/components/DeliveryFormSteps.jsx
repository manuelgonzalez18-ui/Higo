import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../services/supabase';

export const TERMS_VERSION_DELIVERY = '2026-05-19';

const WEIGHT_BUCKETS = [
    { value: '<1',    label: 'Menos de 1 kg' },
    { value: '1-5',   label: '1 a 5 kg' },
    { value: '5-10',  label: '5 a 10 kg' },
    { value: '10-25', label: '10 a 25 kg' },
    { value: '25-50', label: '25 a 50 kg' },
    { value: '>50',   label: 'Más de 50 kg' },
];

const CATEGORIES = [
    { value: 'normal',       label: 'Normal' },
    { value: 'fragile',      label: 'Frágil' },
    { value: 'refrigerated', label: 'Refrigerado' },
    { value: 'documents',    label: 'Documentos' },
    { value: 'electronics',  label: 'Electrónica' },
];

const DeliveryFormSteps = ({ onSubmit, onCancel }) => {
    const [step, setStep] = useState(1);
    const [contacts, setContacts] = useState([]);
    const [showSaveContact, setShowSaveContact] = useState(false);
    const [data, setData] = useState({
        senderName: '',
        senderPhone: '',
        receiverName: '',
        receiverPhone: '',
        originInstructions: '',
        destInstructions: '',
        package_description: '',
        package_weight_kg: '',
        package_value_usd: '',
        is_fragile: false,
        category: 'normal',
        cod_amount: '',
        terms_accepted: false,
        terms_version: TERMS_VERSION_DELIVERY,
        terms_accepted_at: null,
        payer: 'sender',
        save_contact: false,
        contact_label: '',
    });

    // Cargar address book del remitente
    useEffect(() => {
        let active = true;
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !active) return;
            const { data: rows } = await supabase
                .from('recipient_contacts')
                .select('id,name,phone,address_label,instructions')
                .eq('user_id', user.id)
                .order('last_used_at', { ascending: false, nullsFirst: false })
                .limit(20);
            if (active) setContacts(rows || []);
        })();
        return () => { active = false; };
    }, []);

    const applyContact = (c) => {
        setData(prev => ({
            ...prev,
            receiverName: c.name || prev.receiverName,
            receiverPhone: c.phone || prev.receiverPhone,
            destInstructions: c.instructions || prev.destInstructions,
        }));
    };

    const handleChange = (field, value) => {
        setData(prev => {
            const next = { ...prev, [field]: value };
            // Sync is_fragile with category=fragile
            if (field === 'category' && value === 'fragile') next.is_fragile = true;
            if (field === 'is_fragile' && value === true && next.category === 'normal') next.category = 'fragile';
            return next;
        });
    };

    const stepValid = () => {
        if (step === 1) return data.senderName && data.senderPhone && data.receiverName && data.receiverPhone;
        if (step === 2) return data.package_description.trim().length > 0 && data.package_weight_kg && data.package_value_usd && Number(data.package_value_usd) >= 0;
        if (step === 3) return true; // instructions are optional
        if (step === 4) return data.terms_accepted;
        return false;
    };

    const nextStep = () => setStep(prev => prev + 1);
    const prevStep = () => setStep(prev => prev - 1);

    const handleSubmit = () => {
        if (!data.terms_accepted) return;
        onSubmit({
            ...data,
            terms_accepted_at: new Date().toISOString(),
            cod_amount: data.cod_amount ? Number(data.cod_amount) : null,
            package_value_usd: Number(data.package_value_usd),
        });
    };

    return (
        <div className="fixed inset-0 z-40 bg-[#10141F] flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="p-6 flex items-center gap-4">
                <button onClick={step === 1 ? onCancel : prevStep} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-white">arrow_back</span>
                </button>
                <div className="flex-1">
                    <h2 className="text-xl font-bold text-white">
                        {step === 1 ? 'Datos de Contacto'
                            : step === 2 ? 'Datos del Paquete'
                            : step === 3 ? 'Instrucciones + Pago'
                            : 'Términos del Envío'}
                    </h2>
                    <div className="flex gap-1 mt-1">
                        {[1, 2, 3, 4].map(n => (
                            <div key={n} className={`h-1 flex-1 rounded-full ${step >= n ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 pt-0">
                {step === 1 && (
                    <div className="flex flex-col gap-6">
                        {contacts.length > 0 && (
                            <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-emerald-500/20">
                                <label className="text-emerald-400 text-xs font-bold uppercase mb-2 block">
                                    Destinatario frecuente
                                </label>
                                <select
                                    onChange={e => {
                                        const c = contacts.find(c => c.id === e.target.value);
                                        if (c) applyContact(c);
                                    }}
                                    className="w-full bg-[#0a101f] rounded-xl p-3 text-sm text-white border border-white/10 outline-none focus:border-emerald-500"
                                    defaultValue=""
                                >
                                    <option value="">Selecciona uno (autocompleta abajo)</option>
                                    {contacts.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.name} · {c.phone}
                                            {c.address_label ? ` · ${c.address_label}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-white/5">
                            <h3 className="text-emerald-400 text-sm font-bold uppercase mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">call_made</span> Quien Envía
                            </h3>
                            <input
                                placeholder="Nombre y Apellido"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none mb-4"
                                value={data.senderName}
                                onChange={e => handleChange('senderName', e.target.value)}
                            />
                            <input
                                type="tel"
                                placeholder="Teléfono"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none"
                                value={data.senderPhone}
                                onChange={e => handleChange('senderPhone', e.target.value)}
                            />
                        </div>

                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-white/5">
                            <h3 className="text-red-400 text-sm font-bold uppercase mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">call_received</span> Quien Recibe
                            </h3>
                            <input
                                placeholder="Nombre y Apellido"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none mb-4"
                                value={data.receiverName}
                                onChange={e => handleChange('receiverName', e.target.value)}
                            />
                            <input
                                type="tel"
                                placeholder="Teléfono"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none"
                                value={data.receiverPhone}
                                onChange={e => handleChange('receiverPhone', e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="flex flex-col gap-5">
                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">¿Qué estás enviando? *</label>
                            <textarea
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none h-24 resize-none"
                                placeholder="Ej: Caja de zapatos con documentos"
                                maxLength={200}
                                value={data.package_description}
                                onChange={e => handleChange('package_description', e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1 text-right">{data.package_description.length}/200</p>
                        </div>

                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Peso aproximado *</label>
                            <select
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none"
                                value={data.package_weight_kg}
                                onChange={e => handleChange('package_weight_kg', e.target.value)}
                            >
                                <option value="">Selecciona…</option>
                                {WEIGHT_BUCKETS.map(b => (
                                    <option key={b.value} value={b.value}>{b.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Declaración de Valor (USD) *</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none"
                                value={data.package_value_usd}
                                onChange={e => handleChange('package_value_usd', e.target.value)}
                            />
                            <p className="text-xs text-amber-300/80 mt-2 leading-snug">
                                Higo es una plataforma de intermediación. La declaración de valor es para auditoría y resolución de reclamos. <strong>Higo NO actúa como aseguradora ni transportista</strong> — el chofer independiente es responsable de la mercadería durante el envío.
                            </p>
                        </div>

                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Categoría</label>
                            <select
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none"
                                value={data.category}
                                onChange={e => handleChange('category', e.target.value)}
                            >
                                {CATEGORIES.map(c => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                        </div>

                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={data.is_fragile}
                                onChange={e => handleChange('is_fragile', e.target.checked)}
                                className="w-5 h-5 accent-emerald-500"
                            />
                            <span className="text-white">Es frágil — manéjese con cuidado</span>
                        </label>
                    </div>
                )}

                {step === 3 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Instrucciones en el origen</label>
                            <textarea
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none h-24 resize-none"
                                placeholder="Ej: Preguntar por María en recepción"
                                value={data.originInstructions}
                                onChange={e => handleChange('originInstructions', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Instrucciones en el destino</label>
                            <textarea
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none h-24 resize-none"
                                placeholder="Ej: Dejar en portería si no responden"
                                value={data.destInstructions}
                                onChange={e => handleChange('destInstructions', e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Cobro Contra Entrega (efectivo, opcional)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="USD a cobrar al destinatario"
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none"
                                value={data.cod_amount}
                                onChange={e => handleChange('cod_amount', e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1">El chofer cobra este monto al entregar. Higo solo audita; no maneja el efectivo.</p>
                        </div>

                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-white/5">
                            <h3 className="text-emerald-400 text-sm font-bold uppercase mb-3">¿Quién paga el envío?</h3>
                            <div className="flex flex-col gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleChange('payer', 'sender')}
                                    className={`p-3 rounded-full font-bold border transition-all ${data.payer === 'sender' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-transparent border-gray-600 text-gray-400'}`}
                                >
                                    Remitente (pago al retirar)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleChange('payer', 'receiver')}
                                    className={`p-3 rounded-full font-bold border transition-all ${data.payer === 'receiver' ? 'bg-white border-white text-black' : 'bg-transparent border-gray-600 text-gray-400'}`}
                                >
                                    Destinatario (pago al entregar)
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div className="flex flex-col gap-5">
                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-amber-500/30">
                            <h3 className="text-amber-400 text-sm font-bold uppercase mb-3 flex items-center gap-2">
                                <span className="material-symbols-outlined text-base">gavel</span>
                                Responsabilidad
                            </h3>
                            <p className="text-sm text-gray-200 leading-relaxed">
                                Higo es una <strong>plataforma tecnológica de intermediación</strong>, no transportista ni aseguradora. El chofer es contratista independiente responsable de la mercadería desde el pickup hasta la entrega.
                            </p>
                            <p className="text-sm text-gray-300 leading-relaxed mt-3">
                                Si hay daño, pérdida o no-entrega: podés abrir un reclamo en las 48h siguientes. Si resulta probado, suspendemos al chofer en la plataforma y te entregamos sus datos identificatorios (cédula, nombre, teléfono, placa) para que procedas por vía civil o penal. <strong>Higo no indemniza con caja propia.</strong>
                            </p>
                            <Link to="/terms/envios" target="_blank" className="text-emerald-400 text-sm underline mt-3 inline-block">
                                Leer Términos y Condiciones completos →
                            </Link>
                        </div>

                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-red-500/30">
                            <h3 className="text-red-400 text-sm font-bold uppercase mb-2">Prohibido enviar</h3>
                            <ul className="text-sm text-gray-300 list-disc list-inside leading-relaxed">
                                <li>Armas, municiones</li>
                                <li>Drogas o sustancias controladas</li>
                                <li>Líquidos inflamables</li>
                                <li>Animales vivos</li>
                                <li>Perecederos sin refrigeración</li>
                            </ul>
                        </div>

                        <label className="flex items-start gap-3 cursor-pointer bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                            <input
                                type="checkbox"
                                checked={data.terms_accepted}
                                onChange={e => handleChange('terms_accepted', e.target.checked)}
                                className="w-5 h-5 accent-emerald-500 mt-0.5 shrink-0"
                            />
                            <span className="text-white text-sm leading-snug">
                                He leído y acepto los Términos y Condiciones de Envíos. Declaro bajo juramento que el paquete no contiene ningún elemento prohibido y asumo el riesgo del valor declarado.
                            </span>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={data.save_contact}
                                onChange={e => handleChange('save_contact', e.target.checked)}
                                className="w-5 h-5 accent-emerald-500 mt-0.5 shrink-0"
                            />
                            <div className="flex-1">
                                <span className="text-white text-sm">Guardar destinatario para próximos envíos</span>
                                {data.save_contact && (
                                    <input
                                        type="text"
                                        placeholder="Etiqueta (opcional): casa de mamá, oficina, etc."
                                        className="w-full mt-2 bg-[#1A1F2E] rounded-xl px-3 py-2 text-sm text-white border border-white/10 outline-none focus:border-emerald-500"
                                        value={data.contact_label}
                                        onChange={e => handleChange('contact_label', e.target.value)}
                                    />
                                )}
                            </div>
                        </label>
                    </div>
                )}
            </div>

            <div className="p-6 bg-[#10141F] border-t border-white/5">
                <button
                    onClick={step === 4 ? handleSubmit : nextStep}
                    disabled={!stepValid()}
                    className={`w-full py-4 rounded-[20px] font-bold text-lg shadow-lg active:scale-95 transition-all ${
                        stepValid()
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20'
                            : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    }`}
                >
                    {step === 4 ? 'Confirmar envío' : 'Continuar'}
                </button>
            </div>
        </div>
    );
};

export default DeliveryFormSteps;
