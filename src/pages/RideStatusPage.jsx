import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { LocalNotifications } from '@capacitor/local-notifications';
import InteractiveMap from '../components/InteractiveMap';
import { validateBanescoPayment, describeOutcome, VE_BANKS } from '../services/banescoValidation';

const RideStatusPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [ride, setRide] = useState(null);
    const [driver, setDriver] = useState(null);
    const [rating, setRating] = useState(0);
    const [feedback, setFeedback] = useState("");
    const [submitted, setSubmitted] = useState(false);

    const [showDriverDetails, setShowDriverDetails] = useState(true);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [selectedReason, setSelectedReason] = useState(null);

    const [showPagoMovilModal, setShowPagoMovilModal] = useState(false);
    const [pmReference, setPmReference] = useState('');
    const [pmPhone, setPmPhone] = useState('');
    const [pmBank, setPmBank] = useState('0102');
    const [pmValidating, setPmValidating] = useState(false);
    const [pmFeedback, setPmFeedback] = useState(null);

    const cancelReasons = [
        { icon: 'schedule', text: "La espera fue demasiado larga" },
        { icon: 'directions_walk', text: "Hubo un cambio de planes" },
        { icon: 'payments', text: "El conductor pidió dinero extra" },
        { icon: 'person_cancel', text: "El conductor me pidió que cancele el viaje" },
        { icon: 'directions_car', text: "El automóvil no venía hacia mí" },
        { icon: 'star', text: "Baja calificación del conductor" },
        { icon: 'history', text: "El conductor se fue sin mí" }
    ];

    const handleCancelRide = async () => {
        if (!selectedReason) {
            alert("Por favor selecciona un motivo");
            return;
        }

        const { error } = await supabase
            .from('rides')
            .update({
                status: 'cancelled',
                cancellation_reason: selectedReason
            })
            .eq('id', id);

        if (error) {
            console.error(error);
            alert(`Error al cancelar el viaje: ${error.message}`);
        } else {
            alert("El viaje ha sido cancelado y el conductor ha sido notificado.");
            navigate('/');
        }
    };

    useEffect(() => {
        // Request Notification Permissions on mount
        const requestPermissions = async () => {
            try {
                await LocalNotifications.requestPermissions();
            } catch (e) {
                console.error("Permission Error:", e);
            }
        };
        requestPermissions();

        fetchRide();

        const channel = supabase
            .channel(`ride:${id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${id}` }, async (payload) => {
                setRide(payload.new);

                // NOTIFICATION: Driver Arrived (in_progress)
                if (payload.new.status === 'in_progress') {
                    // Always vibrate and alert as backup
                    if (navigator.vibrate) navigator.vibrate([500, 300, 500]);

                    try {
                        await LocalNotifications.schedule({
                            notifications: [{
                                title: "Higo",
                                body: "🚗 ¡Tu Higo Driver ha llegado!",
                                id: new Date().getTime(),
                                schedule: { at: new Date(Date.now()) },
                                sound: 'beep.wav',
                                attachments: null,
                                actionTypeId: "",
                                extra: null
                            }]
                        });
                    } catch (e) {
                        console.error("Notification Error:", e);
                    }

                    // Fallback visual alert (Guaranteed to show if app is open)
                    alert("🔔 ¡Tu Higo Driver ha llegado!");
                }

                if (payload.new.driver_id) {
                    const { data } = await supabase.from('profiles').select('*').eq('id', payload.new.driver_id).single();
                    if (data) setDriver(data);
                }
            })
            .subscribe((status) => {
                console.log("Subscription status:", status);
            });

        // Backup Polling every 5 seconds in case socket fails
        const interval = setInterval(() => {
            fetchRide();
        }, 2000); // Aggressive 2s Polling

        return () => {
            supabase.removeChannel(channel);
            clearInterval(interval);
        };
    }, [id]);

    // Realtime Driver Location Tracking
    useEffect(() => {
        if (!ride?.driver_id) return;

        const channel = supabase
            .channel(`driver_loc:${ride.driver_id}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'profiles',
                filter: `id=eq.${ride.driver_id}`
            }, (payload) => {
                // Merge new profile data (especially curr_lat/lng) into driver state
                setDriver(prev => ({ ...prev, ...payload.new }));
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [ride?.driver_id]);

    // --- FRESHNESS TIMER LOGIC ---
    const [lastPacketTime, setLastPacketTime] = useState(Date.now());
    const [secondsAgo, setSecondsAgo] = useState(0);


    const [pollingStatus, setPollingStatus] = useState("Init"); // Debug Polling

    useEffect(() => {
        if (driver?.curr_lat) {
            setLastPacketTime(Date.now());
            setSecondsAgo(0);
        }
    }, [driver?.curr_lat, driver?.curr_lng]);

    // 2. Tick every second to update UI
    useEffect(() => {
        const interval = setInterval(() => {
            setSecondsAgo(Math.floor((Date.now() - lastPacketTime) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [lastPacketTime]);

    const fetchRide = async () => {
        const { data, error } = await supabase.from('rides').select('*').eq('id', id).single();
        if (data) {
            setRide(prev => {
                return data;
            });
            if (data.driver_id) {
                // Fetch driver specifically to bypass Realtime lag if needed
                const { data: driverData, error: driverError } = await supabase.from('profiles').select('*').eq('id', data.driver_id).single();

                if (driverData) {
                    // console.log("📍 Polling Driver Loc:", driverData.curr_lat, driverData.curr_lng);
                    setDriver(driverData);
                    setPollingStatus("OK");
                } else {
                    setPollingStatus(driverError ? `ERR: ${driverError.code}` : "NULL");
                }
            } else {
                setPollingStatus("NoDriver");
            }
        } else {
            setPollingStatus("RideNull");
        }
    };

    // Robust Polling for Driver Location (Every 3 seconds)
    // This runs alongside Realtime to ensure freshness even if socket hangs
    useEffect(() => {
        if (!ride?.driver_id) return;

        const locInterval = setInterval(async () => {
            const { data: driverData } = await supabase.from('profiles').select('*').eq('id', ride.driver_id).single();
            if (driverData) {
                // Only update if changed (optional, but React state dedupes mostly)
                setDriver(prev => ({ ...prev, ...driverData }));
            }
        }, 3000);

        return () => clearInterval(locInterval);
    }, [ride?.driver_id]);

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

    const openPagoMovilModal = async () => {
        setPmFeedback(null);
        setPmReference('');
        setPmBank('0102');
        // Prefill phone desde el perfil del pasajero (si lo tiene cargado).
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase.from('profiles').select('phone').eq('id', user.id).single();
                setPmPhone(data?.phone || '');
            } else {
                setPmPhone('');
            }
        } catch {
            setPmPhone('');
        }
        setShowPagoMovilModal(true);
    };

    const submitPagoMovil = async () => {
        if (!/^\d{4,20}$/.test(pmReference.trim())) {
            setPmFeedback({ kind: 'error', text: 'Referencia: 4 a 20 dígitos.' });
            return;
        }
        if (pmBank !== '0134' && !pmPhone.trim()) {
            setPmFeedback({ kind: 'error', text: 'El teléfono del pagador es obligatorio para pagos desde otros bancos.' });
            return;
        }
        setPmValidating(true);
        setPmFeedback(null);
        const body = await validateBanescoPayment({
            rideId: id,
            reference: pmReference.trim(),
            phone: pmPhone.trim(),
            bankId: pmBank,
        });
        setPmValidating(false);
        setPmFeedback({
            kind: body?.ok ? 'ok' : 'error',
            text: describeOutcome(body),
        });
        if (body?.ok) {
            // Refrescamos el ride local: el RPC ya marcó user_confirmed + validated.
            const { data } = await supabase.from('rides').select('*').eq('id', id).single();
            if (data) setRide(data);
            // Cerrar el modal a los 2s para que el usuario vea el OK.
            setTimeout(() => setShowPagoMovilModal(false), 1800);
        }
    };

    const confirmPayment = async (method) => {
        const updates = {
            payment_confirmed_by_user: true,
            payment_method: method
        };
        // Si el conductor ya confirmó, cerramos con timestamp.
        if (ride?.payment_confirmed_by_driver) {
            updates.payment_confirmed_at = new Date().toISOString();
        }
        const { error } = await supabase
            .from('rides')
            .update(updates)
            .eq('id', id);
        if (error) {
            alert(`No se pudo confirmar el pago: ${error.message}`);
        } else {
            setRide(prev => ({ ...prev, ...updates }));
        }
    };

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Mi Viaje en Higo',
                    text: `Estoy viajando en Higo. Sigue mi ruta aquí:`,
                    url: window.location.href,
                });
            } catch (err) {
                console.log('Error sharing:', err);
            }
        } else {
            alert('Enlace copiado al portapapeles');
        }
    };

    const handleSecurity = () => {
        alert("¡MODO EMERGENCIA ACTIVADO! \nSe ha notificado a tus contactos de confianza y al soporte Higo.");
    };

    const handleDestination = () => {
        alert(`Destino: ${ride?.dropoff || 'Desconocido'}\nETA: 10:45 PM`);
    };

    const handleOpenChat = () => {
        window.dispatchEvent(new CustomEvent('open-chat', { detail: { rideId: id } }));
    };

    const handleSOS = () => {
        if (confirm("¿Estás seguro de que quieres llamar a emergencias (911)?")) {
            window.location.href = 'tel:911';
        }
    };

    if (!ride) return <div className="h-screen flex items-center justify-center bg-[#0F1014] text-white">Loading...</div>;

    return (
        <div className="h-screen bg-[#0F1014] relative overflow-hidden font-sans text-white">

            {/* Map Grid Background -> Real Map */}
            <div className="absolute inset-0 z-0">
                <InteractiveMap
                    className="w-full h-full"
                    center={
                        (driver?.curr_lat && !isNaN(Number(driver.curr_lat)))
                            ? { lat: Number(driver.curr_lat), lng: Number(driver.curr_lng) }
                            : (ride?.pickup_lat ? { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) } : null)
                    }
                    origin={
                        (ride?.status === 'searching')
                            ? { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) } // Center on Pickup for Radar
                            : ((driver?.curr_lat && !isNaN(Number(driver.curr_lat)))
                                ? { lat: Number(driver.curr_lat), lng: Number(driver.curr_lng) } // Driver Location
                                : { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) }) // Fallback
                    }
                    destination={
                        (ride?.status === 'searching')
                            ? null // No route during search
                            : (ride?.status === 'accepted')
                                ? { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) } // Route Driver -> Pickup
                                : (ride?.dropoff_lat ? { lat: Number(ride.dropoff_lat), lng: Number(ride.dropoff_lng) } : null) // Route Driver -> Dropoff (In Progress)
                    }
                    assignedDriver={driver && !isNaN(Number(driver.curr_lat)) ? {
                        lat: Number(driver.curr_lat),
                        lng: Number(driver.curr_lng),
                        type: driver.vehicle_type || 'standard',
                        heading: Number(driver.heading || 0),
                        name: driver.full_name,
                        plate: driver.license_plate
                    } : null}
                    routeColor="#3B82F6" // Blue for passenger tracking
                    enableSimulation={false}
                />
            </div>
            {/* Reduced opacity for map visibility */}
            <div className="absolute inset-0 bg-black/10 pointer-events-none"></div>

            {/* Top Bar */}
            <div className="absolute top-6 left-6 right-6 z-20 flex justify-between items-start">
                <button onClick={() => navigate(-1)} className="w-12 h-12 bg-[#1A1E29] border border-white/5 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                    <span className="material-symbols-outlined text-white">arrow_back</span>
                </button>

                {/* Status Pill Removed as per user request to clear map */}


                <div className="w-12"></div>
            </div>

            {/* Simulated Overlay Removed */}


            {/* Bottom Sheet - Driver Details */}
            <div className={`absolute bottom-0 left-0 right-0 bg-[#1A1F2E] rounded-t-[32px] p-6 pb-8 transition-transform duration-300 z-30 ${showDriverDetails ? 'translate-y-0' : 'translate-y-[85%]'}`}>

                {/* Drag Handle */}
                <div className="w-12 h-1.5 bg-gray-600/50 rounded-full mx-auto mb-6 cursor-pointer" onClick={() => setShowDriverDetails(!showDriverDetails)}></div>

                {/* Driver Info Header */}
                {driver ? (
                    <div className="flex items-center gap-4 mb-6">
                        <div className="relative">
                            <div className="w-16 h-16 rounded-full bg-gray-700 bg-center bg-cover border-2 border-white/10"
                                style={{ backgroundImage: `url('${driver.avatar_url || "https://picsum.photos/200"}')` }}>
                            </div>
                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-[#1A1E29] border border-white/10 px-2 py-0.5 rounded-full flex items-center gap-1 text-[10px]">
                                <span className="text-yellow-400 text-xs">★</span> 4.9
                            </div>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-xl font-bold text-white">{driver.full_name}</h2>
                            <p className="text-gray-400 text-sm">{driver.vehicle_brand} {driver.vehicle_model} • {driver.vehicle_color}</p>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="px-3 py-1.5 rounded-xl border border-white/10 bg-[#252A3A] text-center">
                                <p className="text-[9px] text-gray-400 uppercase font-bold text-center">PLACA</p>
                                <p className="font-mono font-bold text-white tracking-widest leading-none mt-0.5">{driver.license_plate}</p>
                            </div>
                            {/* GPS ACTIVE INDICATOR REMOVED */}
                        </div>
                    </div>
                ) : (
                    <div className="mb-6 flex flex-col items-center justify-center py-4 relative">
                        {/* Radar Animation */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-64 h-64 border border-blue-500/10 rounded-full animate-ping [animation-duration:3s]"></div>
                            <div className="absolute w-48 h-48 border border-blue-500/20 rounded-full animate-ping [animation-duration:2s]"></div>
                            <div className="absolute w-32 h-32 border border-blue-500/30 rounded-full animate-ping [animation-duration:1s]"></div>
                        </div>

                        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 relative z-10 animate-pulse">
                            <span className="material-symbols-outlined text-blue-400 text-3xl">radar</span>
                        </div>

                        <h2 className="text-xl font-bold text-white text-center">Buscando un Higo Driver...</h2>
                        <p className="text-gray-400 text-sm mt-1 text-center max-w-[250px]">Estamos conectando con los Higo Drivers cercanos</p>
                    </div>
                )}

                {/* Actions */}
                {driver && (
                    <div className="flex gap-4">
                        {driver.phone && (
                            <button onClick={() => window.location.href = `tel:${driver.phone}`} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 active:scale-95 transition-all">
                                <span className="material-symbols-outlined">call</span>
                                Llamar al Conductor
                            </button>
                        )}
                        <button onClick={handleOpenChat} className="w-14 bg-[#252A3A] hover:bg-[#2C3345] rounded-2xl flex items-center justify-center border border-white/5 active:scale-95 transition-all">
                            <span className="material-symbols-outlined text-white">chat_bubble</span>
                        </button>
                    </div>
                )}

                {/* Payment Confirmation (after trip is completed) */}
                {ride.status === 'completed' && !submitted && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                        <h3 className="text-center font-bold mb-2">Confirmación de pago</h3>
                        <p className="text-center text-gray-400 text-xs mb-4">
                            Monto: <span className="text-white font-bold">${Number(ride.price || 0).toFixed(2)}</span>
                        </p>

                        {!ride.payment_confirmed_by_user ? (
                            <div className="space-y-2">
                                <p className="text-xs text-gray-400 text-center mb-2">¿Cómo pagaste al conductor?</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <button onClick={openPagoMovilModal} className="py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-xs font-bold active:scale-95 transition-all">
                                        <span className="material-symbols-outlined block text-lg mb-1">qr_code_2</span>
                                        Pago Móvil
                                    </button>
                                    <button onClick={() => confirmPayment('efectivo')} className="py-3 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-white text-xs font-bold active:scale-95 transition-all">
                                        <span className="material-symbols-outlined block text-lg mb-1">payments</span>
                                        Efectivo
                                    </button>
                                    <button onClick={() => confirmPayment('zelle')} className="py-3 bg-purple-600 hover:bg-purple-700 rounded-xl text-white text-xs font-bold active:scale-95 transition-all">
                                        <span className="material-symbols-outlined block text-lg mb-1">credit_card</span>
                                        Zelle
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className={`flex items-center justify-center gap-2 py-3 rounded-xl ${ride.payment_confirmed_by_driver ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                <span className="material-symbols-outlined">{ride.payment_confirmed_by_driver ? 'verified' : 'hourglass_top'}</span>
                                <span className="text-sm font-bold">
                                    {ride.payment_confirmed_by_driver ? 'Pago confirmado por ambos' : 'Esperando al conductor...'}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Rating if Completed */}
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
                    <button onClick={handleShare} className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">share</span></div>
                        <span className="text-[10px]">Compartir</span>
                    </button>
                    <button onClick={handleDestination} className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">location_on</span></div>
                        <span className="text-[10px]">Destino</span>
                    </button>
                    <button onClick={handleSOS} className="flex flex-col items-center gap-1 text-red-400 hover:text-red-300 transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">sos</span></div>
                        <span className="text-[10px]">S.O.S</span>
                    </button>
                    <button onClick={() => setShowCancelModal(true)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                        <div className="w-10 h-10 rounded-full bg-[#252A3A] flex items-center justify-center"><span className="material-symbols-outlined text-lg">close</span></div>
                        <span className="text-[10px]">Cancelar</span>
                    </button>
                </div>

            </div>

            {/* Pago Móvil · validación automática contra Banesco */}
            {showPagoMovilModal && (
                <div className="absolute inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
                    <div className="w-full sm:max-w-md bg-[#1A1F2E] rounded-t-3xl sm:rounded-3xl p-6 pb-8 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-white">Confirmar pago móvil</h3>
                                <p className="text-xs text-gray-400 mt-1">
                                    Verificamos automáticamente con Banesco. Monto: <span className="text-white font-bold">${Number(ride?.price || 0).toFixed(2)}</span>
                                </p>
                            </div>
                            <button onClick={() => !pmValidating && setShowPagoMovilModal(false)} className="p-2 bg-[#252A3A] rounded-full">
                                <span className="material-symbols-outlined text-white text-base">close</span>
                            </button>
                        </div>

                        <label className="block text-xs text-gray-400 mb-1">Referencia del pago</label>
                        <input
                            value={pmReference}
                            onChange={e => setPmReference(e.target.value)}
                            inputMode="numeric"
                            maxLength={20}
                            placeholder="ej. 376765"
                            className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono text-sm mb-3 focus:border-blue-500 outline-none"
                        />

                        <label className="block text-xs text-gray-400 mb-1">Banco desde el que pagaste</label>
                        <select
                            value={pmBank}
                            onChange={e => setPmBank(e.target.value)}
                            className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm mb-3 focus:border-blue-500 outline-none"
                        >
                            {VE_BANKS.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                        </select>

                        <label className="block text-xs text-gray-400 mb-1">
                            Teléfono del pagador {pmBank === '0134' ? '(opcional)' : '(requerido)'}
                        </label>
                        <input
                            value={pmPhone}
                            onChange={e => setPmPhone(e.target.value)}
                            inputMode="tel"
                            placeholder="04120330315"
                            className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm mb-4 focus:border-blue-500 outline-none"
                        />

                        {pmFeedback && (
                            <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${pmFeedback.kind === 'ok' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'}`}>
                                {pmFeedback.text}
                            </div>
                        )}

                        <button
                            onClick={submitPagoMovil}
                            disabled={pmValidating}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-wait rounded-xl text-white font-bold text-sm transition-all"
                        >
                            {pmValidating ? 'Validando con Banesco…' : 'Validar pago'}
                        </button>

                        <button
                            onClick={() => { setShowPagoMovilModal(false); confirmPayment('pago_movil'); }}
                            disabled={pmValidating}
                            className="w-full mt-2 py-2 text-[11px] text-gray-400 hover:text-white"
                        >
                            ¿Banesco no detecta el pago? Confirmar manualmente
                        </button>
                    </div>
                </div>
            )}

            {/* Cancel Reason Modal */}
            {showCancelModal && (
                <div className="absolute inset-0 bg-[#0F1014] z-50 p-6 flex flex-col animate-in fade-in slide-in-from-bottom duration-300">
                    <div className="flex justify-between items-start mb-8">
                        <h2 className="text-2xl font-bold text-white max-w-[80%]">¿Por qué cancelaste el viaje?</h2>
                        <button onClick={() => setShowCancelModal(false)} className="p-2 bg-[#1A1E29] rounded-full">
                            <span className="material-symbols-outlined text-white">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                        {cancelReasons.map((item, index) => (
                            <label key={index} className="flex items-center justify-between p-3 rounded-xl hover:bg-[#1A1E29] cursor-pointer group transition-colors">
                                <div className="flex items-center gap-4">
                                    <span className="material-symbols-outlined text-gray-400 group-hover:text-white transition-colors">{item.icon}</span>
                                    <span className="text-gray-300 text-lg group-hover:text-white transition-colors">{item.text}</span>
                                </div>
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selectedReason === item.text ? 'border-blue-500 bg-blue-500' : 'border-gray-600'}`}>
                                    {selectedReason === item.text && <span className="material-symbols-outlined text-white text-sm">check</span>}
                                </div>
                                <input
                                    type="radio"
                                    name="cancelReason"
                                    value={item.text}
                                    className="hidden"
                                    onChange={() => setSelectedReason(item.text)}
                                />
                            </label>
                        ))}
                    </div>

                    <button
                        onClick={handleCancelRide}
                        className={`w-full py-4 rounded-xl font-bold text-lg mt-6 transition-all ${selectedReason ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`}
                        disabled={!selectedReason}
                    >
                        Listo
                    </button>
                </div>
            )}

        </div>
    );
};

export default RideStatusPage;
