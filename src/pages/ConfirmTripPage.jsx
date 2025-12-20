import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

import { supabase } from '../services/supabase';

const ConfirmTripPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {
        selectedRide = 'standard',
        price = 12.50,
        pickup = "Club Puerto Azul",
        dropoff = "Playa Los Totumos",
        pickupCoords = null,
        dropoffCoords = null
    } = location.state || {};
    const [loading, setLoading] = useState(false);
    const [passengerPhone, setPassengerPhone] = useState(''); // New state for phone

    const handleConfirm = async () => {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            alert("Please login to confirm your trip.");
            navigate('/auth');
            return;
        }

        try {
            const { data, error } = await supabase
                .from('rides')
                .insert([{
                    user_id: session.user.id,
                    pickup: pickup,
                    dropoff: dropoff,
                    price: price,
                    ride_type: selectedRide,
                    status: 'requested',
                    payment_method: 'direct',
                    passenger_phone: passengerPhone || null,
                    // Smart Assignment: Save Coords
                    pickup_lat: pickupCoords?.lat || null,
                    pickup_lng: pickupCoords?.lng || null
                }])
                .select(); // Return inserted data

            if (error) throw error;

            // Navigate to tracking page with the new ride ID
            if (data && data[0]) {
                navigate(`/ride/${data[0].id}`);
            } else {
                alert("Trip Confirmed! A driver is on their way.");
                navigate('/');
            }
        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
    const [paymentMethod, setPaymentMethod] = useState('card'); // 'card' or 'cash'

    return (
        <div className="bg-[#10141F] min-h-screen text-white font-sans overflow-hidden flex flex-col">
            {/* Top Half - Map / Header */}
            <div className="relative w-full h-[45vh] bg-[#2C2F3E] rounded-b-[40px] overflow-hidden shadow-2xl z-10 mx-auto max-w-md md:max-w-full">
                {/* Simulated Map Image */}
                <img
                    src="https://picsum.photos/seed/map/800/600?grayscale"
                    alt="Map"
                    className="w-full h-full object-cover opacity-60 mix-blend-overlay"
                />

                {/* Header Overlay */}
                <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
                    <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white/20 transition-all">
                        <span className="material-symbols-outlined text-white">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-bold">Confirmar Viaje</h1>
                    <div className="w-10"></div>
                </div>

                {/* Route Visualizer on Map */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xs md:max-w-md px-6">
                    {/* Simulated Route Line not easily drawn in CSS only, but markers can be placed */}
                </div>
            </div>

            {/* Bottom Half - Details */}
            <div className="flex-1 -mt-6 pt-10 px-6 pb-6 w-full max-w-md mx-auto flex flex-col gap-6">

                {/* Route Points */}
                <div className="flex flex-col gap-6 relative pl-3">
                    {/* Dashed Line */}
                    <div className="absolute left-[19px] top-3 bottom-8 w-0.5 bg-gray-700 border-l border-dashed border-gray-500"></div>

                    {/* Pickup */}
                    <div className="flex items-start gap-4 z-10">
                        <div className="mt-1 w-4 h-4 rounded-full border-2 border-[#A855F7] shadow-[0_0_10px_#A855F7]"></div>
                        <div>
                            <p className="text-xs text-gray-400 font-bold tracking-wider mb-1">RECOGIDA</p>
                            <h3 className="text-lg font-bold text-white leading-tight">{pickup}</h3>
                        </div>
                    </div>

                    {/* Dropoff */}
                    <div className="flex items-start gap-4 z-10">
                        <div className="mt-1 w-4 h-4 rounded-full bg-[#EF4444] shadow-[0_0_10px_#EF4444] border-2 border-white/10"></div>
                        <div>
                            <p className="text-xs text-gray-400 font-bold tracking-wider mb-1">DESTINO</p>
                            <h3 className="text-lg font-bold text-white leading-tight">{dropoff}</h3>
                        </div>
                    </div>
                </div>

                {/* Car Selection Card */}
                <div className="bg-[#1A1F2E] p-4 rounded-3xl border border-white/5 flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-white text-2xl">local_taxi</span>
                        </div>
                        <div>
                            <p className="text-[#A855F7] text-xs font-bold uppercase mb-0.5">Mejor Precio</p>
                            <h3 className="font-bold text-lg">Higo Estándar</h3>
                            <p className="text-xs text-gray-400 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[10px]">person</span> 4 asientos • 5 min lejos
                            </p>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="w-10 h-8 mb-1 ml-auto bg-contain bg-no-repeat bg-center" style={{ backgroundImage: 'url(https://cdn-icons-png.flaticon.com/512/3097/3097180.png)' }}></div>
                        <p className="text-[#A855F7] font-bold text-xl">${price.toFixed(2)}</p>
                    </div>
                </div>

                {/* Payment Method */}
                <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-6 bg-gray-700 rounded flex items-center justify-center text-[10px] font-bold text-gray-300">
                            VISA
                        </div>
                        <div>
                            <p className="font-bold text-sm">Visa terminada en 4242</p>
                            <p className="text-xs text-gray-500">Personal</p>
                        </div>
                    </div>
                    <button className="text-[#A855F7] text-sm font-bold hover:text-white transition-colors">Cambiar</button>
                </div>

                {/* Phone Input */}
                <div>
                    <label className="text-xs font-bold text-gray-400 mb-2 block">Número de Teléfono <span className="text-gray-600 font-normal">(Opcional)</span></label>
                    <div className="bg-[#1A1F2E] rounded-2xl flex items-center px-4 border border-white/5 focus-within:border-[#A855F7] transition-colors">
                        <input
                            type="tel"
                            placeholder="+58 (___) ___-____"
                            className="bg-transparent w-full py-4 text-white placeholder-gray-600 outline-none"
                            value={passengerPhone}
                            onChange={(e) => setPassengerPhone(e.target.value)}
                        />
                        <span className="material-symbols-outlined text-gray-500">phone</span>
                    </div>
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={loading}
                    className="mt-auto w-full bg-[#7C3AED] hover:bg-[#6D28D9] text-white py-4 rounded-[20px] font-bold text-lg shadow-lg shadow-[#7C3AED]/30 flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                    {loading ? 'Confirmando...' : (
                        <>
                            <span>Confirmar Solicitud</span>
                            <span className="material-symbols-outlined">arrow_forward</span>
                        </>
                    )}
                </button>

            </div>
        </div>
    );
};

export default ConfirmTripPage;
