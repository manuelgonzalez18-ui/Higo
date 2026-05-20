import React, { useState } from 'react';
import { triggerEmergencyAlert } from '../../utils/triggerEmergencyAlert';

// Wait fee config matching the system
const WAIT_RATES_PER_MIN = { moto: 0.05, standard: 0.08, van: 0.10 };
const FREE_WAIT_MINUTES = 3;

const computeWaitFee = (rideType, seconds) => {
    const rate = WAIT_RATES_PER_MIN[rideType] ?? WAIT_RATES_PER_MIN.standard;
    const billableMin = Math.max(0, seconds / 60 - FREE_WAIT_MINUTES);
    return parseFloat((billableMin * rate).toFixed(2));
};

const TripInfoPanel = ({
    activeRide,
    navStep,
    arrivalTime,
    waitElapsedSec,
    waitFee,
    completing,
    navInfo,
    voiceEnabled,
    setVoiceEnabled,
    handleMarkArrival,
    handleCompleteStep,
    navigate,
    profile
}) => {
    const [showTripDetails, setShowTripDetails] = useState(false);
    const [isCardMinimized, setIsCardMinimized] = useState(false);

    if (!activeRide) return null;

    const handleSOS = () => {
        const ok = confirm(
            "🚨 ALERTA DE EMERGENCIA\n\n" +
            "Vamos a:\n" +
            "  • Notificar al equipo Higo con tu ubicación actual\n" +
            (activeRide ? "  • Compartir datos del viaje y del pasajero con soporte\n" : "") +
            "  • Llamar al 911 inmediatamente después\n\n" +
            "¿Continuar?"
        );
        if (!ok) return;
        triggerEmergencyAlert({
            rideId: activeRide?.id || null,
            triggeredBy: 'driver',
        }).catch(err => console.error('Emergency alert (driver) failed:', err));
        window.location.href = 'tel:911';
    };

    const isDelivery = activeRide.service_type === 'delivery' || activeRide.delivery_info;
    const isSenderPayer = isDelivery && (activeRide.delivery_info?.payer === 'sender' || activeRide.payer === 'sender');

    // Route calculation helper
    const etaTime = navInfo?.duration?.value
        ? new Date(Date.now() + navInfo.duration.value * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : "--:--";

    return (
        <div className="flex-1 flex flex-col justify-between p-4 pt-12 relative pointer-events-none">
            
            {/* Top Navigation HUD Panel (Floating overlay) */}
            <div className="bg-[#0F172A]/90 backdrop-blur-md rounded-3xl p-4 shadow-2xl border border-white/10 flex items-center justify-between mx-auto w-full max-w-sm pointer-events-auto animate-in slide-in-from-top-4 relative z-20">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center text-blue-400">
                        <span className="material-symbols-outlined text-xl">
                            {navStep === 1 ? 'place' : 'near_me'}
                        </span>
                    </div>
                    <div>
                        <h2 className="font-bold text-white text-sm leading-snug text-left max-w-[200px] truncate">
                            {navInfo?.next_step?.instruction?.replace(/<[^>]*>/g, '') || "Calculando ruta..."}
                        </h2>
                        <p className="text-gray-400 text-xs text-left font-medium">
                            {navInfo?.next_step?.distance?.text || "--"} • {navInfo?.duration?.text || "--"}
                        </p>
                    </div>
                </div>
            </div>

            {/* Right side floating controls */}
            <div className="absolute top-32 right-4 flex flex-col gap-2.5 pointer-events-auto z-20">
                {/* Details Button */}
                <button
                    onClick={() => setShowTripDetails(true)}
                    className="w-11 h-11 bg-[#0F172A]/90 hover:bg-slate-800 text-cyan-400 rounded-full shadow-lg border border-white/10 flex items-center justify-center transition-transform active:scale-90"
                    title="Detalles del viaje"
                >
                    <span className="material-symbols-outlined text-xl">assignment</span>
                </button>

                {/* Voice Toggle in navigation */}
                <button
                    onClick={() => setVoiceEnabled(!voiceEnabled)}
                    className={`w-11 h-11 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg transition-colors ${voiceEnabled ? 'bg-blue-600/90 text-white' : 'bg-[#0F172A]/90 text-gray-400'}`}
                    title={voiceEnabled ? 'Desactivar Guía de Voz' : 'Activar Guía de Voz'}
                >
                    <span className="material-symbols-outlined text-xl">{voiceEnabled ? 'volume_up' : 'volume_off'}</span>
                </button>
            </div>

            {/* Bottom Panel Container */}
            <div className="bg-[#0F172A]/95 backdrop-blur-md rounded-[32px] p-5 shadow-2xl border border-white/10 pointer-events-auto animate-in slide-in-from-bottom-10 mt-auto">
                
                {/* Drag Handle / Minimize Toggle */}
                <div
                    onClick={() => setIsCardMinimized(!isCardMinimized)}
                    className="w-full flex justify-center pb-4 cursor-pointer active:opacity-70 touch-none"
                >
                    <div className={`w-12 h-1.5 bg-gray-700/50 rounded-full transition-colors ${isCardMinimized ? 'bg-blue-500' : ''}`}></div>
                </div>

                {/* Main Card Content (Hidden when minimized) */}
                {!isCardMinimized && (
                    <>
                        <div className="flex items-center gap-3.5 mb-5 animate-in fade-in slide-in-from-bottom-4 duration-200">
                            {/* Profile Image & Rating */}
                            <div className="relative shrink-0">
                                <div className="w-14 h-14 rounded-2xl bg-slate-800 bg-center bg-cover border-2 border-white/10 shadow-md" style={{ backgroundImage: 'url(https://picsum.photos/200)' }}></div>
                                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-white text-black px-1.5 py-0.5 rounded-full text-[9px] font-black border border-gray-100 shadow-sm flex items-center gap-0.5 whitespace-nowrap">
                                    <span>4.9</span> <span className="text-yellow-500">★</span>
                                </div>
                            </div>

                            {/* Passenger name & vehicle stats */}
                            <div className="flex-1 min-w-0 pr-2">
                                <h2 className="font-bold text-lg text-white truncate leading-tight text-left">
                                    {activeRide.passenger_name || "Pasajero"}
                                </h2>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    <span className="text-[9px] bg-blue-500/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded-lg font-bold uppercase tracking-wide">
                                        {activeRide.ride_type || activeRide.vehicle_type || 'Estándar'}
                                    </span>
                                    {isDelivery && (
                                        <span className="text-[9px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-lg font-bold uppercase tracking-wide">
                                            Envío
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Call & Chat Buttons */}
                            <div className="flex gap-2 shrink-0">
                                <a 
                                    href={`tel:${activeRide.passenger_phone || ''}`} 
                                    className="w-11 h-11 bg-[#1E293B] rounded-2xl flex items-center justify-center border border-white/5 hover:bg-slate-700 hover:text-emerald-400 transition-all active:scale-90 shadow-md text-white"
                                    title="Llamar pasajero"
                                >
                                    <span className="material-symbols-outlined text-[20px]">call</span>
                                </a>
                                <button
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('open-chat', { detail: { rideId: activeRide.id, title: 'Chat con Pasajero' } }));
                                    }}
                                    className="w-11 h-11 bg-[#1E293B] rounded-2xl flex items-center justify-center border border-white/5 hover:bg-slate-700 hover:text-blue-400 transition-all active:scale-90 shadow-md text-white"
                                    title="Chat interno"
                                >
                                    <span className="material-symbols-outlined text-[20px]">chat_bubble</span>
                                </button>
                                {/* SOS Chofer */}
                                <button
                                    onClick={handleSOS}
                                    className="w-11 h-11 bg-red-600/20 rounded-2xl flex items-center justify-center border border-red-500/40 hover:bg-red-600/30 transition-all active:scale-90 shadow-md text-white"
                                    title="Emergencia · Notificar Higo y llamar al 911"
                                >
                                    <span className="material-symbols-outlined text-red-400 text-[20px]">e911_emergency</span>
                                </button>
                            </div>
                        </div>

                        {/* Navigation ETA & distance statistics */}
                        <div className="grid grid-cols-3 gap-2 mb-5 bg-[#111827]/75 p-3 rounded-2xl border border-white/5 animate-in fade-in duration-300">
                            <div>
                                <p className="text-[8px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">TIEMPO</p>
                                <p className="text-white font-bold text-sm truncate">
                                    {navInfo?.duration?.text?.split(' ')[0] || "--"} <span className="text-[10px] font-normal text-gray-400">{navInfo?.duration?.text?.split(' ')[1] || "min"}</span>
                                </p>
                            </div>
                            <div className="border-l border-white/5 pl-3">
                                <p className="text-[8px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">DISTANCIA</p>
                                <p className="text-white font-bold text-sm truncate">
                                    {navInfo?.distance?.text?.split(' ')[0] || "--"} <span className="text-[10px] font-normal text-gray-400">{navInfo?.distance?.text?.split(' ')[1] || "km"}</span>
                                </p>
                            </div>
                            <div className="border-l border-white/5 pl-3">
                                <p className="text-[8px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">ETA (LLEGADA)</p>
                                <p className="text-white font-bold text-sm">
                                    {etaTime}
                                </p>
                            </div>
                        </div>
                    </>
                )}

                {/* Wait Fee Overlay during Step 1 (Pickup Waiting) */}
                {navStep === 1 && arrivalTime && (() => {
                    const liveFee = computeWaitFee(activeRide?.ride_type, waitElapsedSec);
                    const mm = String(Math.floor(waitElapsedSec / 60)).padStart(2, '0');
                    const ss = String(waitElapsedSec % 60).padStart(2, '0');
                    const billing = waitElapsedSec / 60 > FREE_WAIT_MINUTES;
                    return (
                        <div className="mb-3 px-3.5 py-2.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex items-center justify-between animate-in fade-in duration-200">
                            <div className="flex items-center gap-2 text-left">
                                <span className="material-symbols-outlined text-amber-500 text-lg animate-pulse">hourglass_top</span>
                                <div>
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">Pasajero en espera</p>
                                    <p className="text-white font-bold text-xs tabular-nums">Cronómetro: {mm}:{ss}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[8px] text-gray-500 font-bold uppercase">{billing ? 'Cargo por Espera' : `Gratis ${FREE_WAIT_MINUTES} min`}</p>
                                <p className={`font-bold text-sm ${billing ? 'text-amber-500 animate-pulse' : 'text-emerald-400 font-semibold'}`}>
                                    +${liveFee.toFixed(2)}
                                </p>
                            </div>
                        </div>
                    );
                })()}

                {/* Actions Grid */}
                <div className="space-y-3.5">
                    {/* Mark arrival button at pickup */}
                    {navStep === 1 && !arrivalTime && (
                        <button
                            onClick={handleMarkArrival}
                            className={`w-full bg-amber-500 hover:bg-amber-600 text-black rounded-2xl font-bold shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2 active:scale-95 transition-all ${isCardMinimized ? 'py-3 text-sm' : 'py-4 text-base'}`}
                        >
                            <span className="material-symbols-outlined">flag</span>
                            <span>Marcar Llegada en Origen</span>
                        </button>
                    )}

                    {/* Main step completed button */}
                    <button
                        onClick={handleCompleteStep}
                        disabled={(navStep === 1 && !arrivalTime) || completing}
                        className={`w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-2xl font-bold shadow-lg shadow-blue-500/15 flex items-center justify-center gap-2 active:scale-95 transition-all ${isCardMinimized ? 'py-3 text-sm' : 'py-4 text-base'}`}
                    >
                        {completing ? (
                            <>
                                <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                                <span>Procesando...</span>
                            </>
                        ) : (
                            <>
                                <span>{navStep === 1 ? "Iniciar Viaje (Comenzar Ruta)" : "Completar Viaje (Llegada a Destino)"}</span>
                                <span className="material-symbols-outlined text-lg">arrow_forward</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* FLOATING TRIP DETAILS MODAL */}
            {showTripDetails && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto">
                    <div className="bg-[#0B0F19] w-full max-w-md rounded-[32px] p-0 shadow-2xl border border-white/10 relative overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-8 duration-300">
                        
                        {/* Modal Header */}
                        <div className="p-5 bg-[#0F172A] border-b border-white/5 flex justify-between items-center text-left">
                            <h2 className="text-lg font-black text-white flex items-center gap-2">
                                <span className="material-symbols-outlined text-blue-400">receipt_long</span>
                                Hoja de Ruta e Info
                            </h2>
                            <button
                                onClick={() => setShowTripDetails(false)}
                                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                            >
                                <span className="material-symbols-outlined text-white text-sm">close</span>
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar text-left">
                            
                            {/* HIGO MANDADO (DELIVERY) DETAILS */}
                            {isDelivery && (
                                <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-4">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-9 h-9 rounded-xl bg-yellow-500/10 flex items-center justify-center text-yellow-500 shrink-0">
                                            <span className="material-symbols-outlined text-lg">package_2</span>
                                        </div>
                                        <div>
                                            <h3 className="text-yellow-500 font-black text-xs uppercase tracking-wider">Higo Mandado (Envío)</h3>
                                            <p className="text-[10px] text-gray-400 mt-0.5">
                                                Cobro: <span className="text-white font-bold uppercase">{isSenderPayer ? 'Remitente (Origen)' : 'Destinatario (Destino)'}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-3.5">
                                        {/* Sender info */}
                                        <div className="bg-black/25 p-3 rounded-xl border border-white/5 text-left">
                                            <p className="text-[9px] text-yellow-500 font-bold uppercase tracking-wider mb-1">👤 REMITENTE (ORIGEN)</p>
                                            <p className="text-white font-bold text-sm leading-snug">{activeRide.delivery_info?.senderName || "Cliente"}</p>
                                            <p className="text-gray-400 text-xs font-semibold mt-0.5 mb-2">{activeRide.delivery_info?.senderPhone || activeRide.passenger_phone || "--"}</p>
                                            {(activeRide.delivery_info?.senderPhone || activeRide.passenger_phone) && (() => {
                                                const rawPhone = activeRide.delivery_info?.senderPhone || activeRide.passenger_phone;
                                                const phone = String(rawPhone).replace(/[^0-9]/g, '');
                                                const name = (profile?.full_name || '').split(' ')[0] || 'Higo';
                                                const waText = encodeURIComponent(`Hola, soy ${name} de Higo Envíos. Voy a retirar tu paquete.`);
                                                return (
                                                    <div className="flex gap-2 mb-2">
                                                        <a href={`tel:${rawPhone}`} className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1 border border-blue-500/30">
                                                            <span className="material-symbols-outlined text-sm">call</span>
                                                            Llamar
                                                        </a>
                                                        <a href={`https://wa.me/${phone}?text=${waText}`} target="_blank" rel="noopener noreferrer" className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1 border border-emerald-500/30">
                                                            <span className="material-symbols-outlined text-sm">chat</span>
                                                            WhatsApp
                                                        </a>
                                                    </div>
                                                );
                                            })()}
                                            <div className="mt-2 text-xs text-gray-300 bg-[#0F172A]/40 p-2 rounded-lg border border-white/5 font-medium">
                                                <span className="font-bold text-gray-500 block mb-0.5">Retiro:</span>
                                                {activeRide.delivery_info?.originInstructions || "Llamar al llegar."}
                                            </div>
                                        </div>

                                        {/* Receiver info */}
                                        <div className="bg-black/25 p-3 rounded-xl border border-white/5 text-left">
                                            <p className="text-[9px] text-yellow-500 font-bold uppercase tracking-wider mb-1">🏁 DESTINATARIO (LLEGADA)</p>
                                            <p className="text-white font-bold text-sm leading-snug">{activeRide.delivery_info?.receiverName || "--"}</p>
                                            <p className="text-gray-400 text-xs font-semibold mt-0.5 mb-2">{activeRide.delivery_info?.receiverPhone || "--"}</p>
                                            {activeRide.delivery_info?.receiverPhone && (() => {
                                                const phone = String(activeRide.delivery_info.receiverPhone).replace(/[^0-9]/g, '');
                                                const name = (profile?.full_name || '').split(' ')[0] || 'Higo';
                                                const waText = encodeURIComponent(`Hola, soy ${name} de Higo Envíos. Voy en camino con tu paquete.`);
                                                return (
                                                    <div className="flex gap-2 mb-2">
                                                        <a href={`tel:${activeRide.delivery_info.receiverPhone}`} className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1 border border-blue-500/30">
                                                            <span className="material-symbols-outlined text-sm">call</span>
                                                            Llamar
                                                        </a>
                                                        <a href={`https://wa.me/${phone}?text=${waText}`} target="_blank" rel="noopener noreferrer" className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1 border border-emerald-500/30">
                                                            <span className="material-symbols-outlined text-sm">chat</span>
                                                            WhatsApp
                                                        </a>
                                                    </div>
                                                );
                                            })()}
                                            <div className="mt-2 text-xs text-gray-300 bg-[#0F172A]/40 p-2 rounded-lg border border-white/5 font-medium">
                                                <span className="font-bold text-gray-500 block mb-0.5">Entrega:</span>
                                                {activeRide.delivery_info?.destInstructions || activeRide.instructions || "Entregar en portería."}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Addresses timeline */}
                            <div className="space-y-6 relative pl-3.5">
                                <div className="absolute left-[5.5px] top-2.5 bottom-6 w-0.5 bg-slate-800 border-l border-dashed border-slate-700"></div>

                                <div>
                                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1 pl-4">Origen</p>
                                    <div className="flex items-start gap-3">
                                        <div className="w-3 h-3 rounded-full border-2 border-gray-400 bg-[#0B0F19] z-10 mt-1 shrink-0"></div>
                                        <p className="text-white font-semibold text-sm leading-snug">{activeRide.pickup}</p>
                                    </div>
                                </div>

                                <div>
                                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1 pl-4">Destino</p>
                                    <div className="flex items-start gap-3">
                                        <div className="w-3 h-3 rounded-full bg-blue-500 z-10 mt-1 shrink-0 shadow-[0_0_6px_rgba(59,130,246,0.5)]"></div>
                                        <p className="text-white font-semibold text-sm leading-snug">{activeRide.dropoff}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Fare Details Card */}
                            <div className="pt-4 border-t border-white/10 flex justify-between items-center bg-[#111827]/30 p-3 rounded-xl border border-white/5">
                                <div>
                                    <p className="text-[9px] text-gray-400 font-bold uppercase">Costo Estimado</p>
                                    <p className="text-[10px] text-gray-500 mt-0.5">Sujeto a variación por espera</p>
                                </div>
                                <p className="text-emerald-400 font-black text-2xl">${activeRide.price}</p>
                            </div>

                        </div>

                        {/* Close button */}
                        <div className="p-4 bg-[#0F172A]/50 border-t border-white/5">
                            <button
                                onClick={() => setShowTripDetails(false)}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-bold shadow-lg active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-sm">map</span>
                                Volver al Mapa
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TripInfoPanel;
