import React from 'react';
import StandardIcon from '../assets/car_yellow_cartoon.png';

const ServiceSelection = ({ onSelect }) => {
    return (
        <div className="flex flex-col gap-6 p-6 animate-in fade-in slide-in-from-bottom-8 duration-500">
            <h2 className="text-2xl font-bold text-white mb-2">¿Qué deseas hacer hoy?</h2>

            {/* Viajes Card */}
            <button
                onClick={() => onSelect('ride')}
                className="bg-[#1A1F2E] p-6 rounded-[32px] border border-white/5 hover:border-blue-500/50 transition-all group text-left relative overflow-hidden"
            >
                <div className="absolute right-[-20px] bottom-[-20px] w-32 h-32 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
                <div className="relative z-10">
                    <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-600/20">
                        <span className="material-symbols-outlined text-white text-3xl">local_taxi</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1">Viajar</h3>
                    <p className="text-sm text-gray-400">Solicita un transporte rápido y seguro a tu destino.</p>
                </div>
            </button>

            {/* Envíos Card */}
            <button
                onClick={() => onSelect('delivery')}
                className="bg-[#1A1F2E] p-6 rounded-[32px] border border-white/5 hover:border-emerald-500/50 transition-all group text-left relative overflow-hidden"
            >
                <div className="absolute right-[-20px] bottom-[-20px] w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
                <div className="relative z-10">
                    <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
                        <span className="material-symbols-outlined text-white text-3xl">package_2</span>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1">Higo Envíos</h3>
                    <p className="text-sm text-gray-400">Envía paquetes o documentos de forma segura.</p>
                </div>
            </button>
        </div>
    );
};

export default ServiceSelection;
