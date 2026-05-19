import React, { useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { toast } from './Toast';

const DeliveryPodCapture = ({ rideId, kind, onUploaded, onCancel }) => {
    const inputRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);

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
        const url = URL.createObjectURL(f);
        setPreview(url);
    };

    const handleUpload = async () => {
        if (!file || uploading) return;
        setUploading(true);
        try {
            const path = `${rideId}/${kind}.jpg`;
            const { error: upErr } = await supabase.storage
                .from('delivery-pods')
                .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
            if (upErr) throw upErr;

            const column = kind === 'pickup' ? 'pickup_pod_url' : 'delivery_pod_url';
            const { error: updErr } = await supabase
                .from('rides')
                .update({ [column]: path })
                .eq('id', rideId);
            if (updErr) throw updErr;

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
                            onClick={() => { setFile(null); setPreview(null); }}
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
                    <button
                        onClick={onCancel}
                        disabled={uploading}
                        className="flex-1 py-3 rounded-full border border-gray-700 text-gray-300 font-bold disabled:opacity-50"
                    >
                        Cancelar
                    </button>
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
