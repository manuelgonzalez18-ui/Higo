import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LocationInput from '../components/LocationInput';
import InteractiveMap from '../components/InteractiveMap';
import { supabase } from '../services/supabase';
import { useGeolocation } from '../hooks/useGeolocation';

import ServiceSelection from '../components/ServiceSelection';
import DeliveryFormSteps from '../components/DeliveryFormSteps';
import ProhibitedItemsModal from '../components/ProhibitedItemsModal';


const RequestRidePage = () => {
    const navigate = useNavigate();
    const { location: userLocation } = useGeolocation();

    const [selectedRide, setSelectedRide] = useState('standard');
    const [pickup, setPickup] = useState("Ubicación Actual");
    const [pickupCoords, setPickupCoords] = useState(null); // {lat, lng}
    const [dropoff, setDropoff] = useState("");
    const [dropoffCoords, setDropoffCoords] = useState(null); // {lat, lng}
    const [stops, setStops] = useState([]); // Array of objects {id, address, coords}
    const [price, setPrice] = useState(0);
    const [oldPrice, setOldPrice] = useState(0);
    const [roadDistance, setRoadDistance] = useState(0); // Store actual road distance in meters
    const [showStopConfirm, setShowStopConfirm] = useState(false);
    const [hasPendingStopConfirm, setHasPendingStopConfirm] = useState(false);

    // NEW STATES FOR HIGO ENVÍOS
    const [serviceType, setServiceType] = useState(null); // 'ride' | 'delivery'
    const [showProhibitedModal, setShowProhibitedModal] = useState(false);
    const [showDeliveryForm, setShowDeliveryForm] = useState(false);
    const [deliveryData, setDeliveryData] = useState(null);
    const [withinCoverage, setWithinCoverage] = useState(true);

    // Auto-set pickup to user location once found
    useEffect(() => {
        if (userLocation && pickup === "Ubicación Actual") {
            setPickupCoords(userLocation);
        }
    }, [userLocation, pickup]);

    // Verificar cobertura cuando se conoce la ubicación del usuario
    useEffect(() => {
        if (!userLocation?.lat || !userLocation?.lng) return;
        supabase.rpc('is_within_coverage', { p_lat: userLocation.lat, p_lng: userLocation.lng })
            .then(({ data }) => { if (data !== null) setWithinCoverage(data); });
    }, [userLocation]);

    // Add a new empty stop
    const handleAddStop = () => {
        const newStop = { id: Date.now(), address: '', coords: null };
        setStops([...stops, newStop]);
    };

    // Remove a stop
    const handleRemoveStop = (id) => {
        const newStops = stops.filter(s => s.id !== id);
        setStops(newStops);
        // Force recalc price
        // The new pricing useEffect will handle this automatically
    };

    // Update a stop's data
    const handleUpdateStop = (id, name, place) => {
        const newStops = stops.map(s => {
            if (s.id === id) {
                const updatedStop = { ...s, address: name };
                if (place && place.lat && place.lng) {
                    updatedStop.coords = { lat: place.lat, lng: place.lng };
                    setHasPendingStopConfirm(true); // Trigger confirmation modal
                }
                return updatedStop;
            }
            return s;
        });
        setStops(newStops);
    };

    // Vehicle Rates: viven en DB (tabla pricing_config), editables desde /admin/pricing.
    // Fallback a estos valores si la query falla (primer render o error de red).
    const FALLBACK_RATES = {
        moto:     { base: 1.00, perKm: 0.25, deliveryFee: 0.50, waitPerMin: 0.05, stopFee: 0.50 },
        standard: { base: 1.50, perKm: 0.40, deliveryFee: 1.50, waitPerMin: 0.08, stopFee: 1.00 },
        van:      { base: 1.70, perKm: 0.60, deliveryFee: 2.00, waitPerMin: 0.10, stopFee: 1.00 }
    };
    const [VEHICLE_RATES, setVehicleRates] = useState(FALLBACK_RATES);
    const FREE_WAIT_MINUTES = 3;
    const INCLUDED_KM = 1;

    useEffect(() => {
        (async () => {
            const { data, error } = await supabase.from('pricing_config').select('*');
            if (error || !data?.length) return;
            const rates = {};
            for (const r of data) {
                rates[r.vehicle_type] = {
                    base: Number(r.base),
                    perKm: Number(r.per_km),
                    deliveryFee: Number(r.delivery_fee),
                    waitPerMin: Number(r.wait_per_min),
                    stopFee: Number(r.stop_fee)
                };
            }
            setVehicleRates(prev => ({ ...prev, ...rates }));
        })();
    }, []);

    // Haversine Formula for Distance
    const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
        const R = 6371; // Radius of the earth in km
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d;
    };

    // Calculate Price with Stops
    // This useEffect replaces the previous calculatePrice and recalculatePrice functions
    useEffect(() => {
        if (!pickupCoords || !dropoffCoords) {
            // If no valid route, set price to base for selected ride type or 0
            setPrice(VEHICLE_RATES[selectedRide]?.base || 0);
            setOldPrice(0); // Reset old price
            return;
        }

        // Calculate total distance including stops
        let totalDistanceKm = 0;
        let currentPath = [pickupCoords, ...stops.filter(s => s.coords).map(s => s.coords), dropoffCoords];

        for (let i = 0; i < currentPath.length - 1; i++) {
            totalDistanceKm += getDistanceFromLatLonInKm(
                currentPath[i].lat, currentPath[i].lng,
                currentPath[i + 1].lat, currentPath[i + 1].lng
            );
        }

        // Use roadDistance if available and more accurate for the main leg
        // This logic needs to be refined if roadDistance is for the whole route including stops
        // For now, let's assume roadDistance is for pickup to dropoff without stops, or the full route if map provides it.
        // If roadDistance is for the full route, it should be used directly.
        // If roadDistance is only for pickup-dropoff, then stop distances need to be added.
        // For simplicity, let's use the Haversine totalDistanceKm for now, and roadDistance can be integrated later if it provides a full route.
        const distKm = roadDistance > 0 ? (roadDistance / 1000) : totalDistanceKm;


        // Pricing Logic based on selectedRide (type)
        const type = selectedRide; // Use selectedRide from state
        const rates = VEHICLE_RATES[type];
        const basePrice = rates.base;
        const perKm = rates.perKm;
        const serviceFee = serviceType === 'delivery' ? rates.deliveryFee : 0;

        // Add additional stops cost (leído desde pricing_config, fallback 1.0)
        const validStopsCount = stops.filter(s => s.coords).length;
        const stopFee = rates.stopFee ?? (type === 'moto' ? 0.50 : 1.00);
        const stopsCost = validStopsCount * stopFee;

        let calculated = basePrice + (Math.max(0, distKm - INCLUDED_KM) * perKm) + stopsCost + serviceFee;

        // Minimum is the base price
        if (calculated < basePrice) calculated = basePrice;

        setPrice(parseFloat(calculated.toFixed(2)));

        // Calculate old price (without stops) for comparison in modal
        if (validStopsCount > 0) {
            const baseDistNoStops = roadDistance > 0 ? (roadDistance / 1000) : getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
            let oldCalculated = basePrice + (Math.max(0, baseDistNoStops - INCLUDED_KM) * perKm) + serviceFee;
            if (oldCalculated < basePrice) oldCalculated = basePrice;
            setOldPrice(parseFloat(oldCalculated.toFixed(2)));
        } else {
            setOldPrice(0); // No stops, so no "old price" to compare
        }

    }, [pickupCoords, dropoffCoords, selectedRide, stops, serviceType, roadDistance, VEHICLE_RATES]);


    // Check if we should show the "Confirm Stop" modal
    React.useEffect(() => {
        if (hasPendingStopConfirm && !showStopConfirm) {
            setShowStopConfirm(true);
        }
    }, [hasPendingStopConfirm, showStopConfirm]);

    const handleRequestRide = async () => {
        if (!pickup || !dropoff) {
            alert('Por favor selecciona origen y destino');
            return;
        }

        if (serviceType === 'delivery') {
            // Start delivery flow: Show prohibited items first
            setShowProhibitedModal(true);
        } else {
            // Normal ride flow
            navigate('/confirm', {
                state: {
                    pickup, dropoff, price, selectedRide, pickupCoords, dropoffCoords,
                    serviceType: 'ride'
                }
            });
        }
    };

    const handleDeliveryConfirm = (data) => {
        setShowDeliveryForm(false);
        setDeliveryData(data);

        // Final Navigate for Delivery
        navigate('/confirm', {
            state: {
                pickup,
                dropoff,
                price,
                selectedRide,
                pickupCoords,
                dropoffCoords,
                serviceType: 'delivery',
                deliveryData: data,
                stops // Pass stops to confirm page
            }
        });
    };

    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setCurrentUser(user);
        };
        checkUser();
    }, []);

    // Start Auth Check on Profile Click
    const handleProfileClick = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            // Check role
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
            if (profile?.role === 'driver') {
                navigate('/driver');
            } else {
                // Logout logic for passenger
                if (window.confirm("¿Deseas cerrar sesión?")) {
                    await supabase.auth.signOut();
                    setCurrentUser(null);
                    navigate('/auth');
                }
            }
        } else {
            navigate('/auth');
        }
    };

    return (
        <div className="h-screen w-full relative bg-[#020617] text-white overflow-hidden font-sans">

            {/* BACKGROUND MAP */}
            <div className="absolute inset-0 z-0">
                <InteractiveMap
                    className="w-full h-full"
                    center={pickupCoords || userLocation}
                    origin={pickupCoords}
                    destination={dropoffCoords}
                    markersProp={stops}
                    onRouteData={(data) => {
                        if (data?.distance?.value) setRoadDistance(data.distance.value);
                    }}
                />
                {/* Overlay Gradients */}
                <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-[#0F1014] via-[#0F1014]/90 to-transparent pointer-events-none"></div>
                <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-none"></div>
            </div>

            {/* HEADER - Transparent */}
            <header className="absolute top-0 left-0 right-0 z-20 px-6 py-4 flex items-center justify-between">
                {/* Header / Back Button / Service Title */}
                <div className="flex items-center gap-4 relative z-10">
                    {/* Back logic: If selecting service, back to null? Or back to home? */}
                    {/* If in main flow, back to service selection if needed */}
                    <button
                        onClick={() => serviceType ? setServiceType(null) : navigate('/')}
                        className="w-10 h-10 rounded-full bg-[#1A1F2E]/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg active:scale-95 transition-transform"
                    >
                        <span className="material-symbols-outlined text-white">arrow_back</span>
                    </button>
                    <div className="flex flex-col">
                        <h1 className="text-xl font-bold text-white">
                            {serviceType === 'delivery' ? 'Higo Envíos' : 'Solicitar Viaje'}
                        </h1>
                    </div>
                </div>

                {/* Profile Pill */}
                <div onClick={handleProfileClick} className="bg-[#1A1F2E]/80 backdrop-blur-md rounded-full pl-1 pr-4 py-1 flex items-center gap-2 border border-white/10 shadow-lg cursor-pointer hover:bg-[#252A3A] transition-colors max-w-[60%]">
                    <div className="w-8 h-8 rounded-full bg-blue-600 p-[1px] flex-shrink-0">
                        <div className="w-full h-full rounded-full bg-black/50 overflow-hidden">
                            <img src={currentUser ? `https://ui-avatars.com/api/?name=${currentUser.email}&background=random` : "https://picsum.photos/100"} className="w-full h-full object-cover" alt="Profile" />
                        </div>
                    </div>
                    <span className="font-bold text-sm truncate">{currentUser ? "Mi Perfil" : "Iniciar Sesión"}</span>
                </div>
            </header>

            {/* MAIN CONTENT - Floating Bottom Panel */}
            <main className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-8 px-4 sm:px-0 pointer-events-none">

                <div className="w-full max-w-md pointer-events-auto">
                    {!withinCoverage && (
                        <div className="mb-3 bg-amber-500/10 border border-amber-500/40 rounded-2xl px-4 py-3 flex items-center gap-3 text-amber-300 text-sm">
                            <span className="material-symbols-outlined text-amber-400 text-base shrink-0">location_off</span>
                            Tu ubicación está fuera de las zonas de cobertura de Higo.
                        </div>
                    )}
                    {!serviceType ? (
                        <ServiceSelection onSelect={setServiceType} />
                    ) : (
                        <>

                            {/* Floating Title (Optional branding) */}
                            <div className="mb-6 invisible h-0">
                                {/* Branding removed as per user request */}
                            </div>

                            {/* GLASS CARD FORM */}
                            <div className="bg-[#1A1F2E] rounded-[32px] p-2 shadow-2xl border border-white/5 relative overflow-hidden">

                                {/* Decorative blurred glow */}
                                <div className="absolute -top-20 -left-20 w-40 h-40 bg-blue-600/10 rounded-full blur-[50px] pointer-events-none"></div>

                                <div className="p-4 space-y-4 relative z-10">

                                    {/* Inputs Group */}
                                    <div className="space-y-3 bg-[#0F1014]/50 p-2 rounded-2xl border border-white/5">
                                        <LocationInput
                                            placeholder="Punto de partida"
                                            defaultValue="Ubicación Actual"
                                            icon="my_location"
                                            iconColor="text-blue-500"
                                            showConnector={true}
                                            onChange={(name, place) => {
                                                setPickup(name);
                                                if (place && place.lat && place.lng) {
                                                    setPickupCoords({ lat: place.lat, lng: place.lng });
                                                    setRoadDistance(0);
                                                }
                                            }}
                                            onMapClick={() => { /* Not implemented yet */ }}
                                        />

                                        {/* Render Stops */}
                                        {stops.map((stop, index) => (
                                            <div key={stop.id} className="relative flex items-center">
                                                <div className="flex-1">
                                                    <LocationInput
                                                        placeholder="Agrega una parada"
                                                        defaultValue={stop.address}
                                                        icon="location_on" // different icon for stop?
                                                        iconColor="text-amber-400"
                                                        showConnector={true}
                                                        onChange={(name, place) => handleUpdateStop(stop.id, name, place)}
                                                        onMapClick={() => { /* Handle map click for this stop ID */ }}
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveStop(stop.id)}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-500 p-2"
                                                >
                                                    <span className="material-symbols-outlined text-sm">close</span>
                                                </button>
                                            </div>
                                        ))}

                                        {/* Add Stop Button */}
                                        {stops.length === 0 && (
                                            <button
                                                onClick={handleAddStop}
                                                className="w-full py-2 flex items-center justify-center gap-2 text-sm font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-xl transition-colors border border-dashed border-blue-500/30"
                                            >
                                                <span className="material-symbols-outlined text--[18px]">add_circle</span>
                                                <span>Agregar parada</span>
                                            </button>
                                        )}

                                        <LocationInput
                                            placeholder={serviceType === 'delivery' ? "Destino del Envío" : "¿A dónde vas?"}
                                            defaultValue={dropoff}
                                            icon="location_on"
                                            iconColor="text-blue-500"
                                            isLast={true}
                                            onChange={(name, place) => {
                                                setDropoff(name);
                                                if (place && place.lat && place.lng) {
                                                    setDropoffCoords({ lat: place.lat, lng: place.lng });
                                                    setRoadDistance(0); // Reset road distance to force recalculation for new destination
                                                }
                                            }}
                                            onMapClick={() => { /* Not implemented yet */ }}
                                        />
                                    </div>

                                    {/* Ride Selector (Prices) */}
                                    <div className="flex gap-2">
                                        {Object.keys(VEHICLE_RATES).map((type) => (
                                            <button
                                                key={type}
                                                onClick={() => setSelectedRide(type)}
                                                className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${selectedRide === type ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/20' : 'bg-[#0F1014] border-white/5 hover:bg-[#1E293B]'}`}
                                            >
                                                <span className="material-symbols-outlined text-xl mb-1">{type === 'moto' ? 'two_wheeler' : type === 'van' ? 'airport_shuttle' : 'local_taxi'}</span>
                                                <span className="text-[10px] font-bold uppercase">{type === 'van' ? 'Camioneta' : type === 'standard' ? 'Carro' : type}</span>
                                            </button>
                                        ))}
                                    </div>

                                    {/* CTA BUTTON */}
                                    <button
                                        onClick={handleRequestRide}
                                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold text-white text-lg shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 relative overflow-hidden group active:scale-[0.98] transition-all"
                                    >
                                        <span className="relative z-10">Pedir Higo</span>
                                        <span className="material-symbols-outlined relative z-10">arrow_forward</span>
                                        {/* Hover Effect */}
                                        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                                    </button>

                                </div>
                            </div>
                        </>
                    )}
                </div>
            </main>

            {/* CONFIRM STOP BOTTOM SHEET */}
            {
                showStopConfirm && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end">
                        <div className="w-full bg-white text-black rounded-t-[32px] p-6 animate-in slide-in-from-bottom duration-300">
                            <div className="flex flex-col gap-4">
                                <div>
                                    <h3 className="text-2xl font-bold mb-1">Agrega una parada</h3>
                                    <p className="text-lg font-medium text-gray-800">
                                        {stops[0]?.address || "Parada nueva"}
                                    </p>
                                    <p className="text-gray-500 text-sm mt-2">
                                        Ahora confirma la ruta nueva y el precio del viaje
                                    </p>
                                </div>

                                <div className="text-center py-4">
                                    <span className="text-xl font-medium text-gray-600">Precio del viaje: </span>
                                    <span className="text-xl font-bold ml-2">
                                        ${oldPrice.toFixed(2)} → ${price.toFixed(2)}
                                    </span>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => {
                                            // Cancel: Remove stop and close
                                            setStops([]);
                                            setHasPendingStopConfirm(false);
                                            setShowStopConfirm(false);
                                        }}
                                        className="flex-1 py-4 bg-gray-200 text-gray-800 font-bold rounded-2xl hover:bg-gray-300 transition-colors"
                                    >
                                        Volver
                                    </button>
                                    <button
                                        onClick={() => {
                                            setHasPendingStopConfirm(false);
                                            setShowStopConfirm(false);
                                        }}
                                        className="flex-1 py-4 bg-[#FF4F00] text-white font-bold rounded-2xl hover:bg-[#ff6a26] transition-colors shadow-lg shadow-orange-500/20"
                                    >
                                        Confirmar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* MODALS FOR DELIVERY */}
            <ProhibitedItemsModal
                isOpen={showProhibitedModal}
                onClose={() => setShowProhibitedModal(false)}
                onConfirm={() => {
                    setShowProhibitedModal(false);
                    setShowDeliveryForm(true);
                }}
            />

            {showDeliveryForm && (
                <DeliveryFormSteps
                    onCancel={() => setShowDeliveryForm(false)}
                    onSubmit={handleDeliveryConfirm}
                />
            )}
        </div>
    );
};

export default RequestRidePage;
