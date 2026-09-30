import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { toast } from './Toast';
import { triggerPodEmail } from '../utils/triggerPodEmail';

const DeliveryPodCapture = ({ rideId, kind, onUploaded, onCancel, hideCancel = false }) => {
    const inputRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const uploadRef = useRef(null);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const labels = kind === 'pickup'
        ? { title: 'Foto del paquete al recoger', hint: 'Mostrar el paquete completo y en buen estado.' }
        : { title: 'Foto de la entrega', hint: 'Mostrar el paquete entregado en el lugar acordado.' };

    const handleFileChange = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) {
            toast.error('Solo se permiten imágenes.');
            return;
        }
        setFile(f);
        uploadRef.current = null;
        const url = URL.createObjectURL(f);
        setPreview(url);
    };

    const handleUpload = async () => {
        if (!file || uploading) return;
        setUploading(true);
        try {
            const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
            if (!ext || file.size > 10 * 1024 * 1024) throw new Error('Usa JPG, PNG o WebP de hasta 10 MB.');
            if (!uploadRef.current) uploadRef.current = { path: `${rideId}/${kind}/${crypto.randomUUID()}.${ext}`, uploaded: false };
            const { path } = uploadRef.current;
            if (!uploadRef.current.uploaded) {
                const { error: upErr } = await supabase.storage
                    .from('delivery-pods')
                    .upload(path, file, { upsert: false, contentType: file.type });
                if (upErr && upErr.statusCode !== '409' && upErr.statusCode !== 409) throw upErr;
                uploadRef.current.uploaded = true;
            }

            const { error: updErr } = await supabase.rpc('driver_register_pod_v1', { p_ride_id: rideId, p_stage: kind, p_object_path: path });
            if (updErr) throw updErr;

            // Disparar la notificación por correo al cliente (fire-and-forget)
            triggerPodEmail({ rideId, kind, podPath: path });

            onUploaded?.(path);
        } catch (err) {
            console.error('POD upload error:', err);
            toast.error(`No se pudo subir la foto: ${err.message || err}`);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-[#0a101f] rounded-3xl border border-gray-800 p-6 w-full max-w-sm">
                <h2 className="text-lg font-bold text-white mb-1">{labels.title}</h2>
                <p className="text-sm text-gray-400 mb-5">{labels.hint}</p>

                {preview ? (
                    <div className="mb-5">
                        <img src={preview} alt="POD preview" className="w-full rounded-2xl" />
                        <button
                            onClick={() => { setFile(null); setPreview(null); uploadRef.current = null; }}
                            disabled={uploading}
                            className="text-emerald-400 text-sm mt-2 underline"
                        >
                            Cambiar foto
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => inputRef.current?.click()}
                        className="w-full bg-emerald-500/10 border-2 border-dashed border-emerald-500/40 rounded-2xl py-10 flex flex-col items-center justify-center text-emerald-400 mb-5"
                    >
                        <span className="material-symbols-outlined text-4xl">photo_camera</span>
                        <span className="text-sm font-bold mt-2">Tomar foto</span>
                    </button>
                )}

                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                />

                <div className="flex gap-3">
                    {!hideCancel && (
                        <button
                            onClick={onCancel}
                            disabled={uploading}
                            className="flex-1 py-3 rounded-full border border-gray-700 text-gray-300 font-bold disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                    )}
                    <button
                        onClick={handleUpload}
                        disabled={!file || uploading}
                        className="flex-1 py-3 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploading ? 'Subiendo…' : 'Confirmar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeliveryPodCapture;
