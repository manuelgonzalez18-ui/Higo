import React, { useState, useEffect, useCallback } from 'react';
import { supabase, getUserProfile } from '../services/supabase';
import { useNavigate } from 'react-router-dom';
import InteractiveMap from '../components/InteractiveMap';
import { generateSpeech, playAudioBuffer } from '../services/geminiService';
import { startLoopingRequestAlert, stopLoopingRequestAlert } from '../services/notificationService';
import { LocalNotifications } from '@capacitor/local-notifications';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { registerPlugin, Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

const BackgroundGeolocation = Capacitor.isNativePlatform() ? registerPlugin('BackgroundGeolocation') : null;

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });
        console.error("DriverDashboard Crash:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, background: '#0F172A', color: 'white', height: '100vh', overflow: 'auto' }}>
                    <h1 style={{ color: '#EF4444', fontSize: '24px', fontWeight: 'bold' }}>⚠️ Crash Detected</h1>
                    <p style={{ marginTop: 10, fontSize: '18px' }}>{this.state.error && this.state.error.toString()}</p>
                    <pre style={{ marginTop: 10, fontSize: '12px', background: '#000', padding: 10, borderRadius: 5, overflowX: 'auto' }}>
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </pre>
                    <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '10px 20px', background: '#3B82F6', color: 'white', borderRadius: 8, border: 'none' }}>
                        Reload Page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

