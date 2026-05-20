import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';
import { getOfficialBcvRate } from '../../services/bcv';

const PaymentReceiptModal = ({
    show,
    activeRide,
    profile,
    navStep,
    confirmDriverPayment,
    handleQRClosed
}) => {
    const [bcvRate, setBcvRate] = useState(null);
    const [loadingRate, setLoadingRate] = useState(true);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (!show) return;

        const fetchRate = async () => {
            setLoadingRate(true);
            try {
                const data = await getOfficialBcvRate();
                if (data && data.rate) {
                    setBcvRate(data.rate);
                }
            } catch (err) {
                console.error("Error fetching BCV rate:", err);
            } finally {
                setLoadingRate(false);
            }
        };

        fetchRate();
    }, [show]);

    if (!show || !activeRide) return null;

    const priceUsd = Number(activeRide.price) || 0;
    const priceBs = bcvRate ? priceUsd * bcvRate : null;

    const handleQRUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${profile.id}/payment_qr.${fileExt}`;
            const filePath = `${fileName}`;

            // 1. Upload
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            // 3. Update Profile
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ payment_qr_url: publicUrl })
                .eq('id', profile.id);

            if (updateError) throw updateError;

            alert("¡Código QR cargado exitosamente!");
            window.location.reload();
        } catch (error) {
            console.error("Error uploading QR:", error);
            alert("Error al cargar imagen QR: " + error.message);
        } finally {
            setUploading(false);
        }
    };

    const isDelivery = activeRide.service_type === 'delivery' || activeRide.delivery_info;
    const isSenderPayer = isDelivery && (activeRide.delivery_info?.payer === 'sender' || activeRide.payer === 'sender');

    // Title text changes based on service and stage
    let titleText = "¡Viaje Completado!";
    let subtitleText = "Muestra este código al pasajero para recibir tu pago móvil.";
    
    if (navStep === 1 && isSenderPayer) {
        titleText = "Cobro de Origen (Envío)";
        subtitleText = "El remitente debe realizar el Pago Móvil antes de iniciar la ruta.";
    } else if (isDelivery) {
        titleText = "¡Envío Entregado!";
        subtitleText = "Muestra este código al destinatario para el Pago Móvil.";
    }

    return (
        <div className="absolute inset-0 bg-[#020617]/95 z-50 flex items-center justify-center p-4 pointer-events-auto backdrop-blur-xl animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-[#0B0F19]/90 border border-white/10 text-white p-6 rounded-[32px] w-full max-w-sm text-center shadow-2xl my-auto animate-in scale-in duration-300">
                
                {/* Header Badge */}
                <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-400">
                    <span className="material-symbols-outlined text-2xl">qr_code_2</span>
                </div>

                <h2 className="text-2xl font-black mb-1.5 text-white tracking-tight">{titleText}</h2>
                <p className="text-gray-400 mb-6 text-xs max-w-[240px] mx-auto leading-normal">
                    {subtitleText}
                </p>

                {/* QR Display Frame */}
                <div className="bg-white p-3.5 rounded-[24px] mb-4 mx-auto w-48 h-48 flex items-center justify-center border border-white/10 shadow-inner relative group">
                    {profile?.payment_qr_url ? (
                        <img src={profile.payment_qr_url} alt="Pago Móvil QR" className="w-full h-full object-contain rounded-lg" />
                    ) : (
                        <img src="/test_qr.png" alt="Test QR Code" className="w-full h-full object-contain rounded-lg opacity-70" />
                    )}
                    {uploading && (
                        <div className="absolute inset-0 bg-black/60 rounded-[24px] flex flex-col items-center justify-center text-white text-xs font-bold gap-2">
                            <span className="material-symbols-outlined animate-spin">progress_activity</span>
                            Subiendo QR...
                        </div>
                    )}
                </div>

                {/* Upload Action Label */}
                <label className="block mb-6">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleQRUpload}
                        disabled={uploading}
                    />
                    <span className="inline-flex items-center gap-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-gray-300 px-3.5 py-1.5 rounded-full font-bold cursor-pointer transition-colors active:scale-95 border border-white/5">
                        <span className="material-symbols-outlined text-sm">cloud_upload</span>
                        {profile?.payment_qr_url ? 'Cambiar Imagen QR' : 'Subir Código QR'}
                    </span>
                </label>

                {/* Double Currency Display Card */}
                <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-4 mb-5 shadow-inner">
                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-1">Monto Total a Cobrar</p>
                    
                    <div className="flex flex-col items-center justify-center">
                        <h2 className="text-3xl font-black text-white tracking-tighter mb-0.5">
                            ${priceUsd.toFixed(2)} <span className="text-sm font-bold text-gray-400">USD</span>
                        </h2>

                        {loadingRate ? (
                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                                <span>Calculando tasa BCV...</span>
                            </div>
                        ) : priceBs ? (
                            <div className="mt-1 flex flex-col items-center">
                                <h3 className="text-xl font-bold text-emerald-400 tracking-tight">
                                    {priceBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                                </h3>
                                <p className="text-[9px] text-gray-500 mt-0.5">
                                    Tasa oficial BCV: <span className="font-bold">{bcvRate.toFixed(2)} Bs/$</span>
                                </p>
                            </div>
                        ) : (
                            <p className="text-[10px] text-red-400 mt-1 font-semibold">Tasa BCV no disponible</p>
                        )}
                    </div>
                </div>

                {/* Venezuelan Pago Móvil standard parameters (Banesco) */}
                <div className="bg-blue-900/10 border border-blue-500/10 rounded-2xl p-3.5 text-left mb-6 text-xs space-y-2">
                    <p className="text-[9px] text-blue-400 font-black uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">info</span>
                        Datos de Pago Móvil (Banesco)
                    </p>
                    <div className="flex justify-between text-gray-300">
                        <span className="text-gray-500">Teléfono:</span>
                        <span className="font-bold text-white">{profile?.phone || profile?.passenger_phone || "No configurado"}</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                        <span className="text-gray-500">Cédula:</span>
                        <span className="font-bold text-white">{profile?.national_id || "No registrada"}</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                        <span className="text-gray-500">Banco:</span>
                        <span className="font-bold text-white">Banesco (0134)</span>
                    </div>
                </div>

                {/* Bilateral Confirmation Status Indicators (Only during navStep 2 end of trip) */}
                {navStep === 2 && (
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

                {/* Action Buttons */}
                <div className="space-y-3">
                    {navStep === 2 && !activeRide.payment_confirmed_by_driver && (
                        <button
                            onClick={confirmDriverPayment}
                            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-base shadow-lg shadow-emerald-600/15 active:scale-95 transition-all flex items-center justify-center gap-2 border border-emerald-500/30"
                        >
                            <span className="material-symbols-outlined text-xl">payments</span>
                            Marcar como Pago Recibido ✓
                        </button>
                    )}

                    <button
                        onClick={handleQRClosed}
                        className="w-full py-4 bg-white text-black hover:bg-gray-100 rounded-2xl font-bold text-base transition-colors shadow-lg active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>{navStep === 1 ? 'Continuar e Iniciar Ruta' : 'Cerrar y Volver al Mapa'}</span>
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentReceiptModal;
