import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LocationInput from '../components/LocationInput';
import InteractiveMap from '../components/InteractiveMap';
import { supabase } from '../services/supabase';

const RequestRidePage = () => {
    const navigate = useNavigate();
    const [selectedRide, setSelectedRide] = useState('standard');
    const [pickup, setPickup] = useState("Ubicación Actual");
    const [pickupCoords, setPickupCoords] = useState(null); // {lat, lng}
    const [dropoff, setDropoff] = useState("");
    const [dropoffCoords, setDropoffCoords] = useState(null); // {lat, lng}
    const [stops, setStops] = useState([1]); // Array of IDs for stops
    const [confirmingLocation, setConfirmingLocation] = useState(false); // 'pickup' or null

    const addStop = () => {
        setStops([...stops, Date.now()]);
    };

    const removeStop = (id) => {
        setStops(stops.filter(s => s !== id));
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
    const calculatePrice = (distanceKm, type) => {
        const rates = VEHICLE_RATES[type];
        if (!rates) return 0;

        let finalPrice = 0;
        if (distanceKm <= 2) {
            finalPrice = rates.base;
        } else {
            // Logic: Base for first 2km + (Distance - 2) * PerKm
            finalPrice = rates.base + ((distanceKm - 2) * rates.perKm);
        }
        return Math.max(finalPrice, rates.base); // Ensure minimum fare
    };

    const [price, setPrice] = useState(0);

    // Update Price when coords or ride type changes
    React.useEffect(() => {
        if (pickupCoords && dropoffCoords) {
            const dist = getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
            const calculatedPrice = calculatePrice(dist, selectedRide);
            setPrice(calculatedPrice);
        } else {
            // Default Prices if no coords (fallback)
            setPrice(VEHICLE_RATES[selectedRide].base);
        }
    }, [pickupCoords, dropoffCoords, selectedRide]);

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
                dropoffCoords
            }
        });
    };

    return (
        <div className="h-screen w-full relative bg-[#0F1014] text-white overflow-hidden font-sans">

            {/* BACKGROUND MAP */}
            <div className="absolute inset-0 z-0">
                <InteractiveMap
                    // Pass coordinates if we have them using props or context
                    className="w-full h-full"
                />
                {/* Overlay Gradients */}
                <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-[#0F1014] via-[#0F1014]/90 to-transparent pointer-events-none"></div>
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"></div>
            </div>

            {/* HEADER - Transparent */}
            <header className="absolute top-0 left-0 right-0 z-20 px-6 py-4 flex items-center justify-between">
                {/* Menu Button */}
                <button className="w-10 h-10 rounded-full bg-[#1A1F2E]/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-lg active:scale-95 transition-transform">
                    <span className="material-symbols-outlined text-white">menu</span>
                </button>

                {/* Profile Pill */}
                <div className="bg-[#1A1F2E]/80 backdrop-blur-md rounded-full pl-1 pr-4 py-1 flex items-center gap-3 border border-white/10 shadow-lg cursor-pointer hover:bg-[#252A3A] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 p-[1px]">
                        <div className="w-full h-full rounded-full bg-black/50 overflow-hidden">
                            <img src="https://picsum.photos/100" className="w-full h-full object-cover" alt="Profile" />
                        </div>
                    </div>
                    <span className="font-bold text-sm">Hola, User</span>
                </div>
            </header>

            {/* MAIN CONTENT - Floating Bottom Panel */}
            <main className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center pb-8 px-4 sm:px-0 pointer-events-none">

                <div className="w-full max-w-md pointer-events-auto">

                    {/* Floating Title (Optional branding) */}
                    <div className="mb-6 text-center">
                        <h1 className="text-3xl font-black tracking-tight mb-1 bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">¿A dónde vamos?</h1>
                        <p className="text-gray-400 text-sm font-medium">Viaja seguro en Higuerote</p>
                    </div>

                    {/* GLASS CARD FORM */}
                    <div className="bg-[#1A1F2E] rounded-[32px] p-2 shadow-2xl border border-white/10 relative overflow-hidden">

                        {/* Decorative blurred glow */}
                        <div className="absolute -top-20 -left-20 w-40 h-40 bg-violet-600/20 rounded-full blur-[50px] pointer-events-none"></div>

                        <div className="p-4 space-y-4 relative z-10">

                            {/* Inputs Group */}
                            <div className="space-y-3 bg-[#0F1014]/50 p-2 rounded-2xl border border-white/5">
                                <LocationInput
                                    placeholder="Punto de partida"
                                    defaultValue="Ubicación Actual"
                                    icon="my_location"
                                    iconColor="text-violet-400"
                                    showConnector={true}
                                    onChange={(name, place) => {
                                        setPickup(name);
                                        if (place && place.lat && place.lng) {
                                            setPickupCoords({ lat: place.lat, lng: place.lng });
                                        } else {
                                            setPickupCoords(null);
                                        }
                                    }}
                                    onMapClick={() => setConfirmingLocation(true)}
                                />

                                <LocationInput
                                    placeholder="¿A dónde vas?"
                                    defaultValue={dropoff}
                                    icon="location_on"
                                    iconColor="text-fuchsia-500"
                                    isLast={true}
                                    onChange={(name, place) => {
                                        setDropoff(name);
                                        if (place && place.lat && place.lng) {
                                            setDropoffCoords({ lat: place.lat, lng: place.lng });
                                        } else {
                                            setDropoffCoords(null);
                                        }
                                    }}
                                    onMapClick={() => setConfirmingLocation(true)}
                                />
                            </div>

                            {/* Ride Selector (Prices) */}
                            <div className="flex gap-2">
                                {Object.keys(VEHICLE_RATES).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setSelectedRide(type)}
                                        className={`flex-1 flex flex-col items-center p-3 rounded-xl border transition-all ${selectedRide === type ? 'bg-violet-600 border-violet-500 shadow-lg shadow-violet-600/20' : 'bg-[#0F1014] border-white/5 hover:bg-[#252A3A]'}`}
                                    >
                                        <span className="material-symbols-outlined text-xl mb-1">{type === 'moto' ? 'two_wheeler' : type === 'van' ? 'airport_shuttle' : 'local_taxi'}</span>
                                        <span className="text-[10px] font-bold uppercase">{type}</span>
                                        {/* Show Base if no coords, else calculated */}
                                        <span className="text-sm font-bold mt-1">
                                            ${(pickupCoords && dropoffCoords ? calculatePrice(getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng), type) : VEHICLE_RATES[type].base).toFixed(2)}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* CTA BUTTON */}
                            <button
                                onClick={handleRequest}
                                className="w-full py-4 bg-gradient-to-r from-violet-600 to-[#A855F7] rounded-xl font-bold text-white text-lg shadow-lg shadow-violet-600/25 flex items-center justify-center gap-2 relative overflow-hidden group active:scale-[0.98] transition-all"
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

        </div>
    );
};

export default RequestRidePage;
