import { useCallback, useEffect, useRef, useState } from 'react';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { supabase } from '../services/supabase';
import {
    acceptRide,
    completeRide,
    confirmRidePayment,
    markDropoffArrival,
    markPickupArrival,
    startRide,
} from '../services/rideApi';
import { FEATURES } from '../config/features';
import { computeWaitFee } from '../utils/ridePricing';
import { stopLoopingRequestAlert } from '../services/notificationService';
import { toast } from '../components/Toast';
import { sendDeliveryMilestone } from '../utils/sendDeliveryMilestone';
import { queueRideStatusPush } from '../utils/sendRideStatusPush';

const hydratePassengerInfo = async (ride) => {
    if (!ride?.user_id || ride.passenger_name) return ride;
    try {
        const { data } = await supabase.rpc('get_public_profile', { p_id: ride.user_id });
        const profile = Array.isArray(data) ? data[0] : data;
        if (!profile) return ride;
        return {
            ...ride,
            passenger_name: profile.full_name || null,
            passenger_phone: ride.passenger_phone || profile.phone || null,
            passenger_avatar_url: profile.avatar_url || null,
        };
    } catch {
        return ride;
    }
};

const isDeliveryRide = (ride) => ride?.service_type === 'delivery' || Boolean(ride?.delivery_info);