const DriverDashboard = () => {
    const navigate = useNavigate();
    const [isOnline, setIsOnline] = useState(false);
    const [requests, setRequests] = useState([]);
    const [activeRide, setActiveRide] = useState(null); // The ride the driver has accepted
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState(null);
    const [showPaymentQR, setShowPaymentQR] = useState(false);
    const [showTripDetails, setShowTripDetails] = useState(false); // Floating Info State
    const lastLocationRef = React.useRef(null);

    // Navigation State
    const [navStep, setNavStep] = useState(0); // 0: Idle, 1: To Pickup, 2: To Dropoff
    const [instruction, setInstruction] = useState("Waiting for rides...");
    const [currentLoc, setCurrentLoc] = useState(null);
    const [heading, setHeading] = useState(0); // Vehicle Bearing
    const [navInfo, setNavInfo] = useState(null);
    const lastInstruction = React.useRef("");

    // --- HELPER FUNCTIONS ---
    // --- HELPER FUNCTIONS ---
    const speak = useCallback(async (text) => {
        setInstruction(text);

        try {
            await TextToSpeech.speak({
                text: text,
                lang: 'es-ES',
                rate: 1.0,
                pitch: 1.0,
                volume: 1.0,
                category: 'ambient',
            });
        } catch (e) {
            console.error("TTS Error, falling back to Web Speech:", e);
            // Fallback to Web Speech API if native fails
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            window.speechSynthesis.speak(utterance);
        }
    }, []);

    const handleRouteData = useCallback((data) => {
        setNavInfo(data);
        if (data?.next_step?.instruction) {
            // Strip HTML for speech
            const cleanText = data.next_step.instruction.replace(/<[^>]*>/g, '');

            if (cleanText !== lastInstruction.current) {
                lastInstruction.current = cleanText;
                console.log("🗣️ Speaking Instruction:", cleanText);
                speak(cleanText);
            }
        }
    }, [speak]); // Add speak dependency if stable, or leave empty if hoisted

    // --- NOTIFICATION SETUP ---
    const notificationSetupDone = React.useRef(false);

    useEffect(() => {
        const setupNotifications = async () => {
            if (notificationSetupDone.current) return;
            notificationSetupDone.current = true; // Mark as done



            // Native Only: Channels and Actions
            if (Capacitor.isNativePlatform()) {
                // 0. Request Permissions FIRST (Native only)
                const perm = await LocalNotifications.requestPermissions();
                if (perm.display !== 'granted') console.warn('Notification permission denied');

                // 1. Create Channel (v12 - Force Fresh Config)
                await LocalNotifications.createChannel({
                    id: 'higo_rides_v12',
                    name: 'New Ride Requests (High Priority)',
                    importance: 5,
                    visibility: 1,
                    sound: 'alert_sound.wav', // Try with extension for raw resource match if previous failed
                    vibration: true
                });

                // 2. Register Actions
                await LocalNotifications.registerActionTypes({
                    types: [
                        {
                            id: 'RIDE_REQUEST_ACTIONS',
                            actions: [
                                {
                                    id: 'ACCEPT',
                                    title: '✅ Aceptar Viaje',
                                    foreground: true // Open app when clicked
                                }
                            ]
                        }
                    ]
                });
            }
        };

        setupNotifications();

        // 4. Action Listener
        // 4. Action Listener
        let listenerHandle;
        const registerListener = async () => {
            if (Capacitor.isNativePlatform()) {
                listenerHandle = await LocalNotifications.addListener('localNotificationActionPerformed', async (notification) => {
                    console.log('🔔 Action Performed:', notification.actionId);
                    if (notification.actionId === 'ACCEPT' || notification.actionId === 'tap') {
                        const rideId = notification.notification.extra?.rideId;
                        if (rideId) {
                            try {
                                const { data: { user } } = await supabase.auth.getUser();
                                if (user) {
                                    await supabase.from('rides')
                                        .update({ status: 'accepted', driver_id: user.id })
                                        .eq('id', rideId)
                                        .eq('status', 'requested');
                                    window.location.reload();
                                }
                            } catch (e) { console.error("Accept Error:", e); }
                        }
                    }
                });
            }
        };

        registerListener();

        // Initialize User Check
        checkUser();

        return () => {
            if (listenerHandle) listenerHandle.remove();
        };
    }, []);

    // 5. Deep Link Listener for Background "Accept" Action
    useEffect(() => {
        const handleDeepLink = async (event) => {
            if (event.url.includes('higo://accept')) {
                const url = new URL(event.url); // Use URL API if compatible or simple split
                // URL might be "higo://accept?rideId=123"
                const rideId = url.searchParams.get('rideId') || event.url.split('rideId=')[1];

                console.log("🚀 Deep Link Accepted Ride:", rideId);

                if (rideId) {
                    try {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (user) {
                            await supabase.from('rides')
                                .update({ status: 'accepted', driver_id: user.id })
                                .eq('id', rideId)
                                .eq('status', 'requested');

                            alert("¡Viaje aceptado desde notificación!");
                            window.location.reload();
                        }
                    } catch (e) {
                        console.error("Deep Link Accept Error:", e);
                        alert("Error al aceptar viaje.");
                    }
                }
            }
        };

        App.addListener('appUrlOpen', handleDeepLink);

        // Check if app was launched by URL (Cold Start)
        App.getLaunchUrl().then(launchUrl => {
            if (launchUrl && launchUrl.url) {
                handleDeepLink(launchUrl);
            }
        });

        return () => {
            App.removeAllListeners('appUrlOpen');
        };
    }, []);

    // Old duplicate effects removed

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

        // Restore Active Ride
        const { data: activeRides } = await supabase
            .from('rides')
            .select('*')
            .eq('driver_id', userProfile.id)
            .in('status', ['accepted', 'in_progress'])
            .maybeSingle();

        if (activeRides) {
            setActiveRide(activeRides);
            setNavStep(activeRides.status === 'accepted' ? 1 : 2);
        }

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

    // Active Ride Cancellation Listener
    useEffect(() => {
        if (!activeRide) return;

        const channel = supabase
            .channel(`ride_cancel:${activeRide.id}`)
            // Removing strict filter to debug, will filter inside
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload) => {
                console.log("🔔 REALTIME UPDATE RECEIVED:", payload);
                // Use loose equality for safety
                if (payload.new.id == activeRide.id && payload.new.status === 'cancelled') {
                    console.log("🚫 CANCEL DETECTED! Triggering alert...");

                    // 1. IMMEDIATE PHYSICAL FEEDBACK
                    if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
                    speak("El viaje ha sido cancelado por el pasajero.");

                    // 2. Schedule Notification (Async, don't await blocking)
                    LocalNotifications.schedule({
                        notifications: [{
                            title: "Viaje Cancelado",
                            body: "El pasajero ha cancelado el viaje.",
                            id: new Date().getTime(),
                            schedule: { at: new Date() },
                            channelId: 'higo_rides_v6', // Updated channel
                            // sound removed
                            actionTypeId: "",
                            extra: null
                        }]
                    }).catch(e => console.error("Cancel Notification Fail:", e));

                    alert("El pasajero ha cancelado el viaje. Volviendo al mapa...");

                    // Force a reload to clear state cleanly and re-fetch
                    window.location.reload();
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [activeRide]);

    // Polling Logic for Cancellation (Backup to Realtime)
    useEffect(() => {
        if (!activeRide) return;
        const interval = setInterval(async () => {
            const { data, error } = await supabase
                .from('rides')
                .select('status')
                .eq('id', activeRide.id)
                .single();

            if (data && data.status === 'cancelled') {
                console.log("🚫 POLLING: CANCELLATION DETECTED");

                // 1. Feedback
                if (navigator.vibrate) navigator.vibrate([1000, 1000]);
                alert("El viaje ha sido cancelado (Sincronizado).");

                // 2. Reset immediately
                window.location.reload();

                // 3. Try Notification (Low Priority)
                LocalNotifications.schedule({
                    notifications: [{
                        title: "Viaje Cancelado",
                        body: "Detectado por sincronización.",
                        id: new Date().getTime(),
                        schedule: { at: new Date() },
                        channelId: 'higo_rides_v8',
                        // sound removed
                        extra: null
                    }]
                }).catch(e => console.log("Poll notify fail", e));
            }
        }, 5000); // Check every 5 seconds
        return () => clearInterval(interval);
    }, [activeRide]);

    const toggleOnline = async () => {
        if (!isOnline) {
            // Trying to go ONLINE
            if (profile.subscription_status === 'suspended') {
                alert("⚠️ Your account is suspended due to missed payment. Please contact admin.");
                return;
            }

            try {
                // Sync status to DB
                const { error } = await supabase.from('profiles')
                    .update({ status: 'online', last_location_update: new Date() })
                    .eq('id', profile.id);

                if (error) throw error;

                setIsOnline(true);
                speak("You are now online. Waiting for requests.");
            } catch (e) {
                console.error("Error going online:", e);
                alert("Error al conectar: " + e.message);
            }
        } else {
            // Going OFFLINE
            try {
                await supabase.from('profiles')
                    .update({ status: 'offline' })
                    .eq('id', profile.id);

                setIsOnline(false);
                speak("You are offline.");
            } catch (e) {
                console.error("Error going offline:", e);
            }
        }
    };

    // --- HELPER FUNCTIONS ---

    const deg2rad = (deg) => {
        return deg * (Math.PI / 180);
    };

    const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
        const R = 6371;
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const calculateBearing = (startLat, startLng, destLat, destLng) => {
        const startLatRad = deg2rad(startLat);
        const startLngRad = deg2rad(startLng);
        const destLatRad = deg2rad(destLat);
        const destLngRad = deg2rad(destLng);

        const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
        const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
            Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
        const brng = Math.atan2(y, x);
        const brngDeg = (brng * 180 / Math.PI + 360) % 360; // Normalize to 0-360
        return brngDeg;
    };

    // --- HOISTED LOGIC FOR PROCESSING REQUESTS ---

    const notifyNewRequest = useCallback(async (ride) => {
        console.log("🚨 ATTEMPTING TO NOTIFY NEW REQUEST", ride);

        // 1. IMMEDIATE FEEDBACK (Priority)
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000]);
        speak("Nueva solicitud de viaje");

        // 2. Web Audio Backup (Standard Beep)
        try {
            const audio = new Audio('https://www.soundjay.com/buttons/beep-01a.mp3');
            audio.volume = 1.0;
            audio.play().catch(e => console.log('Web Audio play failed', e));
        } catch (e) { console.log('Audio init failed', e); }

        // 3. Native Notification (Async)
        try {
            // Calculate Distance dynamically for notification
            let distText = "";
            if (lastLocationRef.current && ride.pickup_lat) {
                const dist = getDistanceFromLatLonInKm(
                    lastLocationRef.current.latitude, lastLocationRef.current.longitude,
                    ride.pickup_lat, ride.pickup_lng
                );
                distText = ` | ${dist.toFixed(1)} km`;
            }

            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: "🚗 New Ride Request!",
                        body: `$${ride.price} - ${ride.dropoff}${distText}`,
                        id: new Date().getTime(),
                        schedule: { at: new Date(Date.now() + 50) }, // Almost immediate
                        channelId: 'higo_rides_v12',
                        // smallIcon removed to use system default
                        actionTypeId: 'RIDE_REQUEST_ACTIONS', // Attach Action Button
                        extra: { rideId: ride.id },
                        visibility: 1, // Public visibility on lock screen
                        priority: 2, // High Priority (Legacy Android)
                        sound: 'alert_sound.wav'
                    }
                ]
            });
        } catch (e) {
            console.error("Notification Error:", e);
        }
    }, [LocalNotifications]); // Actually LocalNotifications is imported

    const processRequests = useCallback((incomingRides, replace = false) => {
        if (!profile) return;

        // Parse Instructions for Higo Mandado
        const newRides = incomingRides.map(ride => {
            // Ensure delivery_info is parsed if string
            let dInfo = ride.delivery_info;
            if (typeof dInfo === 'string') {
                try { dInfo = JSON.parse(dInfo); } catch (e) { console.error("Error parsing delivery_info", e); }
            }

            // Helper for legacy view (if needed), but main Modal uses dInfo directly
            let deliveryInstructions = null;
            if (dInfo && typeof dInfo === 'object') {
                deliveryInstructions = dInfo.destInstructions || dInfo.instructions || dInfo.description;
            } else if (ride.delivery_instructions) {
                deliveryInstructions = ride.delivery_instructions;
            }

            return {
                ...ride,
                delivery_info: dInfo, // Explicitly ensure parsed object is passed
                instructions: deliveryInstructions,
                delivery_instructions: deliveryInstructions
            };
        });

        // Normalize Driver Vehicle (Handle 'Carro' from DB)
        let driverVehicleType = profile.vehicle_type ? profile.vehicle_type.toLowerCase() : 'standard';
        if (driverVehicleType === 'carro' || driverVehicleType === 'auto') driverVehicleType = 'standard';

        const checkRide = (ride) => {
            // Fix: Use correct column 'ride_type' from DB, fallback to 'standard'
            const rideType = ride.ride_type ? ride.ride_type.toLowerCase() : 'standard';

            // Debug Log
            console.log(`🔍 Checking Ride ${ride.id ? String(ride.id).slice(0, 4) : '???'}: Driver(${driverVehicleType}) vs Ride(${rideType})`);

            let isMatch = false;
            if (driverVehicleType === 'moto' && rideType === 'moto') isMatch = true;
            else if ((driverVehicleType === 'van' || driverVehicleType === 'camioneta') && rideType === 'van') isMatch = true;
            else if (driverVehicleType === 'standard' && (rideType === 'standard' || rideType === 'car')) isMatch = true;

            if (!isMatch) {
                console.log("❌ Type Mismatch");
                return false;
            }

            // Distance Match (Instant)
            // Fix: Check for pickup_lat (new schema) OR legacy pickup_location if needed, but assuming lat/lng exists for smart assignment
            if (!ride.pickup_lat) {
                console.log("⚠️ No pickup coords, allowing (Legacy/Manual)");
                return true;
            }

            if (lastLocationRef.current) {
                const dist = getDistanceFromLatLonInKm(
                    lastLocationRef.current.latitude,
                    lastLocationRef.current.longitude,
                    ride.pickup_lat,
                    ride.pickup_lng
                );
                console.log(`📏 Distance: ${dist.toFixed(2)}km (Limit: 10km)`);
                return dist <= 10; // Strict 10km limit per requirements
            } else {
                console.log("⚠️ Driver location unknown, showing ride as fail-safe");
                return true;
            }
        };

        const filtered = newRides.filter(checkRide);

        setRequests(prev => {
            if (replace) return filtered;
            const combined = [...filtered, ...prev];
            // Dedup by ID
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            return unique.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        });

        // NOTIFY IMMEDIATELY for new items
        if (!replace && filtered.length > 0) {
            LocalNotifications.checkPermissions().then(status => {
                if (status.display !== 'granted') {
                    LocalNotifications.requestPermissions();
                }
            });

            console.log("🔔 Notifying driver of new request!", filtered[0]);
            speak("Nueva solicitud de viaje");

            // Loop until accepted or dismissed
            startLoopingRequestAlert();

            notifyNewRequest(filtered[0]);
        }
    }, [profile, notifyNewRequest]);

    // --- LIVE TRACKING & BACKGROUND MODE ---
    useEffect(() => {
        let watcherId;

        const startTracking = async () => {
            // WEB FALLBACK for Driver Tracking
            if (!Capacitor.isNativePlatform()) {
                console.log("WebApp: Starting standard geolocation watch");
                if (navigator.geolocation) {
                    watcherId = navigator.geolocation.watchPosition(
                        async (pos) => {
                            const { latitude, longitude } = pos.coords;
                            console.log("📍 Web Location Update:", latitude, longitude);
                            lastLocationRef.current = { latitude, longitude };
                            setCurrentLoc({ lat: latitude, lng: longitude });

                            if (profile?.id) {
                                // Sync to DB
                                await supabase.from('profiles').update({
                                    curr_lat: latitude,
                                    curr_lng: longitude,
                                    last_location_update: new Date(),
                                    status: isOnline ? 'online' : 'offline'
                                }).eq('id', profile.id);

                                // Poll for rides
                                const { data } = await supabase.rpc('get_nearby_rides', {
                                    driver_lat: latitude,
                                    driver_lng: longitude,
                                    radius_km: 10.0,
                                    driver_vehicle_type: profile.vehicle_type || 'standard'
                                });

                                if (data && data.length > 0) {
                                    processRequests(data, false);
                                }
                            }
                        },
                        (err) => console.error("Web Geo Error:", err),
                        { enableHighAccuracy: true, maximumAge: 0 }
                    );
                }
                return;
            }

            // NATIVE BG TRACKING
            // Request Permissions
            try {
                const status = await BackgroundGeolocation.checkPermissions();
                if (status.location === 'prompt' || status.location === 'prompt-with-rationale') {
                    await BackgroundGeolocation.requestPermissions();
                }
            } catch (e) {
                console.warn("BG Geo permission check failed", e);
            }

            watcherId = await BackgroundGeolocation.addWatcher(
                {
                    backgroundMessage: "Higo Driver está activo en segundo plano",
                    backgroundTitle: "Buscando Viajes...",
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: 2 // Ultra-responsive check (2 meters)
                },
                async (location, error) => {
                    if (error) {
                        return;
                    }

                    const { latitude, longitude, bearing: gpsBearing } = location;
                    console.log("📍 BG Location Update:", latitude, longitude);

                    // Calculate Heading
                    let newHeading = gpsBearing;
                    if (!newHeading && lastLocationRef.current) {
                        newHeading = calculateBearing(
                            lastLocationRef.current.latitude,
                            lastLocationRef.current.longitude,
                            latitude,
                            longitude
                        );
                    }
                    if (newHeading) setHeading(newHeading);

                    lastLocationRef.current = { latitude, longitude };

                    // Update Profile Logic
                    if (profile?.id) {
                        // Force re-render for map route update
                        setCurrentLoc({ lat: latitude, lng: longitude });

                        await supabase.from('profiles').update({
                            curr_lat: latitude,
                            curr_lng: longitude,
                            heading: newHeading || 0,
                            last_location_update: new Date()
                        }).eq('id', profile.id);

                        // --- BACKGROUND POLLING FOR RIDES ---
                        // Critical: Check for rides every time we move, in case socket acts up
                        // --- BACKGROUND POLLING FOR RIDES (RPC - 5km Radius) ---
                        // Use PostGIS RPC for efficient server-side filtering
                        const { data } = await supabase
                            .rpc('get_nearby_rides', {
                                driver_lat: latitude,
                                driver_lng: longitude,
                                radius_km: 10.0,
                                driver_vehicle_type: profile.vehicle_type || 'standard'
                            });

                        if (data && data.length > 0) {
                            processRequests(data, false);
                        }
                    }
                }
            );
        };

        if (isOnline) {
            startTracking();
        } else {
            if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId });
        }

        return () => {
            if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId });
        };
    }, [isOnline, profile, processRequests]);


    // --- REALTIME SUBSCRIPTION ---
    const [subscriptionStatus, setSubscriptionStatus] = useState('DISCONNECTED');

    useEffect(() => {
        let channel;

        if (!isOnline) {
            setRequests([]);
            setSubscriptionStatus('DISCONNECTED');
            return;
        }

        const setupRealtime = async () => {
            setSubscriptionStatus('CONNECTING');

            const fetchExistingRequests = async () => {
                const { data, error } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('status', 'requested')
                    .order('created_at', { ascending: false });

                if (data) {
                    processRequests(data, true); // true = replace all initial load
                }
            };

            channel = supabase
                .channel('public:rides')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, (payload) => {
                    if (payload.new.status === 'requested') {
                        processRequests([payload.new], false);
                    }
                })
                .subscribe((status) => {
                    setSubscriptionStatus(status);
                    if (status === 'SUBSCRIBED') {
                        fetchExistingRequests();
                    }
                });
        };

        setupRealtime();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [isOnline, profile, processRequests]);
    // ^ processRequests now stable via useCallback

    // --- OTHER HANDLERS ---

    const handleAcceptRide = async (ride) => {
        try {
            const { data, error } = await supabase
                .from('rides')
                .update({ status: 'accepted', driver_id: profile.id })
                .eq('id', ride.id)
                .eq('status', 'requested')
                .is('driver_id', null)
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                alert("⚠️ Lo sentimos, este viaje ya fue tomado por otro conductor.");
                setRequests(prev => prev.filter(r => r.id !== ride.id));
                return;
            }

            setActiveRide(ride);
            setRequests([]);
            stopLoopingRequestAlert(); // Stop sound
            setNavStep(1);
            speak(`Viaje aceptado. Navegando a ${ride.pickup}`);
        } catch (error) {
            console.error("Accept Ride Error:", error);
            alert("Error al aceptar viaje: " + error.message);
        }
    };

    const handleCompleteStep = async () => {
        if (navStep === 1) {
            // ARRIVED AT PICKUP

            // Check if Sender Pays (Higo Mandado)
            const isSenderPayer = activeRide?.delivery_info?.payer === 'sender' || activeRide?.payer === 'sender';

            if (isSenderPayer) {
                // Determine if we need to show QR NOW (at Pickup)
                speak("Llegada al origen. El remitente debe pagar ahora.");
                setShowPaymentQR(true);
                // We pause state advance until QR is closed/confirmed
            } else {
                // Standard Flow (Pay at End) or Receiver Pays
                setNavStep(2);
                speak(`Recogida exitosa. Iniciando viaje a ${activeRide.dropoff}`);
                await supabase.from('rides').update({ status: 'in_progress' }).eq('id', activeRide.id);
            }

        } else if (navStep === 2) {
            // ARRIVED AT DROPOFF (Terminating)
            await supabase.from('rides').update({ status: 'completed' }).eq('id', activeRide.id);

            const isSenderPayer = activeRide?.delivery_info?.payer === 'sender' || activeRide?.payer === 'sender';

            if (isSenderPayer) {
                // Already paid at start, just finish
                speak("Viaje finalizado. Gracias.");
                closeRide();
            } else {
                // Receiver Pays or Standard Passenger
                speak(`Viaje completado. Muestre el código QR para el pago.`);
                setShowPaymentQR(true);
            }
        }
    };

    // Handler for closing QR and advancing state
    const handleQRClosed = async () => {
        setShowPaymentQR(false);

        // If we were at Step 1 (Sender Paid), move to Step 2
        if (navStep === 1) {
            setNavStep(2);
            speak(`Pago confirmado. Iniciando viaje al destino.`);
            await supabase.from('rides').update({ status: 'in_progress' }).eq('id', activeRide.id);
        } else {
            // If we were at Step 2 (Receiver Paid), finish
            setActiveRide(null);
            setNavStep(0);
            setRequests([]);
            stopLoopingRequestAlert();
            window.location.reload();
        }
    };

    const closeRide = () => {
        setShowPaymentQR(false); // 1. Close UI immediately
        // 2. Defer heavy cleanup to allow animation to finish
        setTimeout(() => {
            setActiveRide(null);
            setNavStep(0);
            setRequests([]);
            stopLoopingRequestAlert(); // Stop sound
        }, 150);
    };

    const handleLogout = async () => {
        if (activeRide) {
            alert("Completa el viaje actual antes de salir.");
            return;
        }
        await supabase.auth.signOut();
        navigate('/');
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-[#0F1014] text-white">Loading Driver Profile...</div>;

    return (
        <div className="h-screen w-full relative bg-[#020617] text-white overflow-hidden font-sans">
            {/* Map */}
            <div className="absolute inset-0 z-0">
                <InteractiveMap
                    origin={
                        activeRide && navStep === 1
                            ? (lastLocationRef.current ? { lat: lastLocationRef.current.latitude, lng: lastLocationRef.current.longitude }
                                : (profile?.curr_lat ? { lat: Number(profile.curr_lat), lng: Number(profile.curr_lng) } : null))
                            : (activeRide && navStep === 2
                                ? (lastLocationRef.current ? { lat: lastLocationRef.current.latitude, lng: lastLocationRef.current.longitude }
                                    : (profile?.curr_lat ? { lat: Number(profile.curr_lat), lng: Number(profile.curr_lng) } : { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng }))
                                : null)
                    }
                    destination={
                        activeRide && navStep === 1
                            ? { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng }
                            : (activeRide && navStep === 2
                                ? { lat: activeRide.dropoff_lat, lng: activeRide.dropoff_lng }
                                : null)
                    }
                    assignedDriver={null}
                    destinationIconType={navStep === 1 ? 'passenger' : 'flag'}
                    onRouteData={handleRouteData}
                    routeColor={navStep === 1 ? "#22C55E" : "#8A2BE2"} // Green to Pickup, Violet to Dropoff
                    isDriver={true}
                    vehicleType={profile?.vehicle_type || 'standard'}
                />
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"></div>
            </div>

            {/* Overlays */}
            <div className="relative z-10 h-full flex flex-col pointer-events-none">

                {/* Header / Online Status */}
                <div className="p-4 flex justify-between items-start pointer-events-auto">
                    {!activeRide && (
                        <div className="bg-[#0F172A]/90 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3 shadow-lg">
                            <div className={`w-3 h-3 rounded-full ${isOnline && subscriptionStatus === 'SUBSCRIBED' ? 'bg-green-500 animate-pulse' : isOnline ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`}></div>
                            <span className="font-bold text-sm tracking-wide">
                                {!isOnline ? 'Desconectado' :
                                    subscriptionStatus === 'SUBSCRIBED' ? 'En línea' :
                                        subscriptionStatus === 'CONNECTING' ? 'Conectando...' :
                                            'Reconectando...'}
                            </span>
                        </div>
                    )}
                    <button onClick={handleLogout} className="w-10 h-10 bg-[#0F172A]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg hover:bg-red-500/20 transition-colors ml-auto">
                        <span className="material-symbols-outlined text-white">logout</span>
                    </button>
                </div>


                {/* ACTIVE RIDE - NAVIGATION OVERLAY */}
                {activeRide && !showPaymentQR && (
                    <div className="flex-1 flex flex-col justify-between p-4 pt-10 relative pointer-events-none">

                        {/* Top: Direction Pill */}
                        <div className="bg-[#0F172A] rounded-full p-4 pl-6 pr-6 shadow-2xl border border-white/10 flex items-center justify-between mx-auto w-full max-w-sm pointer-events-auto animate-in slide-in-from-top-4 relative z-20">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-[#252A3A] rounded-xl flex items-center justify-center">
                                    <span className="material-symbols-outlined text-white text-xl">turn_right</span>
                                </div>
                                <div>
                                    <h2
                                        className="font-bold text-white text-base leading-tight text-left max-w-[200px]"
                                        dangerouslySetInnerHTML={{ __html: navInfo?.next_step?.instruction || "Calculando ruta..." }}
                                    ></h2>
                                    <p className="text-gray-400 text-xs text-left">
                                        {navInfo?.next_step?.distance?.text || "--"} • {navInfo?.duration?.text || "--"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* FLOATING TRIP DETAILS BUTTON */}
                        <button
                            onClick={() => setShowTripDetails(true)}
                            className="absolute top-28 right-4 w-12 h-12 bg-white text-blue-600 rounded-full shadow-xl flex items-center justify-center border-4 border-[#0F172A] pointer-events-auto z-20 animate-bounce-in active:scale-90 transition-transform"
                        >
                            <span className="material-symbols-outlined text-2xl">info</span>
                        </button>

                        {/* Bottom: Passenger Card & Action */}
                        <div className="bg-[#0F172A] rounded-[32px] p-5 shadow-2xl border border-white/10 pointer-events-auto animate-in slide-in-from-bottom-10 pointer-events-auto mt-auto">
                            <div className="w-10 h-1.5 bg-gray-600/30 rounded-full mx-auto mb-5"></div>

                            <div className="flex items-center gap-3 mb-5">
                                <div className="relative flex-shrink-0">
                                    <div className="w-14 h-14 rounded-full bg-gray-700 bg-center bg-cover border-2 border-white/10 shadow-lg" style={{ backgroundImage: 'url(https://picsum.photos/200)' }}></div>
                                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-white text-black px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-gray-200 shadow-sm flex items-center gap-0.5">
                                        <span>4.9</span> <span className="text-yellow-600">★</span>
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0 pr-2">
                                    <h2 className="font-bold text-xl text-white truncate leading-tight">Sarah M.</h2>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                        <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-medium border border-blue-500/10">Estándar</span>
                                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-medium border border-emerald-500/10">Efectivo</span>
                                    </div>
                                </div>

                                <div className="flex gap-2 flex-shrink-0">
                                    <a href={`tel:${activeRide.passenger_phone || ''}`} className="w-11 h-11 bg-[#252A3A] rounded-full flex items-center justify-center border border-white/5 hover:bg-[#2C3345] hover:text-green-400 transition-colors">
                                        <span className="material-symbols-outlined text-white text-[20px]">call</span>
                                    </a>
                                    <button
                                        onClick={() => {
                                            if (activeRide && activeRide.id) {
                                                window.dispatchEvent(new CustomEvent('open-chat', { detail: { rideId: activeRide.id, title: 'Chat con Pasajero' } }));
                                            } else {
                                                console.error("Cannot open chat: Missing activeRide ID", activeRide);
                                                alert("Error al abrir el chat: No se encontró el ID del viaje.");
                                            }
                                        }}
                                        className="w-11 h-11 bg-[#252A3A] rounded-full flex items-center justify-center border border-white/5 hover:bg-[#2C3345] hover:text-blue-400 transition-colors"
                                    >
                                        <span className="material-symbols-outlined text-white text-[20px]">chat_bubble</span>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mb-5 bg-[#0F1014]/50 p-3 rounded-2xl border border-white/5">
                                <div>
                                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">TIEMPO</p>
                                    <p className="text-white font-bold text-base">4 <span className="text-xs font-normal text-gray-400">min</span></p>
                                </div>
                                <div className="border-l border-white/5 pl-3">
                                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">DISTANCIA</p>
                                    <p className="text-white font-bold text-base">1.2 <span className="text-xs font-normal text-gray-400">km</span></p>
                                </div>
                                <div className="border-l border-white/5 pl-3">
                                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">LLEGADA</p>
                                    <p className="text-white font-bold text-base">10:42</p>
                                </div>
                            </div>

                            <button
                                onClick={handleCompleteStep}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-[20px] font-bold text-lg shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
                            >
                                <span>{navStep === 1 ? "He Llegado" : "Terminar Viaje"}</span>
                                <span className="material-symbols-outlined">arrow_forward</span>
                            </button>
                        </div>
                    </div>
                )}


                {/* INCOMING REQUEST MODAL */}
                {!activeRide && requests.length > 0 && (
                    <div className="absolute bottom-6 left-4 right-4 pointer-events-auto animate-in slide-in-from-bottom-20 fade-in duration-300">
                        {requests.map(req => (
                            <div key={req.id} className="bg-[#0F172A] rounded-[32px] p-6 shadow-2xl border border-white/10 relative overflow-hidden">
                                {/* Progress Bar */}
                                <div className="absolute top-6 right-6 w-32 h-1.5 bg-[#1E293B] rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 w-2/3"></div>
                                </div>
                                <div className="absolute top-6 right-6 mt-3 text-right">
                                    <p className="text-xs text-gray-400">12s restantes</p>
                                </div>

                                <div className="flex gap-3 mb-6">
                                    <div className="w-3 h-3 rounded-full bg-blue-400 mt-1.5"></div>
                                    <div>
                                        <h2 className="text-xl font-bold text-white leading-none mb-1">Solicitud</h2>
                                        <h2 className="text-xl font-bold text-white leading-none">Nueva</h2>
                                    </div>
                                </div>

                                <div className="mb-6">
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">TARIFA ESTIMADA</p>
                                    <h1 className="text-4xl font-extrabold text-white">${parseFloat(req.price).toFixed(2)}</h1>
                                </div>

                                {/* Delivery Badge - LARGE WHITE TEXT */}
                                {(req.service_type === 'delivery' || req.delivery_info) && (
                                    <div className="mb-4 bg-yellow-600 p-4 rounded-xl text-center shadow-lg animate-pulse">
                                        <h1 className="text-2xl font-black text-white uppercase tracking-widest drop-shadow-md">
                                            📦 HIGO MANDADO
                                        </h1>
                                        <p className="text-white/90 text-xs font-bold mt-1">
                                            VER DETALLES EN BURBUJA (ℹ️)
                                        </p>
                                    </div>
                                )}

                                {/* Delivery Instructions - Simplified */}
                                {(req.instructions || req.delivery_instructions) && (
                                    <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-xl">
                                        <p className="text-[10px] text-yellow-500 font-bold uppercase mb-1">📝 Detalles del Envío</p>
                                        <p className="text-sm text-gray-200 leading-snug">
                                            {req.instructions || req.delivery_instructions}
                                        </p>
                                    </div>
                                )}

                                <div className="space-y-6 relative pl-3 mb-8">
                                    {/* Timeline Line */}
                                    <div className="absolute left-[5.5px] top-2 bottom-6 w-0.5 bg-slate-700 border-l border-dashed border-slate-600"></div>

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
                                            <div className="w-3 h-3 rounded-full bg-blue-500 z-10"></div>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">DESTINO</p>
                                            <span className="ml-auto text-xs bg-[#1E293B] px-2 py-0.5 rounded text-slate-300">15 min</span>
                                        </div>
                                        <p className="text-white font-bold text-lg ml-5 truncate">{req.dropoff}</p>
                                        <p className="text-xs text-gray-500 ml-5">Entrada Principal</p>
                                    </div>
                                </div>


                                <div className="flex gap-4">
                                    <button onClick={() => {
                                        setRequests(prev => {
                                            const next = prev.filter(r => r.id !== req.id);
                                            if (next.length === 0) stopLoopingRequestAlert();
                                            return next;
                                        });
                                    }} className="w-14 h-14 rounded-full bg-[#1E293B] flex items-center justify-center border border-white/5 hover:bg-[#2C3345] transition-colors">
                                        <span className="material-symbols-outlined text-slate-400">close</span>
                                    </button>
                                    <button onClick={() => handleAcceptRide(req)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-[20px] font-bold text-lg shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 active:scale-95 transition-all">
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
                                : 'bg-[#0F172A] text-white border border-white/10 hover:bg-[#1E293B] shadow-lg'
                                }`}
                        >
                            <span className="material-symbols-outlined">{isOnline ? 'power_settings_new' : 'bolt'}</span>
                            {isOnline ? 'Desconectarse' : 'Conectarse (Go Online)'}
                        </button>
                    </div>
                )}

                {/* PAYMENT QR OVERLAY */}
                {showPaymentQR && (
                    <div className="absolute inset-0 bg-[#0F1014]/95 z-50 flex items-center justify-center p-6 pointer-events-auto backdrop-blur-xl animate-in fade-in">
                        <div className="bg-[#1A1F2E] text-white p-8 rounded-[32px] w-full max-w-sm text-center shadow-2xl border border-white/10">
                            <h2 className="text-2xl font-black mb-2 text-white">Viaje Completado!</h2>
                            <p className="text-gray-400 mb-8 text-sm max-w-[200px] mx-auto leading-tight">Muestra este código al pasajero para que realice su pago movil</p>

                            <div className="bg-white p-4 rounded-3xl mb-8 mx-auto w-64 h-64 flex items-center justify-center border-4 border-blue-500 shadow-lg">
                                {profile?.payment_qr_url ? (
                                    <img src={profile.payment_qr_url} alt="Payment QR" className="w-full h-full object-contain" />
                                ) : (
                                    <div className="text-center text-gray-400">
                                        <span className="material-symbols-outlined text-4xl mb-2 text-black">qr_code_scanner</span>
                                        <p className="text-black text-xs font-bold">No QR Configurado</p>
                                        <button
                                            onClick={() => alert("Función de carga de QR en construcción. Por favor contacta a soporte.")}
                                            className="mt-2 text-[10px] bg-blue-100 text-blue-600 px-3 py-1 rounded-full font-bold"
                                        >
                                            Cargar QR
                                        </button>
                                    </div>
                                )}
                            </div>

                            <p className="text-4xl font-black text-white mb-8 tracking-tighter">
                                ${activeRide?.price?.toFixed(2)}
                            </p>

                            <button
                                onClick={handleQRClosed}
                                className="w-full py-4 bg-white text-black rounded-[20px] font-bold text-lg hover:bg-gray-100 transition-colors shadow-lg active:scale-95"
                            >
                                {navStep === 1 ? 'Pago Recibido - Continuar' : 'Cerrar y Listo'}
                            </button>
                        </div>
                    </div>
                )}

                {/* FLOATING TRIP DETAILS MODAL */}
                {showTripDetails && activeRide && (
                    <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto">
                        <div className="bg-[#1A1F2E] w-full max-w-md rounded-[32px] p-0 shadow-2xl border border-white/10 relative overflow-hidden flex flex-col max-h-[80vh]">

                            {/* Header */}
                            <div className="p-6 bg-[#0F172A] border-b border-white/5 flex justify-between items-center">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className="material-symbols-outlined text-blue-500">assignment</span>
                                    Detalles del Viaje
                                </h2>
                                <button
                                    onClick={() => setShowTripDetails(false)}
                                    className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-white text-sm">close</span>
                                </button>
                            </div>

                            {/* Scrollable Content */}
                            <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">

                                {/* HIGO MANDADO SECTION */}
                                {(activeRide.service_type === 'delivery' || activeRide.delivery_info) && (
                                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500">
                                                <span className="material-symbols-outlined">package_2</span>
                                            </div>
                                            <div>
                                                <h3 className="text-yellow-500 font-bold text-sm uppercase tracking-wider">HIGO MANDADO</h3>
                                                <p className="text-xs text-gray-400">
                                                    Paga: <span className="text-white font-bold uppercase">{activeRide.delivery_info?.payer === 'sender' ? 'Remitente (Salida)' : 'Destinatario (Llegada)'}</span>
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            {/* PICKUP / SENDER */}
                                            <div className="bg-yellow-500/5 p-3 rounded-xl border border-yellow-500/10">
                                                <p className="text-[10px] text-yellow-500/70 font-bold uppercase mb-1">📍 QUIEN ENVÍA (REMITENTE)</p>
                                                <p className="text-white font-bold text-sm">{activeRide.delivery_info?.senderName || "Usuario"}</p>
                                                <p className="text-gray-400 text-xs mb-2">{activeRide.delivery_info?.senderPhone || activeRide.passenger_phone || "--"}</p>
                                                <div className="text-xs text-gray-300 bg-black/20 p-2 rounded-lg">
                                                    <span className="font-bold block mb-0.5 text-gray-500">Instrucciones de Retiro:</span>
                                                    {activeRide.delivery_info?.originInstructions || "Llamar al llegar."}
                                                </div>
                                            </div>

                                            {/* DROPOFF / RECEIVER */}
                                            <div className="bg-yellow-500/5 p-3 rounded-xl border border-yellow-500/10">
                                                <p className="text-[10px] text-yellow-500/70 font-bold uppercase mb-1">🏁 QUIEN RECIBE (DESTINATARIO)</p>
                                                <p className="text-white font-bold text-sm">{activeRide.delivery_info?.receiverName || "--"}</p>
                                                <p className="text-gray-400 text-xs mb-2">{activeRide.delivery_info?.receiverPhone || "--"}</p>
                                                <div className="text-xs text-gray-300 bg-black/20 p-2 rounded-lg">
                                                    <span className="font-bold block mb-0.5 text-gray-500">Instrucciones de Entrega:</span>
                                                    {activeRide.delivery_info?.destInstructions || activeRide.instructions || "Entregar en puerta."}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* LOCATIONS */}
                                <div className="space-y-6 relative pl-3">
                                    <div className="absolute left-[5.5px] top-2 bottom-6 w-0.5 bg-slate-700 border-l border-dashed border-slate-600"></div>

                                    <div>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 pl-5">ORIGEN</p>
                                        <div className="flex items-start gap-3">
                                            <div className="w-3 h-3 rounded-full border-2 border-gray-400 bg-[#1A1F2E] z-10 mt-1 shrink-0"></div>
                                            <p className="text-white font-medium text-base leading-tight">{activeRide.pickup}</p>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 pl-5">DESTINO</p>
                                        <div className="flex items-start gap-3">
                                            <div className="w-3 h-3 rounded-full bg-blue-500 z-10 mt-1 shrink-0"></div>
                                            <p className="text-white font-medium text-base leading-tight">{activeRide.dropoff}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* FARE */}
                                <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                                    <p className="text-xs text-gray-400 font-bold uppercase">Tarifa Total</p>
                                    <p className="text-white font-black text-3xl">${activeRide.price}</p>
                                </div>

                            </div>

                            <button
                                onClick={() => setShowTripDetails(false)}
                                className="m-6 mt-0 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold shadow-lg active:scale-95 transition-all"
                            >
                                Entendido, Volver al Mapa
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

// Wrap export with Error Boundary
const SafeDriverDashboard = (props) => (
    <ErrorBoundary>
        <DriverDashboard {...props} />
    </ErrorBoundary>
);

export default SafeDriverDashboard;
