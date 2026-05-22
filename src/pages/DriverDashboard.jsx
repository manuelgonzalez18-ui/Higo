import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getUserProfile } from '../services/supabase';
import { useNavigate } from 'react-router-dom';
import InteractiveMap from '../components/InteractiveMap';
import { useDriverMembership } from '../hooks/useDriverMembership';
import { useBackgroundLocation } from '../hooks/useBackgroundLocation';
import { useDriverActiveTrip } from '../hooks/useDriverActiveTrip';
import { useVoiceNavigation } from '../hooks/useVoiceNavigation';

// Modular overlays
import IncomingRequestCard from '../components/driver/IncomingRequestCard';
import PaymentReceiptModal from '../components/driver/PaymentReceiptModal';
import TripInfoPanel from '../components/driver/TripInfoPanel';
import DeliveryPodCapture from '../components/DeliveryPodCapture';
import { toast } from '../components/Toast';
import ErrorBoundary from '../components/ErrorBoundary';

// Utilities
import { getDistanceFromLatLonInKm } from '../utils/geoUtils';
import { LocalNotifications } from '@capacitor/local-notifications';
import { startLoopingRequestAlert, stopLoopingRequestAlert } from '../services/notificationService';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

// H2.3 — la clase ErrorBoundary que vivía inline acá se extrajo a
// src/components/ErrorBoundary.jsx para reusarla globalmente desde
// App.jsx. DriverDashboard sigue envuelto en ella (SafeDriverDashboard
// más abajo) pero ahora consume la versión generalizada que reporta
// a public.client_errors.

