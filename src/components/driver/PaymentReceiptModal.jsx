import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import { toast } from '../Toast';

const MAX_QR_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_QR_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const BOLIVAR_PAYMENT_NOTE = 'El equivalente en bolívares se determina al momento del pago.';

const PaymentReceiptModal = ({
    show,
    activeRide,
    profile,
    navStep,
    confirmDriverPayment,
    handleQRClosed
}) => {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [qrUrl, setQrUrl] = useState(profile?.payment_qr_url || '');

    const isTripPayment = Boolean(show && activeRide);
    const modalOpen = isTripPayment || manageOpen;

    useEffect(() => {
        setQrUrl(profile?.payment_qr_url || '');
    }, [profile?.payment_qr_url]);

    const priceUsd = Number(activeRide?.price) || 0;
    const isPagoMovil = activeRide?.payment_method === 'pago_movil';

    const uploadQrFile = async (file) => {
        if (!file || !profile?.id) return;

        const originalExtension = String(file.name || '').split('.').pop().toLowerCase();
        const mimeExtension = file.type === 'image/png'
            ? 'png'
            : file.type === 'image/webp'
                ? 'webp'
                : file.type === 'image/jpeg'
                    ? 'jpg'
                    : '';
        const extension = mimeExtension || originalExtension;

        if (!ALLOWED_QR_EXTENSIONS.has(extension)) {
            throw new Error('Usa una imagen PNG, JPG o WEBP.');
        }
        if (file.size > MAX_QR_FILE_BYTES) {
            throw new Error('La imagen supera el límite de 5 MB.');
        }

        const filePath = `${profile.id}/payment_qr.${extension}`;
        const contentType = file.type || (extension === 'png'
            ? 'image/png'
            : extension === 'webp'
                ? 'image/webp'
                : 'image/jpeg');

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, file, {
                upsert: true,
                contentType,
                cacheControl: '3600'
            });

        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath);
        const publicUrl = publicData?.publicUrl;
        if (!publicUrl) throw new Error('No se pudo obtener la URL del QR.');

        // El parámetro de versión evita que Android o el navegador mantengan
        // en caché una imagen anterior cuando el conductor reemplaza su QR.
        const versionedUrl = `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ payment_qr_url: versionedUrl })
            .eq('id', profile.id);

        if (updateError) throw updateError;
        setQrUrl(versionedUrl);
    };

    const handleQRUpload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setUploading(true);
        try {
            await uploadQrFile(file);
            toast.success('QR de cobro guardado correctamente.');
        } catch (error) {
            console.error('Error uploading QR:', error);
            toast.error(`No se pudo guardar el QR: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const closeModal = () => {
        if (manageOpen) {
            setManageOpen(false);
            return;
        }
        handleQRClosed?.();
    };

    if (!modalOpen) {
        return (
            <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="absolute top-4 right-[10rem] z-20 w-10 h-10 bg-[#0F172A]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg hover:bg-violet-500/20 transition-colors pointer-events-auto"
                title={qrUrl ? 'Mostrar o cambiar QR de cobro' : 'Cargar QR de cobro'}
                aria-label={qrUrl ? 'Mostrar o cambiar QR de cobro' : 'Cargar QR de cobro'}
            >
                <span className="material-symbols-outlined text-violet-400 text-lg">qr_code_2</span>
                {!qrUrl && (
                    <span
                        className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-[#0F172A]"
                        aria-hidden="true"
                    />
                )}
            </button>
        );
    }

    const isDelivery = Boolean(activeRide && (activeRide.service_type === 'delivery' || activeRide.delivery_info));
    const isSenderPayer = Boolean(
        isDelivery && (activeRide.delivery_info?.payer === 'sender' || activeRide.payer === 'sender')
    );

    let titleText = manageOpen ? 'Tu QR de cobro' : '¡Viaje Completado!';
    let subtitleText = manageOpen
        ? 'Carga el QR que mostrarás al cliente para recibir el pago al finalizar el viaje.'
        : 'Muestra este código al pasajero para recibir tu pago móvil.';

    if (!manageOpen && navStep === 1 && isSenderPayer) {
        titleText = 'Cobro de Origen (Envío)';
        subtitleText = 'El remitente debe realizar el Pago Móvil antes de iniciar la ruta.';
    } else if (!manageOpen && isDelivery) {
        titleText = '¡Envío Entregado!';
        subtitleText = 'Muestra este código al destinatario para el Pago Móvil.';
    }

    return (
        <div className="absolute inset-0 bg-[#020617]/95 z-50 flex items-center justify-center p-4 pointer-events-auto backdrop-blur-xl animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-[#0B0F19]/90 border border-white/10 text-white p-6 rounded-[32px] w-full max-w-sm text-center shadow-2xl my-auto animate-in scale-in duration-300">
                <div className="w-12 h-12 bg-violet-500/10 border border-violet-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-violet-400">
                    <span className="material-symbols-outlined text-2xl">qr_code_2</span>
                </div>

                <h2 className="text-2xl font-black mb-1.5 text-white tracking-tight">{titleText}</h2>
                <p className="text-gray-400 mb-6 text-xs max-w-[260px] mx-auto leading-normal">
                    {subtitleText}
                </p>

                <div className="bg-white p-3.5 rounded-[24px] mb-4 mx-auto w-48 h-48 flex items-center justify-center border border-white/10 shadow-inner relative group">
                    {qrUrl ? (
                        <img src={qrUrl} alt="Código QR de cobro del conductor" className="w-full h-full object-contain rounded-lg" />
                    ) : (
                        <div className="w-full h-full rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-2 text-slate-500 px-4">
                            <span className="material-symbols-outlined text-5xl">qr_code_2</span>
                            <span className="text-xs font-bold leading-tight">Aún no has cargado tu QR</span>
                        </div>
                    )}
                    {uploading && (
                        <div className="absolute inset-0 bg-black/70 rounded-[24px] flex flex-col items-center justify-center text-white text-xs font-bold gap-2">
                            <span className="material-symbols-outlined animate-spin">progress_activity</span>
                            Subiendo QR...
                        </div>
                    )}
                </div>

                {profile?.full_name && (
                    <p className="text-xs font-bold text-white mb-3">Cobro de {profile.full_name}</p>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleQRUpload}
                    disabled={uploading}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 mb-5 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-gray-200 px-4 py-2 rounded-full font-bold cursor-pointer transition-colors active:scale-95 border border-white/5"
                >
                    <span className="material-symbols-outlined text-base">cloud_upload</span>
                    {qrUrl ? 'Cambiar imagen QR' : 'Cargar código QR'}
                </button>

                {manageOpen && (
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4 mb-5 text-left">
                        <div className="flex gap-3">
                            <span className="material-symbols-outlined text-violet-300">info</span>
                            <p className="text-xs text-violet-100 leading-relaxed">
                                Este QR aparecerá automáticamente cuando confirmes que llegaste al destino y debas cobrarle al pasajero.
                            </p>
                        </div>
                    </div>
                )}

                {!manageOpen && (
                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-4 mb-5 shadow-inner">
                        <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-1">Monto Total a Cobrar</p>

                        <div className="flex flex-col items-center justify-center">
                            <h2 className="text-3xl font-black text-white tracking-tighter mb-0.5">
                                ${priceUsd.toFixed(2)} <span className="text-sm font-bold text-gray-400">USD</span>
                            </h2>

                            {isPagoMovil && (
                                <p className="text-[10px] text-gray-400 mt-2 leading-relaxed max-w-[240px]">
                                    {BOLIVAR_PAYMENT_NOTE}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {!manageOpen && navStep === 2 && (
                    <div className="mb-5 bg-slate-900/50 p-3 rounded-2xl border border-white/5 space-y-2.5">
                        <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider text-left pl-1">Estado de Confirmación</p>

                        <div className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-2">
                                <span className={`material-symbols-outlined text-base ${activeRide.payment_confirmed_by_user ? 'text-emerald-400' : 'text-gray-600 animate-pulse'}`}>
                                    {activeRide.payment_confirmed_by_user ? 'check_circle' : 'hourglass_empty'}
                                </span>
                                <span className="text-gray-300">Confirmado por Pasajero</span>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${activeRide.payment_confirmed_by_user ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                                {activeRide.payment_confirmed_by_user ? 'Listo' : 'Esperando'}
                            </span>
                        </div>

                        <div className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-2">
                                <span className={`material-symbols-outlined text-base ${activeRide.payment_confirmed_by_driver ? 'text-emerald-400' : 'text-gray-600'}`}>
                                    {activeRide.payment_confirmed_by_driver ? 'check_circle' : 'hourglass_empty'}
                                </span>
                                <span className="text-gray-300">Confirmado por Ti</span>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${activeRide.payment_confirmed_by_driver ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                                {activeRide.payment_confirmed_by_driver ? 'Listo' : 'Pendiente'}
                            </span>
                        </div>
                    </div>
                )}

                <div className="space-y-3">
                    {!manageOpen && navStep === 2 && !activeRide.payment_confirmed_by_driver && (
                        <button
                            onClick={confirmDriverPayment}
                            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-base shadow-lg shadow-emerald-600/15 active:scale-95 transition-all flex items-center justify-center gap-2 border border-emerald-500/30"
                        >
                            <span className="material-symbols-outlined text-xl">payments</span>
                            Marcar como Pago Recibido ✓
                        </button>
                    )}

                    <button
                        onClick={closeModal}
                        className="w-full py-4 bg-white text-black hover:bg-gray-100 rounded-2xl font-bold text-base transition-colors shadow-lg active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>{manageOpen ? 'Listo' : navStep === 1 ? 'Continuar e Iniciar Ruta' : 'Cerrar y Volver al Mapa'}</span>
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentReceiptModal;
