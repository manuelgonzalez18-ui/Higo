import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import InteractiveMap from '../components/InteractiveMap';

import { supabase } from '../services/supabase';



const ConfirmTripPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const VEHICLE_INFO = {
        moto: {
            title: 'Higo Moto',
            icon: 'two_wheeler',
            seats: '1 asiento'
        },
        standard: {
            title: 'Higo Carro',
            icon: 'local_taxi',
            seats: '4 asientos'
        },
        van: {
            title: 'Higo Camioneta',
            icon: 'airport_shuttle',
            seats: '6+ asientos'
        }
    };
    // Safe destructure with defaults
    const {
        pickup, dropoff, price, selectedRide,
        pickupCoords, dropoffCoords, serviceType, deliveryData
    } = location.state || {};

    // Fallback if accessed directly (should guard ideally)
    if (!pickup) return <div className="p-10 text-white">No trip data found. Go back.</div>;

    console.log('ConfirmTripPage State:', { selectedRide, price, pickup, dropoff, serviceType, deliveryData });

    const [loading, setLoading] = useState(false);
    const [passengerPhone, setPassengerPhone] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    // Códigos promocionales: el descuento se aplica vía RPC tras crear el ride.
    const [promoCode, setPromoCode] = useState('');
    const [appliedPromo, setAppliedPromo] = useState(null); // { code, discount, finalPrice }
    const finalPrice = appliedPromo ? appliedPromo.finalPrice : price;

    // Dynamic Vehicle Info with Weight Limits for Delivery
    const getVehicleInfo = () => {
        const base = VEHICLE_INFO[selectedRide] || VEHICLE_INFO['standard'];
        if (serviceType === 'delivery') {
            return {
                ...base,
                seats: selectedRide === 'moto' ? 'Max 4kg' : selectedRide === 'standard' ? 'Max 40kg' : 'Max 100kg',
                // icon: 'action_key' // Removing override to keep vehicle icon
            };
        }
        return base;
    };

    const currentVehicle = getVehicleInfo();

    // Validar código promo localmente (lee promo_codes con RLS — sin escribir).
    // El descuento real se aplica vía RPC apply_promo_code después de crear el ride.
    const validatePromo = async () => {
        const code = promoCode.trim().toUpperCase();
        if (!code) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            alert('Debes iniciar sesión para usar códigos promocionales.');
            return;
        }
        const { data: promo, error } = await supabase
            .from('promo_codes')
            .select('code, discount_type, discount_value, min_ride_amount, expires_at, max_uses, used_count')
            .eq('code', code)
            .eq('active', true)
            .maybeSingle();
        if (error || !promo) {
            setAppliedPromo(null);
            alert('Código inválido o inactivo.');
            return;
        }
        if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
            setAppliedPromo(null);
            alert('El código ha expirado.');
            return;
        }
        if (promo.max_uses != null && promo.used_count >= promo.max_uses) {
            setAppliedPromo(null);
            alert('El código alcanzó su límite de usos.');
            return;
        }
        if (price < (promo.min_ride_amount || 0)) {
            setAppliedPromo(null);
            alert(`El viaje debe ser de al menos $${promo.min_ride_amount}.`);
            return;
        }
        const discount = promo.discount_type === 'percent'
            ? Math.round(price * promo.discount_value) / 100
            : Math.min(promo.discount_value, price);
        setAppliedPromo({
            code: promo.code,
            discount: parseFloat(discount.toFixed(2)),
            finalPrice: parseFloat(Math.max(price - discount, 0).toFixed(2))
        });
    };

    const removePromo = () => {
        setAppliedPromo(null);
        setPromoCode('');
    };

    const handleConfirm = async () => {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            alert("Por favor inicia sesión para confirmar tu viaje.");
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
                    price: finalPrice,  // ya con descuento aplicado si hay promo
                    ride_type: selectedRide,
                    status: 'requested',
                    payment_method: 'direct',
                    passenger_phone: passengerPhone || null,
                    pickup_lat: pickupCoords?.lat || null,
                    pickup_lng: pickupCoords?.lng || null,
                    dropoff_lat: dropoffCoords?.lat || null,
                    dropoff_lng: dropoffCoords?.lng || null,
                    service_type: serviceType || 'ride',
                    delivery_info: deliveryData || null,
                    payer: deliveryData?.payer || 'sender'
                }])
                .select();

            if (error) throw error;

            // Si hay código promo, registrarlo contra el ride recién creado.
            if (data && data[0] && appliedPromo) {
                await supabase.rpc('apply_promo_code', {
                    p_code: appliedPromo.code,
                    p_ride_id: data[0].id,
                    p_user_id: session.user.id,
                    p_ride_amount: price
                });
            }

            if (data && data[0]) {
                navigate(`/ride/${data[0].id}`);
            } else {
                alert("¡Viaje Confirmado! Un conductor va en camino.");
                navigate('/');
            }
        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            setLoading(false);
        }
    };



    return (
        <div className="bg-[#10141F] min-h-screen text-white font-sans overflow-hidden flex flex-col">
            {/* Top Half - Map / Header */}
            <div className="relative w-full h-[45vh] bg-[#2C2F3E] rounded-b-[40px] overflow-hidden shadow-2xl z-10 mx-auto max-w-md md:max-w-full">
                {/* Simulated Map Image */}
                {/* Real Google Map */}
                <InteractiveMap
                    className="w-full h-full"
                    center={pickupCoords}
                    origin={pickupCoords}
                    destination={dropoffCoords}
                />

                {/* Header Overlay */}
                <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
                    <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white/20 transition-all">
                        <span className="material-symbols-outlined text-white">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-bold">{serviceType === 'delivery' ? 'Confirmar Envío' : 'Confirmar Viaje'}</h1>
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
                        <div className="mt-1 w-4 h-4 rounded-full border-2 border-blue-500 shadow-lg"></div>
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
                        <div className="w-16 h-16 flex items-center justify-center">
                            <div className="w-full h-full rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                                <span className="material-symbols-outlined text-3xl text-white">
                                    {currentVehicle.icon}
                                </span>
                            </div>
                        </div>
                        <div>
                            <p className="text-blue-500 text-xs font-bold uppercase mb-0.5">Mejor Precio</p>
                            <h3 className="font-bold text-lg">{currentVehicle.title}</h3>
                            <p className="text-xs text-gray-400 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[10px]">{serviceType === 'delivery' ? 'weight' : 'person'}</span> {currentVehicle.seats} • 5 min lejos
                            </p>
                        </div>
                    </div>
                    <div className="text-right">
                        {appliedPromo ? (
                            <>
                                <p className="text-gray-500 text-sm line-through">${price.toFixed(2)}</p>
                                <p className="text-emerald-400 font-black text-3xl">${finalPrice.toFixed(2)}</p>
                            </>
                        ) : (
                            <p className="text-white font-black text-3xl">${price.toFixed(2)}</p>
                        )}
                        {serviceType === 'delivery' && (
                            <p className="text-[10px] text-gray-500 mt-1">
                                {deliveryData?.payer === 'receiver' ? 'Paga Destinatario' : 'Paga Remitente'}
                            </p>
                        )}
                    </div>
                </div>

                {/* Payment Method - Removed Visa, default cash logic implied or simplified */}
                {/* Simplified to just show total price clearly or nothing specific for now if cash is default */}

                {/* Promo Code */}
                <div>
                    <label className="text-xs font-bold text-gray-400 mb-2 block">Código Promocional <span className="text-gray-600 font-normal">(Opcional)</span></label>
                    {appliedPromo ? (
                        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-2xl px-4 py-3 flex items-center justify-between">
                            <div>
                                <p className="text-emerald-300 font-bold text-sm">{appliedPromo.code}</p>
                                <p className="text-emerald-200/70 text-xs">−${appliedPromo.discount.toFixed(2)} de descuento</p>
                            </div>
                            <button onClick={removePromo} className="text-gray-400 hover:text-white p-2">
                                <span className="material-symbols-outlined text-base">close</span>
                            </button>
                        </div>
                    ) : (
                        <div className="bg-[#1A1F2E] rounded-2xl flex items-center px-2 border border-white/5 focus-within:border-blue-500 transition-colors">
                            <input
                                type="text"
                                placeholder="Ej: HIGUEROTE"
                                className="bg-transparent w-full py-3 px-2 text-white placeholder-gray-600 outline-none uppercase"
                                value={promoCode}
                                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && validatePromo()}
                            />
                            <button
                                onClick={validatePromo}
                                disabled={!promoCode.trim()}
                                className="px-3 py-2 text-sm font-bold text-blue-400 hover:text-blue-300 disabled:text-gray-600"
                            >
                                Aplicar
                            </button>
                        </div>
                    )}
                </div>

                {/* Phone Input */}
                <div>
                    <label className="text-xs font-bold text-gray-400 mb-2 block">Número de Teléfono <span className="text-gray-600 font-normal">(Opcional)</span></label>
                    <div className="bg-[#1A1F2E] rounded-2xl flex items-center px-4 border border-white/5 focus-within:border-blue-500 transition-colors">
                        <input
                            type="tel"
                            placeholder="Ej: 0412-0330315"
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
                    className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-[20px] font-bold text-lg shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all active:scale-95"
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
