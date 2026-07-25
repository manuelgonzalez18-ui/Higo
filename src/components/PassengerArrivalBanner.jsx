import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

const TEMPORARY_NOTICE_MS = 15000;

const getRideIdFromHash = () => {
    if (typeof window === 'undefined') return null;
    const match = window.location.hash.match(/^#\/ride\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const isDeliveryRide = (ride) => (
    ride?.service_type === 'delivery' || Boolean(ride?.delivery_info)
);

/**
 * Prominent passenger-only visual notice for pickup arrival.
 *
 * This component intentionally contains no text-to-speech calls. It listens to
 * the same ride row already used by RideStatusPage and shows a large banner
 * when the driver marks pickup arrival. A legacy `in_progress` transition is
 * retained as a temporary fallback for older ride-state flows.
 */
export default function PassengerArrivalBanner() {
    const [notice, setNotice] = useState(null);
    const temporaryTimerRef = useRef(null);
    const activeSubscriptionCleanupRef = useRef(null);
    const dismissedRideIdsRef = useRef(new Set());

    useEffect(() => {
        const clearTemporaryTimer = () => {
            if (temporaryTimerRef.current) {
                window.clearTimeout(temporaryTimerRef.current);
                temporaryTimerRef.current = null;
            }
        };

        const hideNotice = () => {
            clearTemporaryTimer();
            setNotice(null);
        };

        const showNotice = (rideId, { temporary = false } = {}) => {
            if (!rideId || dismissedRideIdsRef.current.has(rideId)) return;
            clearTemporaryTimer();
            setNotice({ rideId, temporary });
            if (temporary) {
                temporaryTimerRef.current = window.setTimeout(() => {
                    setNotice((current) => current?.rideId === rideId ? null : current);
                    temporaryTimerRef.current = null;
                }, TEMPORARY_NOTICE_MS);
            }
        };

        const stopRideSubscription = () => {
            activeSubscriptionCleanupRef.current?.();
            activeSubscriptionCleanupRef.current = null;
        };

        const subscribeForCurrentRoute = async () => {
            stopRideSubscription();
            hideNotice();

            const rideId = getRideIdFromHash();
            if (!rideId) return;

            let disposed = false;
            let previousStatus = null;
            let previousArrivalAt = null;

            const handleRide = (ride, { initial = false } = {}) => {
                if (disposed || !ride || isDeliveryRide(ride)) {
                    hideNotice();
                    return;
                }

                const arrivalAt = ride.arrived_at_pickup_at || null;
                const explicitlyWaitingAtPickup = ride.status === 'accepted' && Boolean(arrivalAt);
                const arrivalWasJustMarked = !previousArrivalAt && Boolean(arrivalAt);
                const legacyArrivalTransition = !initial
                    && previousStatus !== 'in_progress'
                    && ride.status === 'in_progress'
                    && !arrivalAt;

                if (explicitlyWaitingAtPickup || arrivalWasJustMarked) {
                    showNotice(rideId, { temporary: ride.status !== 'accepted' });
                } else if (legacyArrivalTransition) {
                    showNotice(rideId, { temporary: true });
                } else if (notice?.rideId === rideId && !notice.temporary && ride.status !== 'accepted') {
                    hideNotice();
                }

                previousStatus = ride.status;
                previousArrivalAt = arrivalAt;
            };

            const { data: initialRide } = await supabase
                .from('rides')
                .select('id,status,service_type,delivery_info,arrived_at_pickup_at')
                .eq('id', rideId)
                .maybeSingle();

            if (disposed) return;
            if (initialRide) handleRide(initialRide, { initial: true });

            const channel = supabase
                .channel(`passenger-arrival-banner:${rideId}`)
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'rides',
                    filter: `id=eq.${rideId}`,
                }, (payload) => {
                    handleRide(payload.new);
                })
                .subscribe();

            activeSubscriptionCleanupRef.current = () => {
                disposed = true;
                supabase.removeChannel(channel);
            };
        };

        window.addEventListener('hashchange', subscribeForCurrentRoute);
        void subscribeForCurrentRoute();

        return () => {
            window.removeEventListener('hashchange', subscribeForCurrentRoute);
            stopRideSubscription();
            clearTemporaryTimer();
        };
    }, [notice]);

    if (!notice) return null;

    const dismiss = () => {
        dismissedRideIdsRef.current.add(notice.rideId);
        if (temporaryTimerRef.current) {
            window.clearTimeout(temporaryTimerRef.current);
            temporaryTimerRef.current = null;
        }
        setNotice(null);
    };

    return (
        <div
            className="fixed top-[calc(env(safe-area-inset-top)+1rem)] left-4 right-4 z-[120] pointer-events-none animate-in slide-in-from-top-6 fade-in duration-300"
            role="status"
            aria-live="assertive"
        >
            <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-[28px] border-4 border-white/90 bg-emerald-400 text-slate-950 shadow-[0_22px_70px_rgba(16,185,129,0.55)] pointer-events-auto">
                <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-emerald-600/20 pointer-events-none" />
                <div className="relative flex items-center gap-4 p-5 pr-12">
                    <div className="relative shrink-0">
                        <div className="absolute inset-0 rounded-full bg-white/70 animate-ping [animation-duration:1.8s]" />
                        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-lg">
                            <span className="material-symbols-outlined text-emerald-600 text-4xl">local_taxi</span>
                        </div>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-900/80">
                            Atención
                        </p>
                        <h2 className="mt-0.5 text-2xl font-black leading-tight tracking-tight">
                            ¡Tu Higo Driver ha llegado!
                        </h2>
                        <p className="mt-1 text-sm font-bold leading-snug text-slate-800">
                            Está esperando en el punto de recogida. Verifica la placa y el vehículo antes de abordar.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/15 hover:bg-slate-950/25 active:scale-90 transition-all"
                    aria-label="Cerrar aviso de llegada"
                    title="Cerrar aviso"
                >
                    <span className="material-symbols-outlined text-slate-950 text-xl">close</span>
                </button>
            </div>
        </div>
    );
}
