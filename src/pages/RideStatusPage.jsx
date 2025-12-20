import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

const RideStatusPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [ride, setRide] = useState(null);
    const [driver, setDriver] = useState(null);
    const [rating, setRating] = useState(0);
    const [feedback, setFeedback] = useState("");
    const [submitted, setSubmitted] = useState(false);

    const [showDriverDetails, setShowDriverDetails] = useState(true);

    useEffect(() => {
        fetchRide();

        const channel = supabase
            .channel(`ride:${id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${id}` }, async (payload) => {
                setRide(payload.new);
                if (payload.new.driver_id) {
                    const { data } = await supabase.from('profiles').select('*').eq('id', payload.new.driver_id).single();
                    if (data) setDriver(data);
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [id]);

    const fetchRide = async () => {
        const { data, error } = await supabase.from('rides').select('*').eq('id', id).single();
        if (data) {
            setRide(data);
            if (data.driver_id) {
                const { data: driverData } = await supabase.from('profiles').select('*').eq('id', data.driver_id).single();
                if (driverData) setDriver(driverData);
            }
        }
    };

    const submitRating = async () => {
        const { error } = await supabase
            .from('rides')
            .update({ rating: rating, feedback: feedback })
            .eq('id', id);

        if (!error) {
            setSubmitted(true);
            setTimeout(() => navigate('/'), 2000);
        }
    };

    if (!ride) return <div className="h-screen flex items-center justify-center bg-[#0F1014] text-white">Loading...</div>;

    return (
        <div className="h-screen bg-[#0F1014] relative overflow-hidden font-sans text-white">

            {/* Map Grid Background (CSS Grid simulation) */}
            <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: 'linear-gradient(#2c2f3e 1px, transparent 1px), linear-gradient(90deg, #2c2f3e 1px, transparent 1px)',
                backgroundSize: '40px 40px'
            }}></div>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0F1014]/90 pointer-events-none"></div>

            {/* Top Bar */}
            <div className="absolute top-6 left-6 right-6 z-20 flex justify-between items-start">
                <button onClick={() => navigate(-1)} className="w-12 h-12 bg-[#1A1E29] border border-white/5 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                    <span className="material-symbols-outlined text-white">arrow_back</span>
                </button>

                {/* Status Pill */}
                {ride.status !== 'completed' && (
                    <div className="bg-[#1A1E29]/90 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl flex gap-6 shadow-xl">
                        <div className="text-center">
                            <p className="text-[10px] text-[#A855F7] font-bold uppercase tracking-wider">EN VIAJE</p>
                            <p className="font-bold text-lg">12 min</p>
                        </div>
                        <div className="w-px bg-white/10"></div>
                        <div className="text-center">
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">LLEGADA</p>
                            <p className="font-bold text-lg">10:45 PM</p>
                        </div>
                    </div>
                )}

                <button className="w-12 h-12 bg-[#EF4444] rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 animate-pulse active:scale-95 transition-transform">
                    <span className="material-symbols-outlined text-white">shield</span>
                </button>
            </div>

            {/* Map placeholders (Pin, Route) - Simulated */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <div className="bg-[#1A1E29] px-3 py-1 rounded-full border border-white/10 text-xs font-bold mb-2">Casa <span className="text-gray-500">10:45 PM</span></div>
                <div className="w-4 h-4 rounded-full bg-white border-4 border-[#A855F7]"></div>
                <div className="h-40 w-1 bg-gradient-to-b from-[#A855F7] to-transparent opacity-80 rounded-full blur-[1px]"></div>
                {/* Car Icon */}
                <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.3)] z-10 mt-[-10px]">
                    <span className="material-symbols-outlined text-black text-2xl">local_taxi</span>
                </div>
            </div>


            {/* Bottom Sheet - Driver Details */}
            <div className={`absolute bottom-0 left-0 right-0 bg-[#1A1F2E] rounded-t-[32px] p-6 pb-8 transition-transform duration-300 z-30 ${showDriverDetails ? 'translate-y-0' : 'translate-y-[85%]'}`}>

                {/* Drag Handle */}
                <div className="w-12 h-1.5 bg-gray-600/50 rounded-full mx-auto mb-6 cursor-pointer" onClick={() => setShowDriverDetails(!showDriverDetails)}></div>

                {/* Driver Info Header */}
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full bg-gray-700 bg-center bg-cover border-2 border-white/10"
                            style={{ backgroundImage: `url('${driver?.avatar_url || "https://picsum.photos/200"}')` }}>
                        </div>
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-[#1A1E29] border border-white/10 px-2 py-0.5 rounded-full flex items-center gap-1 text-[10px]">
                            <span className="text-yellow-400 text-xs">★</span> 4.9
                        </div>
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-white">{driver?.full_name || "Buscando conductor..."}</h2>
                        <p className="text-gray-400 text-sm">{driver?.vehicle_brand ? driver.vehicle_brand + ' ' : ''}{driver?.vehicle_model || "Vehículo estándar"} • {driver?.vehicle_color || "Color"}</p>
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="px-3 py-1.5 rounded-xl border border-white/10 bg-[#252A3A] text-center">
                            <p className="text-[9px] text-gray-400 uppercase font-bold text-center">PLACA</p>
                            <p className="font-mono font-bold text-white tracking-widest leading-none mt-0.5">{driver?.license_plate || "---"}</p>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                {driver && (
                    <div className="flex gap-4">
                        {driver.phone && (
                            <button onClick={() => window.location.href = `tel:${driver.phone}`} className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-[#8B5CF6]/20 flex items-center justify-center gap-2 active:scale-95 transition-all">
                                <span className="material-symbols-outlined">call</span>
                                Llamar al Conductor
                            </button>
                        )}
                        <button className="w-14 bg-[#252A3A] hover:bg-[#2C3345] rounded-2xl flex items-center justify-center border border-white/5 active:scale-95 transition-all">
                            <span className="material-symbols-outlined text-white">chat_bubble</span>
                        </button>
                    </div>
                )}

                {/* Ride Stats or Rating if Completed */}
                {ride.status === 'completed' && !submitted && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                        <h3 className="text-center font-bold mb-4">Califica tu viaje</h3>
                        <div className="flex justify-center gap-4 mb-4">
                            {[1, 2, 3, 4, 5].map(star => (
                                <button key={star} onClick={() => setRating(star)} className={`text-3xl ${star <= rating ? 'text-yellow-400' : 'text-gray-600'}`}>★</button>
                            ))}
                        </div>
                        <button onClick={submitRating} className="w-full bg-white text-black py-3 rounded-xl font-bold">Enviar Calificación</button>
                    </div>
                )}

                {/* Bottom Actions Bar */}
                <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/5">
                    <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">share</span></div>
                        <span className="text-[10px]">Compartir</span>
                    </button>
                    <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">location_on</span></div>
                        <span className="text-[10px]">Destino</span>
                    </button>
                    <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">security</span></div>
                        <span className="text-[10px]">Seguridad</span>
                    </button>
                    <button className="flex flex-col items-center gap-1 text-red-400 hover:text-red-300 transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">close</span></div>
                        <span className="text-[10px]">Cancelar</span>
                    </button>
                </div>

            </div>
        </div>
    );
};

export default RideStatusPage;
