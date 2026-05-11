import React from 'react';

const LocationDisclosure = ({ onAccept }) => {
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-[#1A1F2E] w-full max-w-md rounded-[32px] border border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-300">
                <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg shadow-blue-600/10">
                    <span className="material-symbols-outlined text-blue-500 text-4xl">location_on</span>
                </div>

                <h2 className="text-2xl font-bold text-white text-center mb-4">
                    Uso de tu ubicación
                </h2>

                <div className="space-y-4 text-gray-300 text-center leading-relaxed">
                    <p>
                        <span className="text-white font-semibold">Higo App</span> recopila datos de ubicación para permitir:
                    </p>
                    <ul className="text-sm space-y-2 text-left bg-white/5 p-4 rounded-2xl border border-white/5">
                        <li className="flex items-start gap-2">
                            <span className="text-blue-500 font-bold">•</span>
                            <span>Seguimiento del viaje en tiempo real para tu seguridad.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-blue-500 font-bold">•</span>
                            <span>Asignación de conductores cercanos de forma eficiente.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-blue-500 font-bold">•</span>
                            <span>Cálculo preciso de tiempos de llegada y tarifas.</span>
                        </li>
                    </ul>
                    <p className="text-sm italic">
                        Estos datos se recopilan <span className="text-blue-400 font-semibold underline">incluso cuando la aplicación está cerrada o no está en uso</span> para garantizar que el servicio funcione correctamente durante todo el proceso.
                    </p>
                </div>

                <div className="mt-8 space-y-3">
                    <button
                        onClick={onAccept}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98]"
                    >
                        Entendido y Continuar
                    </button>
                    <p className="text-[10px] text-gray-500 text-center">
                        Puedes cambiar esto en cualquier momento desde los ajustes de tu dispositivo.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LocationDisclosure;