export function useDriverActiveTrip(profile, navigate, setRequests) {
    const [activeRide, setActiveRide] = useState(null);
    const [navStep, setNavStep] = useState(0);
    const [arrivalTime, setArrivalTime] = useState(null);
    const [waitElapsedSec, setWaitElapsedSec] = useState(0);
    const [waitFee, setWaitFee] = useState(0);
    const [completing, setCompleting] = useState(false);
    const [showPaymentQR, setShowPaymentQR] = useState(false);
    const [podRequired, setPodRequired] = useState(null);
    const [showCodConfirm, setShowCodConfirm] = useState(false);
    const [instruction, setInstruction] = useState('Esperando viajes...');
    const [navInfo, setNavInfo] = useState(null);
    const [voiceEnabled, setVoiceEnabled] = useState(true);

    const activeRideRef = useRef(null);
    const wakeLockRef = useRef(null);

    useEffect(() => {
        activeRideRef.current = activeRide;
    }, [activeRide]);

    const speak = useCallback(async (text) => {
        setInstruction(text);
        if (!voiceEnabled) return;
        try {
            await TextToSpeech.speak({
                text,
                lang: 'es-ES',
                rate: 1,
                pitch: 1,
                volume: 1,
                category: 'ambient',
            });
        } catch {
            try {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'es-ES';
                window.speechSynthesis.speak(utterance);
            } catch {
                // Voice guidance is ancillary.
            }
        }
    }, [voiceEnabled]);

    useEffect(() => {
        let disposed = false;
        let visibilityHandler = null;

        const requestLock = async () => {
            if (!('wakeLock' in navigator) || (!profile && !activeRide)) return;
            try {
                wakeLockRef.current = await navigator.wakeLock.request('screen');
                visibilityHandler = async () => {
                    if (!disposed && document.visibilityState === 'visible') {
                        try {
                            wakeLockRef.current = await navigator.wakeLock.request('screen');
                        } catch {
                            // Device may reject a second lock.
                        }
                    }
                };
                document.addEventListener('visibilitychange', visibilityHandler);
            } catch {
                // Wake lock is optional.
            }
        };

        requestLock();
        return () => {
            disposed = true;
            if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
            wakeLockRef.current?.release?.().catch?.(() => {});
            wakeLockRef.current = null;
        };
    }, [profile, activeRide?.id]);

    useEffect(() => {
        if (!arrivalTime) {
            setWaitElapsedSec(0);
            return undefined;
        }
        const update = () => setWaitElapsedSec(Math.max(0, Math.floor((Date.now() - arrivalTime) / 1000)));
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [arrivalTime]);

    useEffect(() => {
        if (!profile?.id) return;
        let cancelled = false;
        const restore = async () => {
            const { data } = await supabase
                .from('rides')
                .select('*')
                .eq('driver_id', profile.id)
                .in('status', ['accepted', 'in_progress', 'arrived_at_dropoff'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (!data || cancelled) return;
            const hydrated = await hydratePassengerInfo(data);
            if (cancelled) return;
            setActiveRide(hydrated);
            setNavStep(data.status === 'accepted' ? 1 : 2);
            if (data.arrived_at_pickup_at && data.status === 'accepted') {
                setArrivalTime(new Date(data.arrived_at_pickup_at).getTime());
            }
            setWaitFee(Number(data.wait_fee || 0));
        };
        restore();
        return () => { cancelled = true; };
    }, [profile?.id]);

    useEffect(() => {
        if (!activeRide?.id) return;
        const rideId = activeRide.id;

        const handleCancelledByPassenger = () => {
            navigator.vibrate?.([1000, 500, 1000]);
            speak('El viaje fue cancelado por el pasajero.');
            toast.error('El pasajero canceló el viaje.');
            closeRide();
        };

        const channel = supabase
            .channel(`ride-state:${rideId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'rides',
                filter: `id=eq.${rideId}`,
            }, (payload) => {
                setActiveRide((current) => current ? { ...current, ...payload.new } : payload.new);
                if (payload.new.status === 'cancelled') {
                    handleCancelledByPassenger();
                }
            })
            .subscribe();

        // Red de seguridad: si el conductor estaba en segundo plano cuando el
        // pasajero canceló, el evento de realtime pudo perderse (no se reenvía).
        // Al volver al frente re-consultamos el estado real y cerramos el viaje
        // si ya fue cancelado, para que no quede pegado en un viaje muerto.
        const resyncOnForeground = async () => {
            if (document.visibilityState !== 'visible') return;
            const { data } = await supabase
                .from('rides')
                .select('status')
                .eq('id', rideId)
                .single();
            if (data?.status === 'cancelled') {
                handleCancelledByPassenger();
            }
        };
        document.addEventListener('visibilitychange', resyncOnForeground);

        return () => {
            supabase.removeChannel(channel);
            document.removeEventListener('visibilitychange', resyncOnForeground);
        };
    }, [activeRide?.id, speak]); // eslint-disable-line react-hooks/exhaustive-deps

    const closeRide = useCallback(() => {
        setShowPaymentQR(false);
        setActiveRide(null);
        setNavStep(0);
        setArrivalTime(null);
        setWaitElapsedSec(0);
        setWaitFee(0);
        setPodRequired(null);
        setShowCodConfirm(false);
        setRequests?.([]);
        stopLoopingRequestAlert();
    }, [setRequests]);

    const handleAcceptRide = useCallback(async (ride) => {
        if (!profile?.id) return;
        if (profile.subscription_status === 'suspended') {
            if (window.confirm('Tu membresía no está activa. ¿Ir a Higo Pay?')) navigate('/higo-pay');
            return;
        }

        try {
            let accepted;
            if (FEATURES.serverSideRideState || ride.offerId || ride.offer_id) {
                accepted = await acceptRide(ride.id);
            } else {
                const { data, error } = await supabase
                    .from('rides')
                    .update({ status: 'accepted', driver_id: profile.id })
                    .eq('id', ride.id)
                    .eq('status', 'requested')
                    .is('driver_id', null)
                    .select()
                    .maybeSingle();
                if (error) throw error;
                if (!data) throw new Error('ride_unavailable');
                accepted = data;
            }

            const hydrated = await hydratePassengerInfo({ ...ride, ...accepted });
            setActiveRide(hydrated);
            setRequests?.([]);
            stopLoopingRequestAlert();
            setNavStep(1);
            setArrivalTime(null);
            queueRideStatusPush({ rideId: accepted?.id || ride.id, milestone: 'driver_found' });
            speak(`Viaje aceptado. Navegando a ${ride.pickup}`);
        } catch (error) {
            const errorText = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
            if (/unavailable|ride_unavailable|invalid_ride_transition|offer.*expired|active offer|42501/i.test(errorText)) {
                toast.error('Esta solicitud ya no está disponible.');
                setRequests?.((current) => current.filter((item) => item.id !== ride.id));
            } else {
                toast.error(`No se pudo aceptar el viaje: ${error?.message || error}`);
            }
        }
    }, [navigate, profile, setRequests, speak]);

    const handleMarkArrival = useCallback(async () => {
        if (!activeRideRef.current || arrivalTime) return;
        try {
            let updated = activeRideRef.current;
            let arrivedAtIso = new Date().toISOString();
            if (FEATURES.serverSideRideState) {
                updated = await markPickupArrival(activeRideRef.current.id);
                arrivedAtIso = updated?.arrived_at_pickup_at || arrivedAtIso;
            } else {
                const { data, error } = await supabase
                    .from('rides')
                    .update({ arrived_at_pickup_at: arrivedAtIso })
                    .eq('id', activeRideRef.current.id)
                    .eq('status', 'accepted')
                    .select()
                    .single();
                if (error) throw error;
                updated = data;
            }
            setActiveRide((current) => ({ ...current, ...updated }));
            const arrivedAt = new Date(updated?.arrived_at_pickup_at || arrivedAtIso).getTime();
            setArrivalTime(arrivedAt);
            setWaitElapsedSec(0);
            setWaitFee(0);
            queueRideStatusPush({ rideId: updated?.id || activeRideRef.current.id, milestone: 'arrived' });
            speak('Llegada marcada. Esperando al pasajero.');
        } catch (error) {
            toast.error(`No se pudo marcar la llegada: ${error?.message || error}`);
        }
    }, [arrivalTime, speak]);

    const beginTrip = useCallback(async (ride) => {
        if (FEATURES.serverSideRideState) {
            const updated = await startRide(ride.id);
            setActiveRide((current) => ({ ...current, ...updated }));
            setWaitFee(Number(updated.wait_fee || 0));
            queueRideStatusPush({ rideId: ride.id, milestone: 'started' });
            return updated;
        }

        const elapsedSeconds = arrivalTime ? Math.max(0, Math.floor((Date.now() - arrivalTime) / 1000)) : 0;
        const fee = computeWaitFee({ vehicleType: ride.ride_type, elapsedSeconds });
        const finalPrice = Number((Number(ride.price || 0) + fee).toFixed(2));
        const { data, error } = await supabase
            .from('rides')
            .update({
                status: 'in_progress',
                wait_seconds: elapsedSeconds,
                wait_fee: fee,
                price: finalPrice,
            })
            .eq('id', ride.id)
            .select()
            .single();
        if (error) throw error;
        setWaitFee(fee);
        setActiveRide((current) => ({ ...current, ...data }));
        queueRideStatusPush({ rideId: ride.id, milestone: 'started' });
        return data;
    }, [arrivalTime]);

    const handleCompleteStep = useCallback(async () => {
        const ride = activeRideRef.current;
        if (!ride || completing) return;
        const delivery = isDeliveryRide(ride);

        if (delivery && navStep === 1 && !ride.pickup_pod_url) {
            setPodRequired('pickup');
            return;
        }

        if (navStep === 1) {
            const senderPays = delivery && (ride.delivery_info?.payer === 'sender' || ride.payer === 'sender');
            if (senderPays) {
                setShowPaymentQR(true);
                speak('Llegada al origen. El remitente debe pagar ahora.');
                return;
            }

            setCompleting(true);
            try {
                const updated = await beginTrip(ride);
                setNavStep(2);
                setArrivalTime(null);
                speak(delivery
                    ? 'Paquete recogido. Iniciando ruta de entrega.'
                    : `Recogida exitosa. Iniciando viaje a ${ride.dropoff}`);
                if (delivery) sendDeliveryMilestone({ rideId: ride.id, status: 'in_progress' });
                setActiveRide((current) => ({ ...current, ...updated }));
            } catch (error) {
                toast.error(`No se pudo iniciar el viaje: ${error?.message || error}`);
            } finally {
                setCompleting(false);
            }
            return;
        }

        if (navStep !== 2) return;

        if (delivery && !ride.arrived_at_dropoff_at) {
            try {
                let updated;
                if (FEATURES.serverSideRideState) {
                    updated = await markDropoffArrival(ride.id);
                } else {
                    const { data, error } = await supabase
                        .from('rides')
                        .update({ status: 'arrived_at_dropoff' })
                        .eq('id', ride.id)
                        .select()
                        .single();
                    if (error) throw error;
                    updated = { ...data, arrived_at_dropoff_at: new Date().toISOString() };
                }
                setActiveRide((current) => ({ ...current, ...updated }));
                speak('Llegada al destino marcada. Coordiná la entrega.');
                sendDeliveryMilestone({ rideId: ride.id, status: 'arrived_at_dropoff' });
            } catch (error) {
                toast.error(`No se pudo marcar la llegada: ${error?.message || error}`);
            }
            return;
        }

        if (delivery && Number(ride.cod_amount || 0) > 0 && !ride.cod_collected) {
            setShowCodConfirm(true);
            return;
        }
        if (delivery && !ride.delivery_pod_url) {
            setPodRequired('delivery');
            return;
        }

        setCompleting(true);
        try {
            let updated;
            if (FEATURES.serverSideRideState) {
                updated = await completeRide(ride.id);
            } else {
                const { data, error } = await supabase
                    .from('rides')
                    .update({ status: 'completed' })
                    .eq('id', ride.id)
                    .select()
                    .single();
                if (error) throw error;
                updated = data;
            }
            setActiveRide((current) => ({ ...current, ...updated }));
            queueRideStatusPush({ rideId: ride.id, milestone: 'completed' });
            if (delivery) sendDeliveryMilestone({ rideId: ride.id, status: 'completed' });
            if (ride.user_id) {
                void Promise.resolve(
                    supabase.rpc('credit_pending_referral', { p_user_id: ride.user_id })
                ).catch(() => {});
            }

            const senderPays = delivery && (ride.delivery_info?.payer === 'sender' || ride.payer === 'sender');
            if (senderPays) {
                speak('Entrega finalizada. Gracias.');
                closeRide();
            } else {
                speak('Viaje completado. Mostrá el código QR para el pago.');
                setShowPaymentQR(true);
            }
        } catch (error) {
            toast.error(`No se pudo completar el viaje: ${error?.message || error}`);
        } finally {
            setCompleting(false);
        }
    }, [beginTrip, closeRide, completing, navStep, speak]);

    const confirmDriverPayment = useCallback(async () => {
        const ride = activeRideRef.current;
        if (!ride) return;
        try {
            let updated;
            if (FEATURES.serverSideRideState) {
                updated = await confirmRidePayment(ride.id);
            } else {
                const changes = { payment_confirmed_by_driver: true };
                if (ride.payment_confirmed_by_user) changes.payment_confirmed_at = new Date().toISOString();
                const { data, error } = await supabase.from('rides').update(changes).eq('id', ride.id).select().single();
                if (error) throw error;
                updated = data;
            }
            setActiveRide((current) => ({ ...current, ...updated }));
        } catch (error) {
            toast.error(`No se pudo confirmar el pago: ${error?.message || error}`);
        }
    }, []);

    const handleQRClosed = useCallback(async () => {
        setShowPaymentQR(false);
        const ride = activeRideRef.current;
        if (!ride) return;

        if (navStep === 1) {
            setCompleting(true);
            try {
                const updated = await beginTrip(ride);
                setActiveRide((current) => ({ ...current, ...updated }));
                setNavStep(2);
                setArrivalTime(null);
                speak('Pago confirmado. Iniciando viaje al destino.');
                if (isDeliveryRide(ride)) sendDeliveryMilestone({ rideId: ride.id, status: 'in_progress' });
            } catch (error) {
                toast.error(`No se pudo iniciar el viaje: ${error?.message || error}`);
            } finally {
                setCompleting(false);
            }
        } else {
            closeRide();
        }
    }, [beginTrip, closeRide, navStep, speak]);

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
        closeRide,
    };
}
