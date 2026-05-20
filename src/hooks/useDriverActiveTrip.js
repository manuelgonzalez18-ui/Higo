import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { stopLoopingRequestAlert } from '../services/notificationService';
import { toast } from '../components/Toast';
import { sendDeliveryMilestone } from '../utils/sendDeliveryMilestone';

// Wait fee config
const WAIT_RATES_PER_MIN = { moto: 0.05, standard: 0.08, van: 0.10 };
const FREE_WAIT_MINUTES = 3;

const computeWaitFee = (rideType, seconds) => {
    const rate = WAIT_RATES_PER_MIN[rideType] ?? WAIT_RATES_PER_MIN.standard;
    const billableMin = Math.max(0, seconds / 60 - FREE_WAIT_MINUTES);
    return parseFloat((billableMin * rate).toFixed(2));
};

export function useDriverActiveTrip(profile, navigate, setRequests) {
    const [activeRide, setActiveRide] = useState(null);
    const [navStep, setNavStep] = useState(0); // 0: Idle, 1: To Pickup, 2: To Dropoff
    const [arrivalTime, setArrivalTime] = useState(null);
    const [waitElapsedSec, setWaitElapsedSec] = useState(0);
    const [waitFee, setWaitFee] = useState(0);
    const [completing, setCompleting] = useState(false);
    const [showPaymentQR, setShowPaymentQR] = useState(false);
    const [podRequired, setPodRequired] = useState(null); // 'pickup' | 'delivery' | null
    const [showCodConfirm, setShowCodConfirm] = useState(false); // gate cobro COD
    const [instruction, setInstruction] = useState("Esperando viajes...");
    const [navInfo, setNavInfo] = useState(null);
    const [voiceEnabled, setVoiceEnabled] = useState(true);

    const wakeLockRef = useRef(null);
    const lastInstruction = useRef("");
    const activeRideRef = useRef(null);

    useEffect(() => {
        activeRideRef.current = activeRide;
    }, [activeRide]);

    // Keep voice instruction memory synchronized
    useEffect(() => {
        if (voiceEnabled) {
            lastInstruction.current = "";
        }
    }, [voiceEnabled]);

    // Text to Speech Voice Guidance
    const speak = useCallback(async (text) => {
        setInstruction(text);
        if (!voiceEnabled) return;

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
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            window.speechSynthesis.speak(utterance);
        }
    }, [voiceEnabled]);

    // Screen Wake Lock
    useEffect(() => {
        const requestWakeLock = async () => {
            const isOnline = !!profile;
            if ('wakeLock' in navigator && (isOnline || activeRide)) {
                try {
                    if (wakeLockRef.current) await wakeLockRef.current.release();
                    wakeLockRef.current = await navigator.wakeLock.request('screen');

                    const handleVisibilityChange = async () => {
                        if (wakeLockRef.current !== null && document.visibilityState === 'visible') {
                            wakeLockRef.current = await navigator.wakeLock.request('screen');
                        }
                    };
                    document.addEventListener('visibilitychange', handleVisibilityChange);
                    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
                } catch (err) {
                    console.warn('Wake Lock Error:', err);
                }
            } else if (wakeLockRef.current) {
                wakeLockRef.current.release().then(() => {
                    wakeLockRef.current = null;
                });
            }
        };

        requestWakeLock();

        return () => {
            if (wakeLockRef.current) {
                wakeLockRef.current.release();
            }
        };
    }, [profile, activeRide]);

    // Tick the wait timer
    useEffect(() => {
        if (!arrivalTime) return;
        const id = setInterval(() => {
            setWaitElapsedSec(Math.floor((Date.now() - arrivalTime) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [arrivalTime]);

    // Restore active ride on load
    useEffect(() => {
        if (!profile?.id) return;

        const restoreActiveRide = async () => {
            const { data } = await supabase
                .from('rides')
                .select('*')
                .eq('driver_id', profile.id)
                .in('status', ['accepted', 'in_progress'])
                .maybeSingle();

            if (data) {
                setActiveRide(data);
                setNavStep(data.status === 'accepted' ? 1 : 2);
            }
        };
        restoreActiveRide();
    }, [profile?.id]);

    // Listen for cancellations
    useEffect(() => {
        if (!activeRide) return;

        const channel = supabase
            .channel(`ride_cancel:${activeRide.id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload) => {
                if (payload.new.id === activeRide.id && payload.new.status === 'cancelled') {
                    if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
                    speak("El viaje ha sido cancelado por el pasajero.");
                    toast.error("El pasajero ha cancelado el viaje. Volviendo al mapa...");
                    window.location.reload();
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [activeRide, speak]);

    // Actions
    const handleAcceptRide = async (ride) => {
        if (profile?.subscription_status === 'suspended') {
            if (window.confirm("⚠️ Tu membresía está vencida. Necesitás renovarla para aceptar viajes.\n\n¿Ir a Higo Pay ahora?")) {
                navigate('/higo-pay');
            }
            return;
        }
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
                toast.error("⚠️ Lo sentimos, este viaje ya fue tomado por otro conductor.");
                if (setRequests) setRequests(prev => prev.filter(r => r.id !== ride.id));
                return;
            }

            setActiveRide(ride);
            if (setRequests) setRequests([]);
            stopLoopingRequestAlert();
            setNavStep(1);
            speak(`Viaje aceptado. Navegando a ${ride.pickup}`);
        } catch (error) {
            console.error("Accept Ride Error:", error);
            toast.error("Error al aceptar viaje: " + error.message);
        }
    };

    const handleMarkArrival = () => {
        if (arrivalTime) return;
        setArrivalTime(Date.now());
        setWaitElapsedSec(0);
        setWaitFee(0);
        speak("Llegada marcada. Esperando al pasajero.");
    };

    const handleCompleteStep = async () => {
        if (!activeRide) return;
        const isDelivery = activeRide.service_type === 'delivery' || activeRide.delivery_info;

        // Gate POD para envíos: foto obligatoria antes de cada transición.
        if (isDelivery) {
            if (navStep === 1 && !activeRide.pickup_pod_url) {
                setPodRequired('pickup');
                return;
            }
            if (navStep === 2) {
                // E3.1: marcar "Llegué al destino" antes de poder entregar
                if (!activeRide.arrived_at_dropoff_at) {
                    const { error } = await supabase
                        .from('rides')
                        .update({ status: 'arrived_at_dropoff' })
                        .eq('id', activeRide.id);
                    if (error) {
                        toast.error(`No se pudo marcar llegada: ${error.message}`);
                        return;
                    }
                    const arrivedAt = new Date().toISOString();
                    setActiveRide({ ...activeRide, status: 'arrived_at_dropoff', arrived_at_dropoff_at: arrivedAt });
                    speak('Llegada al destino marcada. Coordiná entrega con el destinatario.');
                    sendDeliveryMilestone({ rideId: activeRide.id, status: 'arrived_at_dropoff' });
                    return;
                }
                // E4.1 gate: COD pendiente
                if ((Number(activeRide.cod_amount) || 0) > 0 && !activeRide.cod_collected) {
                    setShowCodConfirm(true);
                    return;
                }
                // POD obligatorio para cerrar
                if (!activeRide.delivery_pod_url) {
                    setPodRequired('delivery');
                    return;
                }
            }
        }

        if (navStep === 1) {
            const elapsedSec = arrivalTime ? Math.floor((Date.now() - arrivalTime) / 1000) : 0;
            const fee = arrivalTime ? computeWaitFee(activeRide.ride_type, elapsedSec) : 0;
            setWaitFee(fee);

            const isSenderPayer = isDelivery && (activeRide.delivery_info?.payer === 'sender' || activeRide.payer === 'sender');

            if (isSenderPayer) {
                if (fee > 0) {
                    const finalPrice = parseFloat(((Number(activeRide.price) || 0) + fee).toFixed(2));
                    await supabase.from('rides').update({
                        wait_seconds: elapsedSec,
                        wait_fee: fee,
                        price: finalPrice
                    }).eq('id', activeRide.id);
                    setActiveRide({ ...activeRide, price: finalPrice, wait_fee: fee, wait_seconds: elapsedSec });
                }
                speak("Llegada al origen. El remitente debe pagar ahora.");
                setShowPaymentQR(true);
            } else {
                setNavStep(2);
                setArrivalTime(null);
                if (isDelivery) {
                    speak(`Paquete recogido. Iniciando ruta de entrega.`);
                } else {
                    speak(`Recogida exitosa. Iniciando viaje a ${activeRide.dropoff}`);
                }

                const finalPrice = parseFloat(((Number(activeRide.price) || 0) + fee).toFixed(2));
                await supabase.from('rides').update({
                    status: 'in_progress',
                    wait_seconds: elapsedSec,
                    wait_fee: fee,
                    price: finalPrice
                }).eq('id', activeRide.id);
                setActiveRide({ ...activeRide, price: finalPrice, wait_fee: fee, wait_seconds: elapsedSec });

                if (isDelivery) {
                    sendDeliveryMilestone({ rideId: activeRide.id, status: 'in_progress' });
                }
            }

        } else if (navStep === 2) {
            if (completing) return;
            setCompleting(true);
            try {
                const { error: completeErr } = await supabase
                    .from('rides')
                    .update({ status: 'completed' })
                    .eq('id', activeRide.id);

                if (completeErr) {
                    toast.error(`No se pudo completar el viaje: ${completeErr.message}`);
                    setCompleting(false);
                    return;
                }

                if (isDelivery) {
                    sendDeliveryMilestone({ rideId: activeRide.id, status: 'completed' });
                }

                if (activeRide.user_id) {
                    supabase.rpc('credit_pending_referral', { p_user_id: activeRide.user_id }).then(
                        ({ error }) => { if (error) console.warn("Referral credit warning:", error); },
                        (err) => console.error("Referral credit error:", err)
                    );
                }

                const isSenderPayer = isDelivery && (activeRide.delivery_info?.payer === 'sender' || activeRide.payer === 'sender');

                setCompleting(false);

                if (isSenderPayer) {
                    speak("Entrega finalizada. Gracias.");
                    closeRide();
                } else {
                    speak(`Viaje completado. Muestre el código QR para el pago.`);
                    setShowPaymentQR(true);
                }
            } catch (err) {
                console.error('Error completando viaje:', err);
                toast.error(`Error inesperado al completar el viaje: ${err?.message || err}`);
                setCompleting(false);
            }
        }
    };

    const confirmDriverPayment = async () => {
        if (!activeRide) return;
        const updates = { payment_confirmed_by_driver: true };
        if (activeRide.payment_confirmed_by_user) {
            updates.payment_confirmed_at = new Date().toISOString();
        }
        const { error } = await supabase.from('rides').update(updates).eq('id', activeRide.id);
        if (error) {
            toast.error(`No se pudo confirmar el pago: ${error.message}`);
            return;
        }
        setActiveRide({ ...activeRide, ...updates });
    };

    const handleQRClosed = async () => {
        setShowPaymentQR(false);

        if (navStep === 1) {
            setNavStep(2);
            setArrivalTime(null);
            speak(`Pago confirmado. Iniciando viaje al destino.`);
            await supabase.from('rides').update({ status: 'in_progress' }).eq('id', activeRide.id);
            
            const isDelivery = activeRide.service_type === 'delivery' || activeRide.delivery_info;
            if (isDelivery) {
                sendDeliveryMilestone({ rideId: activeRide.id, status: 'in_progress' });
            }
        } else {
            closeRide();
        }
    };

    const closeRide = () => {
        setShowPaymentQR(false);
        setTimeout(() => {
            setActiveRide(null);
            setNavStep(0);
            setArrivalTime(null);
            setWaitElapsedSec(0);
            setWaitFee(0);
            if (setRequests) setRequests([]);
            stopLoopingRequestAlert();
        }, 150);
    };

    return {
        activeRide,
        setActiveRide,
        navStep,
        setNavStep,
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
        setInstruction,
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
    };
}
