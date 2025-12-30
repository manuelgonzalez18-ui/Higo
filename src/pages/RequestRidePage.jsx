import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LocationInput from '../components/LocationInput';
import InteractiveMap from '../components/InteractiveMap';
import { supabase } from '../services/supabase';
import { useGeolocation } from '../hooks/useGeolocation';
import Logo from '../assets/logo.jpg';

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

    // Auto-set pickup to user location once found
    useEffect(() => {
        if (userLocation && pickup === "Ubicación Actual") {
            setPickupCoords(userLocation);
        }
    }, [userLocation, pickup]);

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
        recalculatePrice(pickupCoords, dropoffCoords, newStops, selectedRide);
    };

    // Update a stop's data
    const handleUpdateStop = (id, name, place) => {
        const newStops = stops.map(s => {
            if (s.id === id) {
                const updatedStop = { ...s, address: name };
                if (place && place.lat && place.lng) {
                    updatedStop.coords = { lat: place.lat, lng: place.lng };
                }
                return updatedStop;
            }
            return s;
        });
        setStops(newStops);
    };

    // Price mapping
    // Vehicle Rates (Provided by User)
    const VEHICLE_RATES = {
        moto: { base: 0.80, perKm: 0.28 },
        standard: { base: 1.50, perKm: 0.57 },
        van: { base: 1.70, perKm: 0.66 } // 'track' mapped to 'van'
    };

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

    // Calculate Price
    // Calculate Price with Stops
    const calculatePrice = (distanceKm, type, stopsCount = 0) => {
        const rates = VEHICLE_RATES[type];
        if (!rates) return 0;

        let finalPrice = 0;
        if (distanceKm <= 2) {
            finalPrice = rates.base;
        } else {
            // Logic: Base for first 2km + (Distance - 2) * PerKm
            finalPrice = rates.base + ((distanceKm - 2) * rates.perKm);
        }

        // Add Stop Fees
        // Moto: $0.50, Others: $1.00
        const stopFee = type === 'moto' ? 0.50 : 1.00;
        finalPrice += (stopsCount * stopFee);

        return Math.max(finalPrice, rates.base);
    };

    const calculateTotalDistance = (start, end, currentStops) => {
        if (!start || !end) return 0;

        let totalDist = 0;
        let lastPoint = start;

        // Add distance for each stop
        currentStops.forEach(stop => {
            if (stop.coords) {
                totalDist += getDistanceFromLatLonInKm(lastPoint.lat, lastPoint.lng, stop.coords.lat, stop.coords.lng);
                lastPoint = stop.coords;
            }
        });

        // Add final leg
        totalDist += getDistanceFromLatLonInKm(lastPoint.lat, lastPoint.lng, end.lat, end.lng);
        return totalDist;
    };

    const recalculatePrice = (start, end, currentStops, rideType) => {
        // Preference: Use road distance if available from Google Maps
        if (roadDistance > 0) {
            const distKm = roadDistance / 1000;
            const validStopsCount = currentStops.filter(s => s.coords).length;
            return calculatePrice(distKm, rideType, validStopsCount);
        }

        if (start && end) {
            const dist = calculateTotalDistance(start, end, currentStops);
            const validStopsCount = currentStops.filter(s => s.coords).length;
            return calculatePrice(dist, rideType, validStopsCount);
        } else {
            return VEHICLE_RATES[rideType].base;
        }
    };

    // Update Price when coords, road distance, or ride type changes
    React.useEffect(() => {
        const newPrice = recalculatePrice(pickupCoords, dropoffCoords, stops, selectedRide);

        if (stops.length > 0 && pickupCoords && dropoffCoords) {
            // Recalculate old price (no stops) using best available distance
            const baseDist = roadDistance > 0 ? (roadDistance / 1000) : getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
            const priceNoStops = calculatePrice(baseDist, selectedRide, 0);
            setOldPrice(priceNoStops);
        }
        setPrice(newPrice);
    }, [pickupCoords, dropoffCoords, selectedRide, stops, roadDistance]);

    // Check if we should show the "Confirm Stop" modal
    React.useEffect(() => {
        // Simple logic: if we have valid stops and we are not yet confirming, show it?
        // Or user explicitly clicked "Add Stop".
        // Let's assume user fills the stop and we triggers this.
        // For simplicity, let's check if the last added stop has coords now
        const allStopsValid = stops.length > 0 && stops.every(s => s.coords);
        if (allStopsValid && stops.length > 0 && !showStopConfirm) {
            setShowStopConfirm(true);
        }
    }, [stops]);

    const handleRequest = () => {
        if (!dropoff) {
            alert("Por favor selecciona un destino");
            return;
        }
        navigate('/confirm', {
            state: {
                selectedRide,
                price: price, // Use calculated price
                pickup,
                dropoff,
                pickupCoords,
                dropoffCoords,
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
                        if (data?.distance?.value) {
                            console.log("🛣️ Road distance updated:", data.distance.value);
                            setRoadDistance(data.distance.value);
                        }
                    }}
                />
                {/* Overlay Gradients */}
                <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-[#0F1014] via-[#0F1014]/90 to-transparent pointer-events-none"></div>
                <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-none"></div>
            </div>

            {/* HEADER - Transparent */}
            <header className="absolute top-0 left-0 right-0 z-20 px-6 py-4 flex items-center justify-between">
                {/* Menu Button */}
                <button className="w-10 h-10 rounded-full bg-[#1A1F2E]/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg active:scale-95 transition-transform">
                    <span className="material-symbols-outlined text-white">menu</span>
                </button>

                {/* LOGO */}
                <div className="h-8 flex items-center justify-center">
                    <img src={Logo} alt="HIGO" className="h-full w-auto drop-shadow-lg" />
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

                    {/* Floating Title (Optional branding) */}
                    <div className="mb-6 text-center shadow-black/50 drop-shadow-lg">
                        <h1 className="text-3xl font-black tracking-tight mb-1 text-white">¿A dónde vamos?</h1>
                        <p className="text-blue-500 text-sm font-bold tracking-wide">Viaja seguro en Higuerote</p>
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
                                        <span className="material-symbols-outlined text-[18px]">add_circle</span>
                                        <span>Agregar parada</span>
                                    </button>
                                )}

                                <LocationInput
                                    placeholder="¿A dónde vas?"
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
                                        <span className="text-[10px] font-bold uppercase">{type === 'van' ? 'Camioneta' : type}</span>
                                    </button>
                                ))}
                            </div>

                            {/* CTA BUTTON */}
                            <button
                                onClick={handleRequest}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold text-white text-lg shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 relative overflow-hidden group active:scale-[0.98] transition-all"
                            >
                                <span className="relative z-10">Pedir Higo</span>
                                <span className="material-symbols-outlined relative z-10">arrow_forward</span>
                                {/* Hover Effect */}
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                            </button>

                        </div>
                    </div>

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
                                            setShowStopConfirm(false);
                                        }}
                                        className="flex-1 py-4 bg-gray-200 text-gray-800 font-bold rounded-2xl hover:bg-gray-300 transition-colors"
                                    >
                                        Volver
                                    </button>
                                    <button
                                        onClick={() => setShowStopConfirm(false)}
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
        </div>
    );
};

export default RequestRidePage;