const DriverDashboard = () => {
    const navigate = useNavigate();
    const [isOnline, setIsOnline] = useState(false);
    const [requests, setRequests] = useState([]);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [subscriptionStatus, setSubscriptionStatus] = useState('DISCONNECTED');
    const membershipNotifiedRef = useRef(false);

    const { daysLeft: membershipDaysLeft, severity: membershipSeverity } = useDriverMembership(profile?.id);

    // Active Trip Hook orchestration
    const {
        activeRide,
        setActiveRide,
        navStep,
        arrivalTime,
        waitElapsedSec,
        waitFee,
        completing,
        showPaymentQR,
        setShowPaymentQR,
        podRequired,
        setPodRequired,
        showCodConfirm,
        setShowCodConfirm,
        instruction,
        navInfo,
        setNavInfo,
        voiceEnabled,
        setVoiceEnabled,
        speak,
        handleAcceptRide,
        handleMarkArrival,
        handleCompleteStep,
        confirmDriverPayment,
        handleQRClosed,
        closeRide
    } = useDriverActiveTrip(profile, navigate, setRequests);

    // Notification of membership expiration (Web Notification API)
    useEffect(() => {
        if (membershipDaysLeft === null || membershipDaysLeft > 7 || membershipNotifiedRef.current) return;
        membershipNotifiedRef.current = true;

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const title = membershipDaysLeft <= 0
                ? 'Tu membresía Higo venció'
                : membershipDaysLeft === 1
                ? 'Tu membresía Higo vence mañana'
                : `Tu membresía Higo vence en ${membershipDaysLeft} días`;

            const n = new Notification(title, {
                body: 'Abrí Higo Pay para renovarla y seguir activo.',
                icon: '/higo-icon.svg',
                tag: 'membership-expiry',
                renotify: false,
            });
            n.onclick = () => {
                window.focus();
                window.location.hash = '/higo-pay';
                n.close();
            };
        }
    }, [membershipDaysLeft]);

    // Native notifications play loop audio backup helper
    const notifyNewRequest = useCallback(async (ride) => {
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000]);
        speak("Nueva solicitud de viaje");

        try {
            const audio = new Audio('https://www.soundjay.com/buttons/beep-01a.mp3');
            audio.volume = 1.0;
            audio.play().catch(() => {});
        } catch (e) { /* audio fallback */ }

        try {
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
                        title: "🚗 ¡Nueva solicitud Higo!",
                        body: `$${ride.price} - ${ride.dropoff}${distText}`,
                        id: new Date().getTime(),
                        schedule: { at: new Date(Date.now() + 50) },
                        channelId: 'higo_rides_v12',
                        actionTypeId: 'RIDE_REQUEST_ACTIONS',
                        extra: { rideId: ride.id },
                        visibility: 1,
                        priority: 2,
                        sound: 'alert_sound.wav'
                    }
                ]
            });
        } catch (e) {
            console.error("Local Notification fail:", e);
        }
    }, [speak]);

    // Handle parsing & filtering of requests
    const processRequests = useCallback((incomingRides, replace = false) => {
        if (!profile || activeRide) return;

        const newRides = incomingRides.map(ride => {
            let dInfo = ride.delivery_info;
            if (typeof dInfo === 'string') {
                try { dInfo = JSON.parse(dInfo); } catch (e) { console.error("Error parsing delivery_info", e); }
            }

            let deliveryInstructions = null;
            if (dInfo && typeof dInfo === 'object') {
                deliveryInstructions = dInfo.destInstructions || dInfo.instructions || dInfo.description;
            } else if (ride.delivery_instructions) {
                deliveryInstructions = ride.delivery_instructions;
            }

            return {
                ...ride,
                delivery_info: dInfo,
                instructions: deliveryInstructions,
                delivery_instructions: deliveryInstructions
            };
        });

        let driverVehicleType = profile.vehicle_type ? profile.vehicle_type.toLowerCase() : 'standard';
        if (driverVehicleType === 'carro' || driverVehicleType === 'auto') driverVehicleType = 'standard';
        if (driverVehicleType === 'camioneta') driverVehicleType = 'van';

        const checkRide = (ride) => {
            const rideType = ride.ride_type ? ride.ride_type.toLowerCase() : 'standard';

            let isMatch = false;
            if (driverVehicleType === 'moto' && rideType === 'moto') isMatch = true;
            else if ((driverVehicleType === 'van' || driverVehicleType === 'camioneta') && rideType === 'van') isMatch = true;
            else if (driverVehicleType === 'standard' && (rideType === 'standard' || rideType === 'car')) isMatch = true;

            if (!isMatch) return false;
            if (!ride.pickup_lat) return true;

            if (lastLocationRef.current) {
                const dist = getDistanceFromLatLonInKm(
                    lastLocationRef.current.latitude,
                    lastLocationRef.current.longitude,
                    ride.pickup_lat,
                    ride.pickup_lng
                );
                return dist <= 10;
            }
            return true;
        };

        const filtered = newRides.filter(checkRide);

        setRequests(prev => {
            if (replace) return filtered;
            const combined = [...filtered, ...prev];
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            return unique.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        });

        if (!replace && filtered.length > 0) {
            LocalNotifications.checkPermissions().then(status => {
                if (status.display !== 'granted') {
                    LocalNotifications.requestPermissions();
                }
            });

            speak("Nueva solicitud de viaje");
            startLoopingRequestAlert();
            notifyNewRequest(filtered[0]);
        }
    }, [profile, activeRide, notifyNewRequest, speak]);

    // Geolocation Hook orchestration
    const {
        currentLoc,
        heading,
        lastSentTimeRef,
        lastLocationRef
    } = useBackgroundLocation(profile, isOnline, activeRide, processRequests);

    // Turn-by-turn voice navigation. Sólo activa cuando hay un viaje
    // activo (no decimos nada al chofer mientras espera solicitudes).
    // El hook anuncia cada maniobra a 300m, vuelve a anunciar a 50m,
    // y dice "Has llegado a tu destino" al final de la ruta.
    useVoiceNavigation({
        steps:           navInfo?.steps,
        currentLocation: currentLoc,
        enabled:         !!activeRide,
        speak,
    });

    // Initial User Authentication and session checks
    const checkUser = async () => {
        const userProfile = await getUserProfile();
        if (!userProfile || userProfile.role !== 'driver') {
            toast.error("Acceso denegado: Solo conductores.");
            navigate('/');
            return;
        }

        const localSessionId = localStorage.getItem('session_id');
        if (userProfile.current_session_id && localSessionId !== userProfile.current_session_id) {
            toast.warning("⚠️ Se ha iniciado sesión en otro dispositivo. Cerrando sesión...");
            await supabase.auth.signOut();
            navigate('/auth');
            return;
        }

        setProfile(userProfile);
        setLoading(false);
    };

    // Notification Action listener on startup (Native platform only)
    useEffect(() => {
        const setupNotifications = async () => {
            if (Capacitor.isNativePlatform()) {
                const perm = await LocalNotifications.requestPermissions();
                if (perm.display !== 'granted') console.warn('Permissions denied');

                await LocalNotifications.createChannel({
                    id: 'higo_rides_v12',
                    name: 'New Ride Requests (High Priority)',
                    importance: 5,
                    visibility: 1,
                    sound: 'alert_sound.wav',
                    vibration: true
                });

                await LocalNotifications.registerActionTypes({
                    types: [
                        {
                            id: 'RIDE_REQUEST_ACTIONS',
                            actions: [
                                {
                                    id: 'ACCEPT',
                                    title: '✅ Aceptar Viaje',
                                    foreground: true
                                }
                            ]
                        }
                    ]
                });
            }
        };

        setupNotifications();

        let listenerHandle;
        const registerListener = async () => {
            if (Capacitor.isNativePlatform()) {
                listenerHandle = await LocalNotifications.addListener('localNotificationActionPerformed', async (notification) => {
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
                            } catch (e) { console.error("Accept fail:", e); }
                        }
                    }
                });
            }
        };

        registerListener();
        checkUser();

        return () => {
            if (listenerHandle) listenerHandle.remove();
        };
    }, []);

    // Deep link callback Accept button on native app
    useEffect(() => {
        const handleDeepLink = async (event) => {
            if (event.url.includes('higo://accept')) {
                const url = new URL(event.url);
                const rideId = url.searchParams.get('rideId') || event.url.split('rideId=')[1];

                if (rideId) {
                    try {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (user) {
                            await supabase.from('rides')
                                .update({ status: 'accepted', driver_id: user.id })
                                .eq('id', rideId)
                                .eq('status', 'requested');

                            toast.success("¡Viaje aceptado desde notificación!");
                            window.location.reload();
                        }
                    } catch (e) {
                        console.error("Deep link accept error:", e);
                    }
                }
            }
        };

        App.addListener('appUrlOpen', handleDeepLink);

        App.getLaunchUrl().then(launchUrl => {
            if (launchUrl && launchUrl.url) {
                handleDeepLink(launchUrl);
            }
        });

        return () => {
            App.removeAllListeners('appUrlOpen');
        };
    }, []);

    // Realtime Session Multi-Device Checker
    useEffect(() => {
        if (!profile?.id) return;

        const channel = supabase
            .channel(`profile:${profile.id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` }, (payload) => {
                const newSessionId = payload.new.current_session_id;
                const localSessionId = localStorage.getItem('session_id');

                if (newSessionId && newSessionId !== localSessionId) {
                    toast.warning("⚠️ Tu sesión ha sido cerrada porque se ingresó desde otro equipo.");
                    supabase.auth.signOut().then(() => navigate('/auth'));
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [profile?.id]);

    // Realtime listener for incoming trip requests
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
                const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
                const { data } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('status', 'requested')
                    .gte('created_at', tenMinAgo)
                    .order('created_at', { ascending: false })
                    .limit(20);

                if (data) {
                    processRequests(data, true);
                }
            };

            channel = supabase
                .channel('public:rides')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, (payload) => {
                    if (payload.new.status === 'requested') {
                        processRequests([payload.new], false);
                    }
                })
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (payload) => {
                    if (payload.new.status !== 'requested') {
                        setRequests(prev => prev.filter(r => r.id !== payload.new.id));
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

    // Expire requests older than 5 mins
    useEffect(() => {
        if (!isOnline) return;
        const id = setInterval(() => {
            const cutoff = Date.now() - 5 * 60 * 1000;
            setRequests(prev => prev.filter(r => new Date(r.created_at).getTime() > cutoff));
        }, 60000);
        return () => clearInterval(id);
    }, [isOnline]);

    // Monitor sound loops when requests list transitions to empty
    useEffect(() => {
        if (requests.length === 0) {
            stopLoopingRequestAlert();
        }
    }, [requests]);

    // Toggle Driver Status Online / Offline
    const toggleOnline = async () => {
        if (!isOnline) {
            if (profile.subscription_status === 'suspended') {
                if (window.confirm("⚠️ Tu membresía está vencida. Renuévala desde Higo Pay para volver a operar.\n\n¿Ir a renovar ahora?")) {
                    navigate('/higo-pay');
                }
                return;
            }

            try {
                const { error } = await supabase.from('profiles')
                    .update({ status: 'online', last_location_update: new Date() })
                    .eq('id', profile.id);

                if (error) throw error;
                setIsOnline(true);
                speak("Conectado. Buscando solicitudes.");
            } catch (e) {
                console.error("Error going online:", e);
                toast.error("Error al conectar: " + e.message);
            }
        } else {
            try {
                await supabase.from('profiles')
                    .update({ status: 'offline' })
                    .eq('id', profile.id);

                setIsOnline(false);
                speak("Desconectado.");
            } catch (e) {
                console.error("Error going offline:", e);
            }
        }
    };

    const handleLogout = async () => {
        if (activeRide) {
            toast.warning("Completa el viaje actual antes de salir.");
            return;
        }
        await supabase.auth.signOut();
        navigate('/');
    };

    if (loading) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-[#020617] text-white gap-3 font-sans">
                <span className="material-symbols-outlined text-4xl animate-spin text-blue-500">progress_activity</span>
                <span className="font-bold text-sm tracking-wider uppercase text-slate-400">Cargando Perfil...</span>
            </div>
        );
    }

    const routeDataHandler = (data) => {
        setNavInfo(data);
    };

    return (
        <div className="h-screen w-full relative bg-[#020617] text-white overflow-hidden font-sans">
            {/* Background Interactive Map */}
            <div className="absolute inset-0 z-0">
                <InteractiveMap
                    origin={
                        (isOnline || activeRide) && (lastLocationRef.current || currentLoc || profile?.curr_lat)
                            ? {
                                lat: lastLocationRef.current?.latitude || currentLoc?.lat || Number(profile?.curr_lat),
                                lng: lastLocationRef.current?.longitude || currentLoc?.lng || Number(profile?.curr_lng)
                            }
                            : null
                    }
                    destination={
                        activeRide && navStep === 1
                            ? { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng }
                            : (activeRide && navStep === 2
                                ? { lat: activeRide.dropoff_lat, lng: activeRide.dropoff_lng }
                                : null)
                    }
                    assignedDriver={
                        (currentLoc || lastLocationRef.current) && profile ? {
                            lat: lastLocationRef.current?.latitude || currentLoc?.lat,
                            lng: lastLocationRef.current?.longitude || currentLoc?.lng,
                            heading: heading || profile?.heading || 0,
                            type: profile.vehicle_type || 'standard',
                            name: "Tu Vehículo",
                            plate: profile.license_plate
                        } : null
                    }
                    destinationIconType={navStep === 1 ? 'passenger' : 'flag'}
                    onRouteData={routeDataHandler}
                    routeColor={navStep === 1 ? "#22C55E" : "#8A2BE2"}
                    isDriver={true}
                    vehicleType={profile?.vehicle_type || 'standard'}
                    enableSimulation={false}
                    heading={heading}
                    activeRideId={activeRide?.id}
                    navStep={navStep}
                />
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"></div>
            </div>

            {/* Content Overlays */}
            <div className="relative z-10 h-full flex flex-col pointer-events-none justify-between">
                
                {/* Header Controls (Only pointer events are auto) */}
                <div className="p-4 flex justify-between items-start pointer-events-auto">
                    {!activeRide && (
                        <div className="bg-[#0F172A]/90 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3 shadow-lg transition-all duration-300">
                            <div className={`w-2.5 h-2.5 rounded-full ${isOnline && subscriptionStatus === 'SUBSCRIBED' ? 'bg-emerald-500 animate-pulse' : isOnline ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`}></div>
                            <span className="font-bold text-xs tracking-wider uppercase">
                                {!isOnline ? 'Desconectado' :
                                    subscriptionStatus === 'SUBSCRIBED' ? 'En línea' :
                                        subscriptionStatus === 'CONNECTING' ? 'Conectando...' :
                                            'Reconectando...'}
                            </span>
                        </div>
                    )}

                    {profile?.subscription_status === 'suspended' && (
                        <button
                            onClick={() => navigate('/higo-pay')}
                            className="bg-red-500/20 hover:bg-red-500/30 backdrop-blur-md px-3 py-2 rounded-full border border-red-500/40 flex items-center gap-2 shadow-lg ml-2 active:scale-95 transition-all"
                        >
                            <span className="material-symbols-outlined text-red-400 text-base">error</span>
                            <span className="font-bold text-xs text-red-300 tracking-wide">Renovar membresía</span>
                        </button>
                    )}

                    {profile?.subscription_status === 'active' && membershipDaysLeft !== null && membershipDaysLeft > 0 && membershipDaysLeft <= 7 && (
                        <button
                            onClick={() => navigate('/higo-pay')}
                            className={`backdrop-blur-md px-3 py-2 rounded-full border flex items-center gap-2 shadow-lg ml-2 active:scale-95 transition-all ${
                                membershipSeverity === 'critical'
                                    ? 'bg-red-500/20 hover:bg-red-500/30 border-red-500/40'
                                    : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40'
                            }`}
                        >
                            <span className={`material-symbols-outlined text-base ${
                                membershipSeverity === 'critical' ? 'text-red-400' : 'text-amber-400'
                            }`}>schedule</span>
                            <span className={`font-bold text-xs tracking-wide ${
                                membershipSeverity === 'critical' ? 'text-red-300' : 'text-amber-300'
                            }`}>
                                Vence en {membershipDaysLeft} {membershipDaysLeft === 1 ? 'día' : 'días'}
                            </span>
                        </button>
                    )}

                    <div className="flex gap-2 ml-auto">
                        <button onClick={() => navigate('/higo-pay')} className="w-10 h-10 bg-[#0F172A]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg hover:bg-cyan-500/20 transition-colors" title="Higo Pay">
                            <span className="material-symbols-outlined text-cyan-400 text-lg">wallet</span>
                        </button>
                        <button onClick={() => navigate('/driver/stats')} className="w-10 h-10 bg-[#0F172A]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg hover:bg-emerald-500/20 transition-colors" title="Mis estadísticas">
                            <span className="material-symbols-outlined text-white text-lg">bar_chart</span>
                        </button>
                        <button onClick={handleLogout} className="w-10 h-10 bg-[#0F172A]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-lg hover:bg-red-500/20 transition-colors" title="Salir">
                            <span className="material-symbols-outlined text-white text-lg">logout</span>
                        </button>
                    </div>
                </div>

                {/* TRIP NAVIGATION HUD AND ACTION CARD */}
                {activeRide && !showPaymentQR && (
                    <TripInfoPanel
                        activeRide={activeRide}
                        navStep={navStep}
                        arrivalTime={arrivalTime}
                        waitElapsedSec={waitElapsedSec}
                        waitFee={waitFee}
                        completing={completing}
                        navInfo={navInfo}
                        voiceEnabled={voiceEnabled}
                        setVoiceEnabled={setVoiceEnabled}
                        handleMarkArrival={handleMarkArrival}
                        handleCompleteStep={handleCompleteStep}
                        navigate={navigate}
                    />
                )}

                {/* INCOMING PENDING REQUEST DRAWER */}
                {!activeRide && requests.length > 0 && (
                    <div className="p-4 w-full max-w-md mx-auto pointer-events-auto mt-auto">
                        <IncomingRequestCard
                            request={requests[0]}
                            onAccept={handleAcceptRide}
                            onDecline={(id) => {
                                setRequests(prev => prev.filter(r => r.id !== id));
                            }}
                        />
                    </div>
                )}

                {/* ONLINE/OFFLINE ACTION BUTTON (Idle state) */}
                {!activeRide && requests.length === 0 && (
                    <div className="p-6 w-full max-w-sm mx-auto pointer-events-auto mt-auto">
                        <button
                            onClick={toggleOnline}
                            className={`w-full py-4 rounded-2xl font-bold text-base shadow-2xl transition-all duration-300 flex items-center justify-center gap-2 active:scale-95 border ${isOnline
                                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/10 border-red-400/20'
                                : 'bg-[#0F172A]/95 hover:bg-slate-800 text-white border-white/10 shadow-lg'
                                }`}
                        >
                            <span className="material-symbols-outlined text-lg">{isOnline ? 'power_settings_new' : 'bolt'}</span>
                            {isOnline ? 'Desconectarse' : 'Conectarse (Ir Online)'}
                        </button>
                    </div>
                )}
            </div>

            {/* BILLING / PAYMENT POPUP MODAL */}
            <PaymentReceiptModal
                show={showPaymentQR}
                activeRide={activeRide}
                profile={profile}
                navStep={navStep}
                confirmDriverPayment={confirmDriverPayment}
                handleQRClosed={handleQRClosed}
            />

            {/* POD obligatorio antes de transición de envío */}
            {podRequired && activeRide && (
                <DeliveryPodCapture
                    rideId={activeRide.id}
                    kind={podRequired}
                    hideCancel={true}
                    onUploaded={(path) => {
                        const column = podRequired === 'pickup' ? 'pickup_pod_url' : 'delivery_pod_url';
                        setActiveRide({ ...activeRide, [column]: path });
                        setPodRequired(null);
                        setTimeout(() => handleCompleteStep(), 0);
                    }}
                />
            )}

            {/* COD: confirmar cobro en efectivo antes de cerrar el envío */}
            {showCodConfirm && activeRide && (
                <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 text-left pointer-events-auto">
                    <div className="bg-[#0a101f] rounded-3xl border border-amber-500/30 p-6 w-full max-w-sm">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <span className="material-symbols-outlined text-amber-400 text-2xl">payments</span>
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white">Cobro Contra Entrega</h2>
                                <p className="text-xs text-gray-400">Antes de marcar entregado</p>
                            </div>
                        </div>
                        <p className="text-sm text-gray-200 mb-1">El remitente declaró un cobro de:</p>
                        <p className="text-3xl font-extrabold text-amber-400 mb-3 font-sans">USD {Number(activeRide.cod_amount).toFixed(2)}</p>
                        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
                            Cobrá este monto <strong>en efectivo</strong> al destinatario al entregar.
                            Higo no maneja este dinero — queda con vos. Solo se audita en la app.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowCodConfirm(false)}
                                className="flex-1 py-3 rounded-full border border-gray-700 text-gray-300 font-bold text-sm"
                            >
                                Aún no
                            </button>
                            <button
                                onClick={async () => {
                                    const { error } = await supabase
                                        .from('rides')
                                        .update({ cod_collected: true })
                                        .eq('id', activeRide.id);
                                    if (error) {
                                        toast.error(`No se pudo marcar cobrado: ${error.message}`);
                                        return;
                                    }
                                    setActiveRide({ ...activeRide, cod_collected: true, cod_collected_at: new Date().toISOString() });
                                    setShowCodConfirm(false);
                                    setTimeout(() => handleCompleteStep(), 0);
                                }}
                                className="flex-1 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-black font-bold text-sm"
                            >
                                Cobré
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const SafeDriverDashboard = () => (
    <ErrorBoundary source="DriverDashboard">
        <DriverDashboard />
    </ErrorBoundary>
);

export default SafeDriverDashboard;
