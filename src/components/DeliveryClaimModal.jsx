import React, { useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { toast } from './Toast';

const CLAIM_TYPES = [
    { value: 'not_delivered',   label: 'No fue entregado', icon: 'block' },
    { value: 'damaged',         label: 'Llegó dañado',     icon: 'broken_image' },
    { value: 'lost',            label: 'Se perdió',        icon: 'help_outline' },
    { value: 'wrong_recipient', label: 'Lo recibió la persona equivocada', icon: 'person_off' },
];

const DeliveryClaimModal = ({ ride, onClose, onSubmitted }) => {
    const fileRef = useRef(null);
    const [type, setType] = useState('');
    const [description, setDescription] = useState('');
    const [files, setFiles] = useState([]); // File[]
    const [previews, setPreviews] = useState([]); // string[]
    const [submitting, setSubmitting] = useState(false);

    const handleFiles = (e) => {
        const list = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
        if (!list.length) return;
        const limited = list.slice(0, 4); // máx 4 fotos
        setFiles(limited);
        setPreviews(limited.map(f => URL.createObjectURL(f)));
    };

    const submit = async () => {
        if (submitting) return;
        if (!type) { toast.error('Elegí el tipo de problema.'); return; }
        if (description.trim().length < 10) {
            toast.error('Describí el problema con al menos 10 caracteres.');
            return;
        }
        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No session');

            // Subir evidencia ANTES de crear el claim para guardar los paths
            const evidenceUrls = [];
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
                const path = `${ride.id}/claim-${Date.now()}-${i}.${ext}`;
                const { error: upErr } = await supabase.storage
                    .from('delivery-pods')
                    .upload(path, f, { contentType: f.type, upsert: false });
                if (upErr) throw upErr;
                evidenceUrls.push(path);
            }

            const declaredValue = Number(ride?.delivery_info?.package_value_usd) || null;

            const { error } = await supabase.from('delivery_claims').insert({
                ride_id: ride.id,
                claimant_id: user.id,
                type,
                description: description.trim(),
                evidence_urls: evidenceUrls,
                declared_value_usd: declaredValue,
                status: 'open',
            });
            if (error) throw error;

            toast.success('Reclamo enviado. Te contactaremos por email cuando se resuelva.');
            onSubmitted?.();
            onClose();
        } catch (err) {
            console.error(err);
            toast.error(`No se pudo enviar el reclamo: ${err.message || err}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 overflow-y-auto">
            <div className="bg-[#0a101f] rounded-3xl border border-gray-800 w-full max-w-md my-4">
                <div className="p-5 border-b border-white/5 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-white">Reportar problema con el envío</h2>
                        <p className="text-xs text-gray-400">Ride #{ride.id}</p>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white">close</span>
                    </button>
                </div>

                <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
                    {/* Tipo */}
                    <div>
                        <label className="text-gray-400 text-xs font-bold uppercase block mb-2">¿Qué pasó?</label>
                        <div className="grid grid-cols-2 gap-2">
                            {CLAIM_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    onClick={() => setType(t.value)}
                                    className={`p-3 rounded-xl text-left border transition-all ${type === t.value
                                        ? 'bg-orange-500/15 border-orange-500/50 text-white'
                                        : 'bg-[#1A1F2E] border-white/10 text-gray-300 hover:border-white/20'}`}
                                >
                                    <span className="material-symbols-outlined text-base block mb-1">{t.icon}</span>
                                    <span className="text-xs font-bold leading-tight">{t.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Descripción */}
                    <div>
                        <label className="text-gray-400 text-xs font-bold uppercase block mb-2">Contanos qué pasó *</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Detalles: cuándo lo notaste, en qué condiciones llegó, qué decía el chofer…"
                            className="w-full bg-[#1A1F2E] rounded-xl p-3 text-sm text-white border border-white/10 outline-none focus:border-orange-500 h-32 resize-none"
                            maxLength={1000}
                        />
                        <p className="text-[10px] text-gray-500 text-right mt-1">{description.length}/1000</p>
                    </div>

                    {/* Evidencia */}
                    <div>
                        <label className="text-gray-400 text-xs font-bold uppercase block mb-2">Fotos (opcional, máx 4)</label>
                        {previews.length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mb-3">
                                {previews.map((src, i) => (
                                    <img key={i} src={src} alt="" className="w-full h-20 object-cover rounded-lg border border-white/10" />
                                ))}
                            </div>
                        )}
                        <button
                            onClick={() => fileRef.current?.click()}
                            className="w-full bg-orange-500/10 border-2 border-dashed border-orange-500/30 rounded-xl py-4 text-orange-400 text-sm font-bold flex items-center justify-center gap-2"
                        >
                            <span className="material-symbols-outlined text-base">photo_camera</span>
                            {previews.length > 0 ? 'Cambiar fotos' : 'Agregar fotos'}
                        </button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFiles}
                            className="hidden"
                        />
                    </div>

                    {/* Disclaimer */}
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 leading-snug">
                        <p>
                            <strong>Cómo funciona:</strong> Higo revisa tu reclamo + las fotos POD del chofer + tu evidencia. Si lo aprobamos:
                        </p>
                        <ul className="list-disc list-inside mt-1 space-y-1">
                            <li>El chofer queda suspendido de la plataforma.</li>
                            <li>Te enviamos por email los datos identificatorios del chofer (cédula, tel, placa) para que procedas por vía legal.</li>
                            <li>Higo no indemniza con caja propia — somos plataforma de intermediación.</li>
                        </ul>
                    </div>
                </div>

                <div className="p-5 border-t border-white/5 flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 py-3 rounded-full border border-gray-700 text-gray-300 font-bold text-sm disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={submit}
                        disabled={submitting || !type || description.trim().length < 10}
                        className="flex-1 py-3 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? 'Enviando…' : 'Enviar reclamo'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeliveryClaimModal;
