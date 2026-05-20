import React, { useEffect, useState } from 'react';
import { stopLoopingRequestAlert } from '../../services/notificationService';

const IncomingRequestCard = ({ request, onAccept, onDecline }) => {
    const [timeLeft, setTimeLeft] = useState(25);

    useEffect(() => {
        setTimeLeft(25);
        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    onDecline(request.id);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [request.id, onDecline]);

    if (!request) return null;

    const isDelivery = request.service_type === 'delivery' || request.delivery_info;
    const priceFormatted = parseFloat(request.price).toFixed(2);
    
    // Calculate progress percentage
    const progressWidth = `${(timeLeft / 25) * 100}%`;

    return (
        <div className="bg-[#0F172A]/95 backdrop-blur-md rounded-[32px] p-6 shadow-2xl border border-white/10 relative overflow-hidden animate-in slide-in-from-bottom-20 fade-in duration-300">
            {/* Countdown Progress Bar */}
            <div className="absolute top-0 left-0 w-full h-1 bg-[#1E293B]">
                <div 
                    className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
                    style={{ width: progressWidth }}
                />
            </div>

            {/* Top Right Timer Badge */}
            <div className="absolute top-6 right-6 text-right">
                <span className="text-xs font-bold text-blue-400 tabular-nums bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-full">
                    {timeLeft}s restante{timeLeft !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Header Title */}
            <div className="flex gap-3 mb-6 items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></div>
                <div>
                    <h2 className="text-lg font-black text-white leading-tight">Solicitud de Viaje</h2>
                </div>
            </div>

            {/* Price section */}
            <div className="mb-6 flex justify-between items-end">
                <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">TARIFA ESTIMADA</p>
                    <h1 className="text-4xl font-black text-white tracking-tighter">${priceFormatted}</h1>
                </div>
                <div className="text-right">
                    <span className="text-xs bg-[#1E293B] border border-white/5 text-gray-300 px-3 py-1 rounded-xl font-bold uppercase tracking-wide">
                        {request.ride_type || 'Estándar'}
                    </span>
                </div>
            </div>

            {/* Delivery Badge - HIGO MANDADO */}
            {isDelivery && (
                <div className="mb-4 bg-yellow-600/90 backdrop-blur-sm p-3.5 rounded-2xl text-center shadow-lg border border-yellow-500/30">
                    <h2 className="text-xl font-black text-white uppercase tracking-wider flex items-center justify-center gap-2 drop-shadow-md">
                        <span className="material-symbols-outlined text-white">package_2</span>
                        HIGO MANDADO
                    </h2>
                    <p className="text-yellow-100 text-[10px] font-bold mt-0.5 uppercase tracking-wide">
                        Revisar detalles del envío al iniciar viaje
                    </p>
                </div>
            )}

            {/* Delivery Instructions if provided */}
            {(request.instructions || request.delivery_instructions) && (
                <div className="mb-5 bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-2xl flex gap-2.5 items-start">
                    <span className="material-symbols-outlined text-yellow-500 text-lg shrink-0 mt-0.5">sticky_note_2</span>
                    <div>
                        <p className="text-[9px] text-yellow-500 font-black uppercase tracking-wider">Notas del Mandado</p>
                        <p className="text-xs text-gray-300 leading-relaxed font-medium">
                            {request.instructions || request.delivery_instructions}
                        </p>
                    </div>
                </div>
            )}

            {/* Route Timeline */}
            <div className="space-y-5 relative pl-3.5 mb-7">
                {/* Timeline Line */}
                <div className="absolute left-[5.5px] top-2 bottom-5 w-0.5 bg-slate-800 border-l border-dashed border-slate-700"></div>

                {/* Pickup Location */}
                <div className="relative">
                    <div className="flex items-center gap-2 mb-0.5">
                        <div className="w-3 h-3 rounded-full border-2 border-gray-400 bg-[#0F172A] z-10"></div>
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">ORIGEN (PICKUP)</p>
                    </div>
                    <p className="text-white font-bold text-base ml-5 truncate max-w-[90%] leading-snug">{request.pickup}</p>
                </div>

                {/* Dropoff Location */}
                <div className="relative">
                    <div className="flex items-center gap-2 mb-0.5">
                        <div className="w-3 h-3 rounded-full bg-blue-500 z-10 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
                        <p className="text-[9px] text-blue-400 font-bold uppercase tracking-wider">DESTINO (DROPOFF)</p>
                    </div>
                    <p className="text-white font-bold text-base ml-5 truncate max-w-[90%] leading-snug">{request.dropoff}</p>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4">
                <button 
                    onClick={() => onDecline(request.id)}
                    className="w-14 h-14 rounded-2xl bg-[#1E293B] flex items-center justify-center border border-white/5 hover:bg-[#2C3345] hover:text-red-400 transition-all active:scale-90 shrink-0 shadow-lg text-gray-400"
                    title="Rechazar solicitud"
                >
                    <span className="material-symbols-outlined text-2xl">close</span>
                </button>
                <button 
                    onClick={() => onAccept(request)}
                    className="flex-1 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                    <span>Aceptar Viaje</span>
                    <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
            </div>
        </div>
    );
};

export default IncomingRequestCard;
