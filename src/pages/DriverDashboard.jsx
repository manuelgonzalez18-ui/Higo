import React, { useState, useEffect } from 'react';
import { supabase, getUserProfile } from '../services/supabase';
import { useNavigate } from 'react-router-dom';
import InteractiveMap from '../components/InteractiveMap';
import { generateSpeech, playAudioBuffer } from '../services/geminiService';
import { LocalNotifications } from '@capacitor/local-notifications';

const DriverDashboard = () => {
    const navigate = useNavigate();
    const [isOnline, setIsOnline] = useState(false);
    const [requests, setRequests] = useState([]);
    const [activeRide, setActiveRide] = useState(null); // The ride the driver has accepted
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState(null);
    const [showPaymentQR, setShowPaymentQR] = useState(false);

    // Navigation State
    const [navStep, setNavStep] = useState(0); // 0: Idle, 1: To Pickup, 2: To Dropoff
    const [instruction, setInstruction] = useState("Waiting for rides...");

    useEffect(() => {
        checkUser();
        requestNotificationPermissions();
    }, []);

    const requestNotificationPermissions = async () => {
        try {
            await LocalNotifications.requestPermissions();
        } catch (e) {
            console.error("Error requesting notifications", e);
        }
    };

    const checkUser = async () => {
        const userProfile = await getUserProfile();
        if (!userProfile || userProfile.role !== 'driver') {
            alert("Access denied: Drivers only.");
            navigate('/');
            return;
        }

        // Single Session Enforcement (Check on Load)
        const localSessionId = localStorage.getItem('session_id');
        if (userProfile.current_session_id && localSessionId !== userProfile.current_session_id) {
            alert("⚠️ Se ha iniciado sesión en otro dispositivo. Cerrando sesión...");
            await supabase.auth.signOut();
            navigate('/auth');
            return;
        }

        setProfile(userProfile);
        setLoading(false);
    };

    // Realtime Session Enforcement
    useEffect(() => {
        if (!profile?.id) return;

        const channel = supabase
            .channel(`profile:${profile.id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` }, (payload) => {
                const newSessionId = payload.new.current_session_id;
                const localSessionId = localStorage.getItem('session_id');

                if (newSessionId && newSessionId !== localSessionId) {
                    alert("⚠️ Tu sesión ha sido cerrada porque se ingresó desde otro equipo.");
                    supabase.auth.signOut().then(() => navigate('/auth'));
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [profile?.id]);

    const toggleOnline = () => {
        if (!isOnline) {
            // Trying to go ONLINE
            if (profile.subscription_status === 'suspended') {
                alert("⚠️ Your account is suspended due to missed payment. Please contact admin.");
                return;
            }
            setIsOnline(true);
            speak("You are now online. Waiting for requests.");
        } else {
            setIsOnline(false);
            speak("You are offline.");
        }
    };

    // Live Tracking & Filtering
    useEffect(() => {
        let watchId;
        if (isOnline) {
            // Start watching position
            watchId = navigator.geolocation.watchPosition(async (pos) => {
                const { latitude, longitude } = pos.coords;

                // Update Profile Logic (Debounced/Throttled ideally, simplified here)
                await supabase.from('profiles').update({
                    curr_lat: latitude,
                    curr_lng: longitude,
                    last_location_update: new Date()
                }).eq('id', profile.id);

            }, (err) => console.error(err), { enableHighAccuracy: true });
        }
        return () => {
            if (watchId) navigator.geolocation.clearWatch(watchId);
        };
    }, [isOnline, profile]);

    // Helper: Haversine Distance
    const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 9999; // Far away if no coords
        const R = 6371; // Radius of earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in km
    };

    const deg2rad = (deg) => {
        return deg * (Math.PI / 180);
    };

    // Filter Requests Logic
    useEffect(() => {
        if (!isOnline) {
            setRequests([]);
            return;
        }

        const fetchRequests = async () => {
            const { data } = await supabase
                .from('rides')
                .select('*')
                .eq('status', 'requested')
                .order('created_at', { ascending: false });

            if (data) {
                // Filter by Vehicle Type
                // Normalize types to lower case for comparison
                const driverVehicleType = profile.vehicle_type ? profile.vehicle_type.toLowerCase() : 'standard'; // Default to standard if missing

                const filteredData = data.filter(ride => {
                    const rideType = ride.type ? ride.type.toLowerCase() : 'standard';

                    // Simple matching logic
                    if (driverVehicleType === 'moto') return rideType === 'moto';
                    if (driverVehicleType === 'van' || driverVehicleType === 'camioneta') return rideType === 'van';
                    return rideType === 'standard' || rideType === 'car'; // Default bucket
                });

                // Client-side filtering for demo (ideally PostGIS)
                navigator.geolocation.getCurrentPosition((pos) => {
                    const { latitude, longitude } = pos.coords;
                    const nearbyRequests = filteredData.filter(ride => {
                        // If ride has no coords, show it (legacy support)
                        if (!ride.pickup_lat) return true;
                        const dist = getDistanceFromLatLonInKm(latitude, longitude, ride.pickup_lat, ride.pickup_lng);
                        return dist < 10; // 10km Radius
                    });
                    setRequests(nearbyRequests);
                });
            }
        };

        fetchRequests();

        const channel = supabase
            .channel('public:rides')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, async (payload) => {
                if (payload.new.status === 'requested') {
                    // Check Vehicle Type Match
                    const driverVehicleType = profile.vehicle_type ? profile.vehicle_type.toLowerCase() : 'standard';
                    const rideType = payload.new.type ? payload.new.type.toLowerCase() : 'standard';

                    let isMatch = false;
                    if (driverVehicleType === 'moto' && rideType === 'moto') isMatch = true;
                    else if ((driverVehicleType === 'van' || driverVehicleType === 'camioneta') && rideType === 'van') isMatch = true;
                    else if ((driverVehicleType === 'standard' || driverVehicleType === 'car') && (rideType === 'standard' || rideType === 'car')) isMatch = true;

                    if (!isMatch) return; // Ignore request if type doesn't match

                    // Check distance for new request
                    navigator.geolocation.getCurrentPosition(async (pos) => {
                        const { latitude, longitude } = pos.coords;
                        const dist = payload.new.pickup_lat
                            ? getDistanceFromLatLonInKm(latitude, longitude, payload.new.pickup_lat, payload.new.pickup_lng)
                            : 0;

                        if (dist < 10) {
                            setRequests(prev => [payload.new, ...prev]);
                            speak("New ride request nearby");
                            // Trigger Background Notification
                            try {
                                await LocalNotifications.schedule({
                                    notifications: [
                                        {
                                            title: "🚗 New Ride Request!",
                                            body: `Trip to ${payload.new.dropoff} - $${payload.new.price}`,
                                            id: new Date().getTime(),
                                            schedule: { at: new Date(Date.now() + 1000) },
                                            sound: 'beep.wav',
                                            attachments: null,
                                            actionTypeId: "",
                                            extra: null
                                        }
                                    ]
                                });
                                // Haptic feedback if available (using browser API as fallback or Capacitor Haptics if added)
                                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                            } catch (e) {
                                console.error("Notification Error:", e);
                            }
                        }
                    });
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [isOnline]);

    const speak = async (text) => {
        setInstruction(text);
        const buffer = await generateSpeech(text);
        if (buffer) playAudioBuffer(buffer);
    };

    const handleAcceptRide = async (ride) => {
        try {
            // Race Condition Fix: Only update if status is 'requested' and driver is null
            const { data, error } = await supabase
                .from('rides')
                .update({ status: 'accepted', driver_id: profile.id })
                .eq('id', ride.id)
                .eq('status', 'requested')
                .is('driver_id', null) // Ensure no driver is assigned
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                // If no data returned, the condition failed (ride taken or cancelled)
                alert("⚠️ Lo sentimos, este viaje ya fue tomado por otro conductor.");
                setRequests(prev => prev.filter(r => r.id !== ride.id)); // Remove from list
                return;
            }

            setActiveRide(ride);
            setRequests([]); // Clear list to focus on active ride
            setNavStep(1); // Start navigation to pickup
            speak(`Viaje aceptado. Navegando a ${ride.pickup}`);
        } catch (error) {
            console.error("Accept Ride Error:", error);
            alert("Error al aceptar viaje: " + error.message);
        }
    };

    const handleCompleteStep = async () => {
        if (navStep === 1) {
            // Arrived at Pickup
            setNavStep(2);
            speak(`Arrived at pickup. Start trip to ${activeRide.dropoff}`);
            await supabase.from('rides').update({ status: 'in_progress' }).eq('id', activeRide.id);
        } else if (navStep === 2) {
            // Arrived at Destination -> Show QR
            await supabase.from('rides').update({ status: 'completed' }).eq('id', activeRide.id);
            speak(`Trip completed. Please show payment QR to passenger.`);
            setShowPaymentQR(true);
        }
    };

    const closeRide = () => {
        setShowPaymentQR(false);
        setActiveRide(null);
        setNavStep(0);
        speak("Ready for next ride.");
    };

    if (loading) return <div className="h-screen flex items-center justify-center">Loading Driver Profile...</div>;

    if (loading) return <div className="h-screen flex items-center justify-center bg-[#0F1014] text-white">Loading Driver Profile...</div>;

    return (
        <div className="h-screen w-full relative bg-[#0F1014] text-white overflow-hidden font-sans">
            {/* Map */}
            <div className="absolute inset-0 z-0">
                <InteractiveMap
                    pickup={activeRide?.pickup}
                    dropoff={activeRide?.dropoff}
                    isDriver={true}
                />
                {/* Gradient Overlay for better text readability if needed */}
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"></div>
            </div>

            {/* Overlays */}
            <div className="relative z-10 h-full flex flex-col pointer-events-none">

                {/* Header / Online Status */}
                <div className="p-4 flex justify-between items-start pointer-events-auto">
                    {!activeRide && (
                        <div className="bg-[#1A1F2E]/90 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3 shadow-lg">
                            <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
                            <span className="font-bold text-sm tracking-wide">{isOnline ? 'En línea' : 'Desconectado'}</span>
                        </div>
                    )}
                    <div className="w-10 h-10 bg-[#1A1F2E]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg">
                        <span className="material-symbols-outlined text-white">menu</span>
                    </div>
                </div>


                {/* ACTIVE RIDE - NAVIGATION OVERLAY (Reference Image 0) */}
                {activeRide && !showPaymentQR && (
                    <div className="flex-1 flex flex-col justify-between p-4 pt-10">

                        {/* Top: Direction Pill */}
                        <div className="bg-[#1A1F2E] rounded-full p-4 pl-6 pr-6 shadow-2xl border border-white/10 flex items-center justify-between mx-auto w-full max-w-sm pointer-events-auto animate-in slide-in-from-top-4">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-[#252A3A] rounded-xl flex items-center justify-center">
                                    <span className="material-symbols-outlined text-white text-xl">turn_right</span>
                                </div>
                                <div>
                                    <h2 className="font-bold text-white text-base leading-tight">Gira a la derecha en Main...</h2>
                                    <p className="text-gray-400 text-xs">200m • Luego gira a la izquierda</p>
                                </div>
                            </div>
                        </div>

                        {/* Mid: Passenger on Map (Simulated) */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
                            <div className="relative">
                                <div className="w-12 h-12 rounded-full border-2 border-white shadow-lg overflow-hidden">
                                    <img src="https://picsum.photos/100" className="w-full h-full object-cover" />
                                </div>
                                <div className="absolute -bottom-2 -translate-x-1/2 left-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-t-[8px] border-t-white border-r-[6px] border-r-transparent"></div>
                            </div>
                        </div>


                        {/* Bottom: Passenger Card & Action */}
                        <div className="bg-[#1A1F2E] rounded-[32px] p-6 shadow-2xl border border-white/5 pointer-events-auto animate-in slide-in-from-bottom-10">
                            <div className="w-10 h-1.5 bg-gray-600/30 rounded-full mx-auto mb-6"></div>

                            <div className="flex items-center gap-4 mb-6">
                                <div className="relative">
                                    <div className="w-14 h-14 rounded-full bg-gray-700 bg-center bg-cover border border-white/10" style={{ backgroundImage: 'url(https://picsum.photos/200)' }}></div>
                                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-white text-black px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-gray-200 shadow-sm flex items-center gap-0.5">
                                        <span>4.9</span> <span className="text-yellow-600">★</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <h2 className="font-bold text-xl text-white">Sarah M.</h2>
                                    <p className="text-gray-400 text-sm">Viaje Estándar • Efectivo</p>
                                </div>
                                <div className="flex gap-2">
                                    <a href={`tel:${activeRide.passenger_phone || ''}`} className="w-12 h-12 bg-[#252A3A] rounded-full flex items-center justify-center border border-white/5 hover:bg-[#2C3345]">
                                        <span className="material-symbols-outlined text-white">call</span>
                                    </a>
                                    <button className="w-12 h-12 bg-[#252A3A] rounded-full flex items-center justify-center border border-white/5 hover:bg-[#2C3345]">
                                        <span className="material-symbols-outlined text-white">chat_bubble</span>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-6 bg-[#0F1014]/50 p-4 rounded-2xl border border-white/5">
                                <div>
                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">TIEMPO</p>
                                    <p className="text-white font-bold text-lg">4 <span className="text-sm font-normal text-gray-400">min</span></p>
                                </div>
                                <div className="border-l border-white/5 pl-4">
                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">DISTANCIA</p>
                                    <p className="text-white font-bold text-lg">1.2 <span className="text-sm font-normal text-gray-400">km</span></p>
                                </div>
                                <div className="border-l border-white/5 pl-4">
                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">LLEGADA</p>
                                    <p className="text-white font-bold text-lg">10:42</p>
                                </div>
                            </div>

                            <button
                                onClick={handleCompleteStep}
                                className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white py-4 rounded-[20px] font-bold text-lg shadow-lg shadow-[#8B5CF6]/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
                            >
                                <span>{navStep === 1 ? "He Llegado" : "Terminar Viaje"}</span>
                                <span className="material-symbols-outlined">arrow_forward</span>
                            </button>
                        </div>
                    </div>
                )}


                {/* INCOMING REQUEST MODAL (Reference Image 3) */}
                {!activeRide && requests.length > 0 && (
                    <div className="absolute bottom-6 left-4 right-4 pointer-events-auto animate-in slide-in-from-bottom-20 fade-in duration-300">
                        {requests.map(req => (
                            <div key={req.id} className="bg-[#1A1F2E] rounded-[32px] p-6 shadow-2xl border border-white/10 relative overflow-hidden">
                                {/* Progress Bar */}
                                <div className="absolute top-6 right-6 w-32 h-1.5 bg-[#252A3A] rounded-full overflow-hidden">
                                    <div className="h-full bg-[#8B5CF6] w-2/3 shadow-[0_0_10px_#8B5CF6]"></div>
                                </div>
                                <div className="absolute top-6 right-6 mt-3 text-right">
                                    <p className="text-xs text-gray-400">12s restantes</p>
                                </div>

                                <div className="flex gap-3 mb-6">
                                    <div className="w-3 h-3 rounded-full bg-[#A855F7] mt-1.5 shadow-[0_0_8px_#A855F7]"></div>
                                    <div>
                                        <h2 className="text-xl font-bold text-white leading-none mb-1">Solicitud</h2>
                                        <h2 className="text-xl font-bold text-white leading-none">Nueva</h2>
                                    </div>
                                </div>

                                <div className="mb-6">
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">TARIFA ESTIMADA</p>
                                    <h1 className="text-4xl font-extrabold text-white">${req.price}</h1>
                                </div>

                                <div className="space-y-6 relative pl-3 mb-8">
                                    {/* Timeline Line */}
                                    <div className="absolute left-[5.5px] top-2 bottom-6 w-0.5 bg-gray-700 border-l border-dashed border-gray-600"></div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="w-3 h-3 rounded-full border-2 border-gray-400 bg-[#1A1F2E] z-10"></div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">ORIGEN</p>
                                            <span className="ml-auto text-xs bg-[#252A3A] px-2 py-0.5 rounded text-gray-300">1.9 km</span>
                                        </div>
                                        <p className="text-white font-bold text-lg ml-5 truncate">{req.pickup}</p>
                                        <p className="text-xs text-gray-500 ml-5">Downtown District</p>
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="w-3 h-3 rounded-full bg-[#A855F7] shadow-[0_0_8px_#A855F7] z-10"></div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">DESTINO</p>
                                            <span className="ml-auto text-xs bg-[#252A3A] px-2 py-0.5 rounded text-gray-300">15 min</span>
                                        </div>
                                        <p className="text-white font-bold text-lg ml-5 truncate">{req.dropoff}</p>
                                        <p className="text-xs text-gray-500 ml-5">Entrada Principal</p>
                                    </div>
                                </div>


                                <div className="flex gap-4">
                                    <button onClick={() => setRequests(prev => prev.filter(r => r.id !== req.id))} className="w-14 h-14 rounded-full bg-[#252A3A] flex items-center justify-center border border-white/5 hover:bg-[#2C3345] transition-colors">
                                        <span className="material-symbols-outlined text-gray-400">close</span>
                                    </button>
                                    <button onClick={() => handleAcceptRide(req)} className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-[20px] font-bold text-lg shadow-lg shadow-[#8B5CF6]/30 flex items-center justify-center gap-2 active:scale-95 transition-all">
                                        Aceptar Viaje <span className="material-symbols-outlined">arrow_forward</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ONLINE/OFFLINE TOGGLE (When Idle) */}
                {!activeRide && requests.length === 0 && (
                    <div className="absolute bottom-10 left-6 right-6 pointer-events-auto">
                        <button
                            onClick={toggleOnline}
                            className={`w-full py-4 rounded-[20px] font-bold text-lg shadow-2xl transition-all flex items-center justify-center gap-2 ${isOnline
                                ? 'bg-[#EF4444] text-white shadow-red-500/20'
                                : 'bg-[#1A1F2E] text-white border border-white/10 hover:bg-[#252A3A]'
                                }`}
                        >
                            <span className="material-symbols-outlined">{isOnline ? 'power_settings_new' : 'bolt'}</span>
                            {isOnline ? 'Desconectarse' : 'Conectarse (Go Online)'}
                        </button>
                    </div>
                )}

                {/* PAYMENT QR OVERLAY (Keep existing logic but styled) */}
                {showPaymentQR && (
                    <div className="absolute inset-0 bg-[#0F1014]/95 z-50 flex items-center justify-center p-6 pointer-events-auto backdrop-blur-xl animate-in fade-in">
                        <div className="bg-[#1A1F2E] text-white p-8 rounded-[32px] w-full max-w-sm text-center shadow-2xl border border-white/10">
                            <h2 className="text-2xl font-black mb-2 text-white">Viaje Completado!</h2>
                            <p className="text-gray-400 mb-8 text-sm">Muestra este código al pasajero</p>

                            <div className="bg-white p-4 rounded-3xl mb-8 mx-auto w-64 h-64 flex items-center justify-center border-4 border-[#8B5CF6] shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                                {profile?.payment_qr_url ? (
                                    <img src={profile.payment_qr_url} alt="Payment QR" className="w-full h-full object-contain" />
                                ) : (
                                    <div className="text-center text-gray-400">
                                        <span className="material-symbols-outlined text-4xl mb-2 text-black">qr_code_scanner</span>
                                        <p className="text-black text-xs">No QR Code</p>
                                    </div>
                                )}
                            </div>

                            <div className="text-3xl font-black mb-8 font-mono text-[#A855F7]">${activeRide?.price || '--'}</div>

                            <button
                                onClick={closeRide}
                                className="w-full bg-white text-black py-4 rounded-[20px] font-bold text-lg hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-xl"
                            >
                                Cerrar y Listo
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default DriverDashboard;
