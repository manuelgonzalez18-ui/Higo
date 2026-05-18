import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

// Onboarding self-service del conductor (Fase 10 D.C1 · 3/4).
// El chofer sube 4 documentos: cédula, licencia, RCV, foto del vehículo.
// Cada upload va al bucket privado driver-docs en su propio folder,
// y crea/actualiza una fila en driver_documents con status='pending'.
//
// El admin después revisa desde AdminDriversPage (commit 4/4).
// Hasta que los 4 estén 'approved', el chofer NO puede ponerse online
// (gate en DriverDashboard, también del 4/4).
//
// Esta página solo gestiona el upload + visualización del status.
// No bloquea navegación a otras rutas — el chofer puede salir y
// volver más tarde a completar.

const DOCS = [
    {
        type:    'cedula',
        label:   'Cédula de identidad',
        desc:    'Foto clara de tu cédula (ambas caras si aplica). Asegurate que el número y nombre sean legibles.',
        icon:    'badge',
        accept:  'image/*,application/pdf',
    },
    {
        type:    'licencia',
        label:   'Licencia de conducir',
        desc:    'Licencia vigente. La fecha de vencimiento debe verse.',
        icon:    'card_membership',
        accept:  'image/*,application/pdf',
    },
    {
        type:    'rcv',
        label:   'Póliza RCV',
        desc:    'Responsabilidad Civil Vehicular vigente. Foto o PDF del carnet/comprobante.',
        icon:    'verified_user',
        accept:  'image/*,application/pdf',
    },
    {
        type:    'vehicle_photo',
        label:   'Foto del vehículo',
        desc:    'Foto frontal del vehículo con la placa visible. Tomada de día.',
        icon:    'directions_car',
        accept:  'image/*',
    },
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard cap

const statusChip = (status) => {
    if (status === 'approved') return { label: 'Aprobado',   cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', icon: 'check_circle' };
    if (status === 'rejected') return { label: 'Rechazado',  cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30',           icon: 'cancel' };
    if (status === 'pending')  return { label: 'En revisión', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30',       icon: 'hourglass_empty' };
    return                            { label: 'Pendiente',  cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30',          icon: 'upload' };
};

const extFromMime = (mime) => {
    if (!mime) return 'bin';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('image/')) {
        const sub = mime.split('/')[1];
        return ['jpeg', 'jpg'].includes(sub) ? 'jpg' : sub;
    }
    return 'bin';
};

const DriverOnboardingPage = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState(null);
    const [docs, setDocs] = useState({});          // type → row
    const [previews, setPreviews] = useState({});  // type → signed URL
    const [uploading, setUploading] = useState({}); // type → bool
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async (uid) => {
        const { data } = await supabase
            .from('driver_documents')
            .select('*')
            .eq('user_id', uid);
        const map = {};
        (data || []).forEach(d => { map[d.document_type] = d; });
        setDocs(map);
        // Resolver signed URLs para preview.
        const next = {};
        await Promise.all((data || []).map(async (d) => {
            const { data: signed } = await supabase
                .storage
                .from('driver-docs')
                .createSignedUrl(d.file_path, 300);
            if (signed?.signedUrl) next[d.document_type] = signed.signedUrl;
        }));
        setPreviews(next);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (cancelled) return;
            if (!user) {
                navigate('/auth');
                return;
            }
            setUserId(user.id);
            await refresh(user.id);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [navigate, refresh]);

    const handleFile = async (docType, file) => {
        if (!file || !userId) return;
        if (file.size > MAX_BYTES) {
            alert('El archivo pesa más de 10 MB. Probá con uno más liviano.');
            return;
        }
        setUploading(prev => ({ ...prev, [docType]: true }));
        try {
            const ext = extFromMime(file.type);
            const path = `${userId}/${docType}-${Date.now()}.${ext}`;
            // Subir al bucket.
            const { error: upErr } = await supabase
                .storage
                .from('driver-docs')
                .upload(path, file, {
                    contentType: file.type || 'application/octet-stream',
                    upsert: false,
                });
            if (upErr) throw upErr;

            // Upsert en driver_documents. Si ya había una fila, el
            // trigger driver_documents_resubmit (mig 41) resetea
            // status a 'pending' + limpia reviewed_at/by/reason
            // automáticamente al cambiar file_path.
            const existing = docs[docType];
            if (existing) {
                const { error: updErr } = await supabase
                    .from('driver_documents')
                    .update({
                        file_path: path,
                        file_mime: file.type,
                        file_size: file.size,
                    })
                    .eq('id', existing.id);
                if (updErr) throw updErr;

                // Best-effort: borrar el archivo viejo del bucket si
                // cambió el path. No bloquea si falla.
                if (existing.file_path && existing.file_path !== path) {
                    supabase.storage.from('driver-docs')
                        .remove([existing.file_path]).catch(() => {});
                }
            } else {
                const { error: insErr } = await supabase
                    .from('driver_documents')
                    .insert({
                        user_id: userId,
                        document_type: docType,
                        file_path: path,
                        file_mime: file.type,
                        file_size: file.size,
                    });
                if (insErr) throw insErr;
            }
            await refresh(userId);
        } catch (err) {
            console.error('Upload doc failed:', err);
            alert(`No se pudo subir: ${err.message || err}`);
        } finally {
            setUploading(prev => ({ ...prev, [docType]: false }));
        }
    };

    const approvedCount = Object.values(docs).filter(d => d.status === 'approved').length;
    const allApproved = approvedCount === DOCS.length;
    const anyRejected = Object.values(docs).some(d => d.status === 'rejected');

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] text-white">
            <header className="sticky top-0 z-10 px-4 py-3 bg-[#0F1014]/95 backdrop-blur border-b border-white/5 flex items-center gap-3">
                <button
                    onClick={() => navigate('/driver')}
                    className="w-10 h-10 rounded-full bg-[#1A1F2E] flex items-center justify-center hover:bg-[#252A3A] active:scale-95"
                    aria-label="Volver"
                >
                    <span className="material-symbols-outlined">arrow_back</span>
                </button>
                <div className="flex-1">
                    <h1 className="text-lg font-black">Validar mis documentos</h1>
                    <p className="text-xs text-gray-500">{approvedCount}/{DOCS.length} aprobados</p>
                </div>
            </header>

            <main className="max-w-md mx-auto px-4 pt-4 pb-10 space-y-4">
                {/* Banner global */}
                {allApproved ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-3">
                        <span className="material-symbols-outlined text-emerald-400 text-[28px]">verified</span>
                        <div>
                            <p className="font-bold text-emerald-300">¡Listo! Tus documentos están aprobados.</p>
                            <p className="text-xs text-emerald-200/80 mt-0.5">Ya podés ponerte en línea desde el dashboard.</p>
                        </div>
                    </div>
                ) : anyRejected ? (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-3">
                        <span className="material-symbols-outlined text-rose-400 text-[24px]">error</span>
                        <div>
                            <p className="font-bold text-rose-300">Hay documentos rechazados</p>
                            <p className="text-xs text-rose-200/80 mt-0.5">Mirá el motivo en cada uno y subí una versión nueva.</p>
                        </div>
                    </div>
                ) : (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4 flex items-start gap-3">
                        <span className="material-symbols-outlined text-blue-400 text-[24px]">info</span>
                        <div>
                            <p className="text-sm text-blue-100">
                                Subí los 4 documentos. Un admin los revisa y te avisa por push cuando estén aprobados (en general menos de 24h).
                            </p>
                        </div>
                    </div>
                )}

                {DOCS.map(doc => {
                    const row = docs[doc.type];
                    const chip = statusChip(row?.status);
                    const url = previews[doc.type];
                    const isImage = row?.file_mime?.startsWith('image/');
                    const isPdf   = row?.file_mime === 'application/pdf';
                    const isUploading = uploading[doc.type];
                    return (
                        <div key={doc.type} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4">
                            <div className="flex items-start gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-400 flex items-center justify-center shrink-0">
                                    <span className="material-symbols-outlined text-[20px]">{doc.icon}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-bold text-sm">{doc.label}</p>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border flex items-center gap-1 ${chip.cls}`}>
                                            <span className="material-symbols-outlined text-[12px]">{chip.icon}</span>
                                            {chip.label}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">{doc.desc}</p>
                                </div>
                            </div>

                            {row?.status === 'rejected' && row.rejection_reason && (
                                <div className="mb-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                                    <p className="text-[10px] uppercase tracking-wider text-rose-400 font-bold mb-0.5">Motivo del rechazo</p>
                                    <p className="text-xs text-rose-200">{row.rejection_reason}</p>
                                </div>
                            )}

                            {url && (
                                <div className="mb-3 rounded-lg overflow-hidden border border-white/10 bg-black/30">
                                    {isImage ? (
                                        <img src={url} alt="" className="w-full max-h-48 object-cover" />
                                    ) : isPdf ? (
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 hover:bg-white/5">
                                            <span className="material-symbols-outlined text-red-400 text-[24px]">picture_as_pdf</span>
                                            <span className="text-xs flex-1">Ver PDF</span>
                                            <span className="material-symbols-outlined text-gray-400 text-[16px]">open_in_new</span>
                                        </a>
                                    ) : (
                                        <p className="text-xs text-gray-500 p-3">Archivo cargado</p>
                                    )}
                                </div>
                            )}

                            <label className={`block w-full py-2.5 rounded-xl text-center text-sm font-bold cursor-pointer transition ${
                                row?.status === 'approved'
                                    ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}>
                                {isUploading ? 'Subiendo…'
                                    : row?.status === 'approved' ? 'Aprobado, no se puede reemplazar'
                                    : row ? 'Reemplazar archivo'
                                    : 'Subir archivo'}
                                <input
                                    type="file"
                                    accept={doc.accept}
                                    className="hidden"
                                    disabled={isUploading || row?.status === 'approved'}
                                    onChange={(e) => handleFile(doc.type, e.target.files?.[0])}
                                />
                            </label>
                        </div>
                    );
                })}

                <button
                    onClick={() => navigate('/driver')}
                    className="w-full py-3 rounded-2xl bg-white/5 text-gray-300 font-bold text-sm hover:bg-white/10 mt-2"
                >
                    Volver al dashboard
                </button>
            </main>
        </div>
    );
};

export default DriverOnboardingPage;
