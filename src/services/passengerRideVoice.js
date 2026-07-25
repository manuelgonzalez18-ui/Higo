import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { supabase } from './supabase';

const VOICE_MESSAGES = Object.freeze({
    searching: 'Buscando un Higo Driver.',
    found: 'Higo Driver encontrado.',
    arrived: 'El Higo Driver ha llegado.',
    completed: 'Ha llegado a su destino. Gracias.',
});

const MILESTONE_ORDER = Object.freeze({
    searching: 1,
    found: 2,
    arrived: 3,
    completed: 4,
});

const ARRIVAL_RADIUS_METERS = 100;
const STORAGE_PREFIX = 'higo:passenger-ride-voice:';

let activeCleanup = null;
let syncSequence = 0;
let speechGeneration = 0;
let browserSpeechPrimed = false;

const getRideIdFromHash = () => {
    if (typeof window === 'undefined') return null;
    const match = window.location.hash.match(/^#\/ride\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const isPassengerVoiceRoute = () => {
    if (typeof window === 'undefined') return false;
    return /^#\/(confirm(?:[/?#]|$)|ride\/)/.test(window.location.hash);
};

const isDeliveryRide = (ride) => (
    ride?.service_type === 'delivery' || Boolean(ride?.delivery_info)
);

const distanceMeters = (a, b) => {
    if (!a || !b) return Infinity;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const radius = 6371000;
    const latitudeDelta = toRadians(b.lat - a.lat);
    const longitudeDelta = toRadians(b.lng - a.lng);
    const latitudeA = toRadians(a.lat);
    const latitudeB = toRadians(b.lat);
    const h = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
};

const getMilestone = (ride) => {
    if (!ride || isDeliveryRide(ride)) return null;
    if (ride.status === 'completed') return 'completed';
    if (
        ride.arrived_at_pickup_at
        || ride.status === 'in_progress'
        || ride.status === 'arrived_at_dropoff'
    ) return 'arrived';
    if (ride.driver_id || ride.status === 'accepted') return 'found';
    if (ride.status === 'requested') return 'searching';
    return null;
};

const getStoredMilestones = (rideId) => {
    if (!rideId || typeof sessionStorage === 'undefined') return new Set();
    try {
        const stored = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}${rideId}`) || '[]');
        return new Set(Array.isArray(stored) ? stored : []);
    } catch {
        return new Set();
    }
};

const persistMilestones = (rideId, milestones) => {
    if (!rideId || typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.setItem(`${STORAGE_PREFIX}${rideId}`, JSON.stringify([...milestones]));
    } catch {
        // Voice deduplication is optional and must never affect ride tracking.
    }
};

const primeBrowserSpeech = () => {
    if (browserSpeechPrimed || typeof window === 'undefined' || !window.speechSynthesis) return;
    browserSpeechPrimed = true;
    try {
        window.speechSynthesis.resume();
        const utterance = new SpeechSynthesisUtterance('.');
        utterance.lang = 'es-VE';
        utterance.rate = 10;
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
    } catch {
        // Native TTS remains available even when Web Speech cannot be primed.
    }
};

const stopCurrentSpeech = async () => {
    try {
        window.speechSynthesis?.cancel?.();
    } catch {
        // Browser speech cancellation is best effort.
    }

    try {
        const stopPromise = TextToSpeech.stop?.();
        if (stopPromise) {
            await Promise.race([
                Promise.resolve(stopPromise),
                new Promise((resolve) => setTimeout(resolve, 500)),
            ]);
        }
    } catch {
        // Some web runtimes do not implement the native stop method.
    }
};

const speakWithBrowser = (text, generation) => {
    if (generation !== speechGeneration) return;
    try {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-VE';
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;
        window.speechSynthesis.speak(utterance);
    } catch {
        // Voice status is ancillary and must not interrupt the trip flow.
    }
};

const speakNow = (text) => {
    const generation = ++speechGeneration;

    void (async () => {
        await stopCurrentSpeech();
        if (generation !== speechGeneration) return;

        try {
            const nativeSpeech = TextToSpeech.speak({
                text,
                lang: 'es-VE',
                rate: 0.95,
                pitch: 1,
                volume: 1,
                category: 'ambient',
            });

            Promise.resolve(nativeSpeech).catch(() => {
                if (generation === speechGeneration) speakWithBrowser(text, generation);
            });
        } catch {
            speakWithBrowser(text, generation);
        }
    })();
};

const subscribeToRideVoice = async (rideId, sequence) => {
    let disposed = false;
    let latestRide = null;
    let driverChannel = null;
    let trackedDriverId = null;
    const spokenMilestones = getStoredMilestones(rideId);
    let highestMilestoneOrder = [...spokenMilestones].reduce(
        (highest, milestone) => Math.max(highest, MILESTONE_ORDER[milestone] || 0),
        0,
    );

    const stopDriverTracking = () => {
        if (driverChannel) supabase.removeChannel(driverChannel);
        driverChannel = null;
        trackedDriverId = null;
    };

    const announceMilestone = (milestone) => {
        if (disposed || sequence !== syncSequence) return;
        const order = MILESTONE_ORDER[milestone] || 0;
        if (!order || order <= highestMilestoneOrder) return;

        highestMilestoneOrder = order;
        spokenMilestones.add(milestone);
        persistMilestones(rideId, spokenMilestones);
        speakNow(VOICE_MESSAGES[milestone]);

        if (order >= MILESTONE_ORDER.arrived) stopDriverTracking();
    };

    const checkDriverProximity = (profile) => {
        if (!latestRide || highestMilestoneOrder >= MILESTONE_ORDER.arrived) return;
        const pickup = {
            lat: Number(latestRide.pickup_lat),
            lng: Number(latestRide.pickup_lng),
        };
        const driverLocation = {
            lat: Number(profile?.curr_lat),
            lng: Number(profile?.curr_lng),
        };
        if (
            !Number.isFinite(pickup.lat)
            || !Number.isFinite(pickup.lng)
            || !Number.isFinite(driverLocation.lat)
            || !Number.isFinite(driverLocation.lng)
        ) return;
        if (distanceMeters(driverLocation, pickup) <= ARRIVAL_RADIUS_METERS) {
            announceMilestone('arrived');
        }
    };

    const ensureDriverTracking = async (ride, milestone) => {
        if (
            milestone !== 'found'
            || !ride?.driver_id
            || isDeliveryRide(ride)
            || highestMilestoneOrder >= MILESTONE_ORDER.arrived
        ) {
            stopDriverTracking();
            return;
        }
        if (trackedDriverId === ride.driver_id) return;

        stopDriverTracking();
        trackedDriverId = ride.driver_id;

        const { data: profile } = await supabase
            .from('profiles')
            .select('id,curr_lat,curr_lng')
            .eq('id', ride.driver_id)
            .maybeSingle();
        if (disposed || sequence !== syncSequence) return;
        if (profile) checkDriverProximity(profile);

        driverChannel = supabase
            .channel(`passenger-driver-proximity:${ride.id}:${ride.driver_id}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'profiles',
                filter: `id=eq.${ride.driver_id}`,
            }, (payload) => {
                checkDriverProximity(payload.new);
            })
            .subscribe();
    };

    const handleRide = (ride) => {
        if (!ride || isDeliveryRide(ride)) return;
        latestRide = ride;
        const milestone = getMilestone(ride);
        announceMilestone(milestone);
        void ensureDriverTracking(ride, milestone);
    };

    const { data: initialRide, error } = await supabase
        .from('rides')
        .select('id,status,driver_id,service_type,delivery_info,arrived_at_pickup_at,pickup_lat,pickup_lng')
        .eq('id', rideId)
        .maybeSingle();

    if (!disposed && sequence === syncSequence && !error && initialRide) {
        handleRide(initialRide);
    }

    const rideChannel = supabase
        .channel(`passenger-ride-voice:${rideId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'rides',
            filter: `id=eq.${rideId}`,
        }, (payload) => {
            handleRide(payload.new);
        })
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(rideChannel);
        stopDriverTracking();
    };
};

const syncPassengerRideVoice = async () => {
    const sequence = ++syncSequence;
    activeCleanup?.();
    activeCleanup = null;

    const rideId = getRideIdFromHash();
    if (!rideId) {
        speechGeneration += 1;
        void stopCurrentSpeech();
        return;
    }

    const cleanup = await subscribeToRideVoice(rideId, sequence);
    if (sequence !== syncSequence) {
        cleanup();
        return;
    }
    activeCleanup = cleanup;
};

if (typeof window !== 'undefined') {
    const primeOnInteraction = () => {
        if (!isPassengerVoiceRoute()) return;
        primeBrowserSpeech();
        window.removeEventListener('pointerdown', primeOnInteraction, true);
        window.removeEventListener('keydown', primeOnInteraction, true);
    };

    window.addEventListener('pointerdown', primeOnInteraction, true);
    window.addEventListener('keydown', primeOnInteraction, true);
    window.addEventListener('hashchange', syncPassengerRideVoice);
    queueMicrotask(syncPassengerRideVoice);
}

export const stopPassengerRideVoice = () => {
    syncSequence += 1;
    speechGeneration += 1;
    activeCleanup?.();
    activeCleanup = null;
    void stopCurrentSpeech();
};
