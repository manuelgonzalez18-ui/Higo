import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LocationInput from '../components/LocationInput';

const ScheduleRidePage = () => {
    const navigate = useNavigate();
    const [selectedDay, setSelectedDay] = useState(5);
    const [month, setMonth] = useState('Diciembre 2024');

    return (
        <div className="bg-[#0F1014] font-sans text-white min-h-screen flex flex-col relative overflow-hidden">

            {/* Background Gradients */}
            <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-violet-900/20 to-transparent pointer-events-none"></div>

            {/* Header */}
            <header className="sticky top-0 z-50 w-full bg-[#0F1014]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-7xl mx-auto px-4 md:px-10 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link to="/" className="w-10 h-10 bg-gradient-to-br from-violet-600 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-600/20">
                            <span className="material-symbols-outlined text-white text-2xl">local_taxi</span>
                        </Link>
                        <h2 className="text-xl font-black tracking-tight text-white">HIGO <span className="text-violet-500 font-medium">Schedule</span></h2>
                    </div>
                    <div className="hidden md:flex items-center gap-8 bg-[#1A1F2E] px-6 py-2 rounded-full border border-white/5">
                        <Link to="/" className="text-sm font-bold text-gray-400 hover:text-white transition-colors">Inicio</Link>
                        <span className="text-sm font-bold text-violet-400 cursor-pointer">Agendar</span>
                        <a className="text-sm font-bold text-gray-400 hover:text-white transition-colors" href="#">Mis Viajes</a>
                    </div>
                    <div className="flex items-center gap-4">
                        <button className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center transition-colors text-gray-400 hover:text-white">
                            <span className="material-symbols-outlined">notifications</span>
                        </button>
                        <div className="w-10 h-10 rounded-full p-[2px] bg-gradient-to-br from-violet-500 to-fuchsia-600">
                            <div className="w-full h-full rounded-full bg-[#0F1014] p-0.5">
                                <img src="https://picsum.photos/100" className="w-full h-full rounded-full object-cover" alt="Profile" />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-grow w-full px-4 md:px-10 py-10 mx-auto max-w-7xl relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">

                    {/* LEFT COLUMN - FORM */}
                    <div className="lg:col-span-8 flex flex-col gap-6">
                        <div className="flex flex-col gap-2 mb-2">
                            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white">Agendar Viaje</h1>
                            <p className="text-gray-400 text-lg">Planifica tu traslado en Higuerote con confianza.</p>
                        </div>

                        {/* Date & Time Card */}
                        <div className="bg-[#1A1F2E] rounded-[32px] p-8 shadow-2xl border border-white/5 relative overflow-hidden">
                            {/* Glow */}
                            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/10 rounded-full blur-[80px] pointer-events-none"></div>

                            <div className="flex items-center gap-3 mb-8 relative z-10">
                                <div className="p-3 rounded-xl bg-violet-600/20 text-violet-400">
                                    <span className="material-symbols-outlined">calendar_month</span>
                                </div>
                                <h3 className="text-xl font-bold text-white">Fecha y Hora</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
                                {/* Calendar Section */}
                                <div className="flex flex-col gap-6">
                                    <div className="flex items-center justify-between px-2 bg-[#0F1014] p-2 rounded-xl border border-white/5">
                                        <button className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white">
                                            <span className="material-symbols-outlined text-sm">chevron_left</span>
                                        </button>
                                        <p className="text-base font-bold text-white">{month}</p>
                                        <button className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white">
                                            <span className="material-symbols-outlined text-sm">chevron_right</span>
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-7 text-center gap-y-3">
                                        {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => (
                                            <span key={d} className="text-xs font-bold text-gray-500 py-2">{d}</span>
                                        ))}

                                        {/* Blank spaces for offset */}
                                        <span></span><span></span><span></span>

                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(day => (
                                            <button
                                                key={day}
                                                onClick={() => setSelectedDay(day)}
                                                className={`h-10 w-10 mx-auto flex items-center justify-center rounded-xl text-sm transition-all ${selectedDay === day
                                                        ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white font-bold shadow-lg shadow-violet-600/30 ring-2 ring-violet-400/50'
                                                        : 'text-gray-300 hover:bg-white/10'
                                                    }`}
                                            >
                                                {day}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Time & Vehicle Section */}
                                <div className="flex flex-col justify-between gap-6">
                                    <div className="p-5 bg-[#0F1014] rounded-2xl border border-white/5 space-y-4">
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Hora de Recogida</span>
                                        <div className="flex gap-2 items-center">
                                            <select className="flex-1 bg-[#1A1F2E] text-white border border-white/10 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:border-violet-500 transition-colors appearance-none text-center">
                                                <option>08</option><option>09</option><option defaultValue="10">10</option><option>11</option>
                                            </select>
                                            <span className="text-2xl font-black text-gray-600">:</span>
                                            <select className="flex-1 bg-[#1A1F2E] text-white border border-white/10 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:border-violet-500 transition-colors appearance-none text-center">
                                                <option>00</option><option>15</option><option defaultValue="30">30</option><option>45</option>
                                            </select>
                                            <div className="flex bg-[#1A1F2E] rounded-xl border border-white/10 p-1">
                                                <button className="px-3 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white shadow-lg">AM</button>
                                                <button className="px-3 py-2 rounded-lg text-xs font-bold text-gray-500 hover:text-white transition-colors">PM</button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Tipo de Vehículo</span>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-violet-500 bg-violet-500/10 transition-all relative overflow-hidden group">
                                                <span className="material-symbols-outlined text-violet-400 mb-1 text-2xl group-hover:scale-110 transition-transform">local_taxi</span>
                                                <span className="text-xs font-bold text-white">Standard</span>
                                                <div className="absolute inset-0 bg-violet-500/5 group-hover:bg-violet-500/10 transition-colors"></div>
                                            </button>
                                            <button className="flex flex-col items-center justify-center p-4 rounded-2xl border border-white/5 bg-[#0F1014] hover:bg-white/5 transition-all group">
                                                <span className="material-symbols-outlined text-gray-400 mb-1 text-2xl group-hover:text-white transition-colors">airport_shuttle</span>
                                                <span className="text-xs font-bold text-gray-400 group-hover:text-white transition-colors">Van</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Route Details Card */}
                        <div className="bg-[#1A1F2E] rounded-[32px] p-8 shadow-xl border border-white/5">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="p-3 rounded-xl bg-fuchsia-600/20 text-fuchsia-400">
                                    <span className="material-symbols-outlined">location_on</span>
                                </div>
                                <h3 className="text-xl font-bold text-white">Detalles de la Ruta</h3>
                            </div>
                            <div className="relative flex flex-col gap-6 pl-4">
                                <div className="absolute left-[31px] top-[45px] bottom-[45px] w-[2px] bg-gradient-to-b from-violet-500/50 to-fuchsia-500/50 z-0"></div>

                                <div className="relative z-10 w-full">
                                    <LocationInput
                                        placeholder="Punto de partida"
                                        defaultValue="Hotel Higuerote Suites"
                                        icon="my_location"
                                        iconColor="text-violet-400 shadow-[0_0_10px_purple]"
                                        showConnector={false}
                                    />
                                </div>
                                <div className="relative z-10 w-full">
                                    <LocationInput
                                        placeholder="Destino"
                                        icon="location_on"
                                        iconColor="text-fuchsia-500 shadow-[0_0_10px_magenta]"
                                        showConnector={false}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN - SUMMARY */}
                    <div className="lg:col-span-4">
                        <div className="sticky top-24 flex flex-col gap-6">
                            <div className="bg-[#1A1F2E] rounded-[32px] shadow-2xl border border-white/5 overflow-hidden flex flex-col">

                                {/* Map Preview */}
                                <div className="h-56 w-full bg-[#0F1014] relative group cursor-pointer overflow-hidden">
                                    <img src="https://picsum.photos/800/600?grayscale" className="w-full h-full object-cover opacity-50 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500" alt="Map" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-[#1A1F2E] to-transparent"></div>

                                    {/* Stats Pill */}
                                    <div className="absolute bottom-4 left-4 right-4 bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/10 flex justify-between items-center z-10">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-violet-400 text-sm">schedule</span>
                                            <span className="text-sm font-bold text-white">15 min</span>
                                        </div>
                                        <div className="w-[1px] h-4 bg-white/20"></div>
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-fuchsia-400 text-sm">straighten</span>
                                            <span className="text-sm font-bold text-white">4.2 km</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-8 flex flex-col gap-6">
                                    <div className="flex justify-between items-end border-b border-white/5 pb-6">
                                        <div>
                                            <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Total Estimado</p>
                                            <h2 className="text-3xl font-black text-white">$12.50</h2>
                                        </div>
                                        <span className="bg-violet-500/20 text-violet-300 px-3 py-1 rounded-lg text-xs font-bold border border-violet-500/30">Standard</span>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center text-sm">
                                            <div className="flex items-center gap-3 text-gray-400">
                                                <span className="material-symbols-outlined text-lg">calendar_today</span>
                                                <span className="font-medium">Fecha</span>
                                            </div>
                                            <span className="font-bold text-white text-right">5 Dic, 2024</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <div className="flex items-center gap-3 text-gray-400">
                                                <span className="material-symbols-outlined text-lg">schedule</span>
                                                <span className="font-medium">Hora</span>
                                            </div>
                                            <span className="font-bold text-white text-right">10:30 AM</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 bg-[#0F1014] p-4 rounded-xl border border-white/5">
                                        <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-violet-900/40 border border-violet-500/30">
                                            <input id="reminder-toggle" type="checkbox" className="peer sr-only" defaultChecked />
                                            <div className="absolute left-1 h-4 w-4 rounded-full bg-white transition-all peer-checked:left-6 peer-checked:bg-violet-400 shadow-sm"></div>
                                        </div>
                                        <label htmlFor="reminder-toggle" className="cursor-pointer select-none text-sm font-bold text-gray-300">Recordatorio (1h antes)</label>
                                    </div>

                                    <button
                                        onClick={() => navigate('/confirm')}
                                        className="mt-2 w-full bg-gradient-to-r from-violet-600 to-[#A855F7] hover:to-fuchsia-500 text-white font-bold text-lg py-4 rounded-xl shadow-lg shadow-violet-600/25 transition-all transform hover:-translate-y-1 active:scale-[0.98] flex items-center justify-center gap-2 group"
                                    >
                                        <span>Agendar Viaje</span>
                                        <span className="material-symbols-outlined text-[24px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
                                    </button>

                                    <div className="flex items-center justify-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-wider text-center mt-2">
                                        <span className="material-symbols-outlined text-[14px] text-emerald-500">verified_user</span>
                                        <span>Conductores Verificados • Viaje Seguro</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ScheduleRidePage;
