import React, { useEffect, useState } from 'react';
import { X, ArrowRight, MapPin, Navigation } from 'lucide-react';

import { startLoopingRequestAlert, stopLoopingRequestAlert } from '../services/notificationService';

const DriverRequestCard = ({ request, onAccept, onDecline, isVisible }) => {
    const [timeLeft, setTimeLeft] = useState(15);

    useEffect(() => {
        if (isVisible) {
            // Start intense alert
            startLoopingRequestAlert();

            setTimeLeft(15);
            const timer = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        onDecline(); // Auto-decline when time runs out
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => {
                clearInterval(timer);
                stopLoopingRequestAlert(); // Stop alert on cleanup/unmount
            };
        } else {
            stopLoopingRequestAlert(); // Stop alert if not visible
        }
    }, [isVisible, onDecline]);

    if (!isVisible || !request) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-6 px-4 bg-black/60 backdrop-blur-sm sm:items-center sm:pb-0">
            <div className="w-full max-w-sm bg-[#0a101f] rounded-3xl p-5 text-white shadow-2xl border border-gray-800 animate-slide-up sm:animate-fade-in relative overflow-hidden">

                {/* Progress Bar background */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
                    <div
                        className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
                        style={{ width: `${(timeLeft / 15) * 100}%` }}
                    />
                </div>

                {/* Header */}
                <div className="flex justify-between items-start mb-6 mt-2">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                            <h2 className="text-2xl font-bold leading-none">Solicitud<br />Nueva</h2>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        {/* Timer visual mimicking the image's top right bar if needed, or just text */}
                        <span className="text-gray-400 text-sm font-medium">{timeLeft}s restantes</span>
                        {/* Creating the visual bar from the image in top right */}
                        <div className="w-24 h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                                style={{ width: `${(timeLeft / 15) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Price */}
                <div className="mb-6">
                    <p className="text-xs text-gray-400 font-semibold tracking-wider uppercase mb-1">TARIFA ESTIMADA</p>
                    <div className="text-5xl font-extrabold tracking-tight">
                        ${Number(request.price).toFixed(2) || '0.00'}
                    </div>
                </div>

                {/* Route Details */}
                <div className="relative pl-4 space-y-8 mb-8">
                    {/* Vertical Line Connector */}
                    <div className="absolute left-[1.35rem] top-3 bottom-8 w-0.5 bg-gray-700"></div>

                    {/* Origin */}
                    <div className="relative flex items-start gap-4">
                        {/* Hollow Circle for Origin */}
                        <div className="w-4 h-4 rounded-full border-2 border-gray-400 bg-[#0a101f] z-10 mt-1 shrink-0"></div>

                        <div className="flex-1">
                            <div className="flex justify-between items-baseline mb-0.5">
                                <span className="text-xs text-gray-400 font-bold tracking-wide uppercase">ORIGEN</span>
                                <span className="text-xs text-gray-500 bg-gray-800/50 px-2 py-0.5 rounded-md">{request.distance || '0 km'}</span>
                            </div>
                            <h3 className="text-lg font-bold truncate leading-tight">{request.pickupLocation || 'Ubicación Actual'}</h3>
                            <p className="text-sm text-gray-500 truncate">{request.pickupAddress || 'Dirección no disponible'}</p>
                        </div>
                    </div>

                    {/* Destination */}
                    <div className="relative flex items-start gap-4">
                        {/* Solid Blue Circle for Destination */}
                        <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-blue-500 z-10 mt-1 shrink-0 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>

                        <div className="flex-1">
                            <div className="flex justify-between items-baseline mb-0.5">
                                <span className="text-xs text-gray-400 font-bold tracking-wide uppercase">DESTINO</span>
                                <span className="text-xs text-gray-500 bg-gray-800/50 px-2 py-0.5 rounded-md">{request.duration || '0 min'}</span>
                            </div>
                            <h3 className="text-lg font-bold truncate leading-tight">{request.dropoffLocation || 'Destino'}</h3>
                            <p className="text-sm text-gray-500 truncate">{request.dropoffAddress || 'Dirección de destino'}</p>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-4">
                    <button
                        onClick={onDecline}
                        className="w-14 h-14 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 transition-colors"
                    >
                        <X size={24} />
                    </button>

                    <button
                        onClick={onAccept}
                        className="flex-1 h-14 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-between px-6 text-white font-bold text-lg shadow-[0_4px_20px_rgba(37,99,235,0.4)] transition-all transform active:scale-95"
                    >
                        <span>Aceptar Viaje</span>
                        <ArrowRight size={24} />
                    </button>
                </div>

            </div>
        </div>
    );
};

export default DriverRequestCard;
