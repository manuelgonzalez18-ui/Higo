import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { supabase } from './supabase';

const VOICE_MESSAGES = Object.freeze({
    searching: 'Buscando un Higo Driver.',
    found: 'Higo Driver encontrado.',
    arrived: 'El Higo Driver ha llegado.',
    completed: 'Ha llegado a su destino. Gracias.',
});

const ARRIVAL_RADIUS_METERS = 100;

let activeCleanup = null;
let speechQueue = Promise.resolve();
let syncSequence = 0;

const getRideIdFromHash = () => {
    if (typeof window === 'undefined') return null;
    const match = window.location.hash.match(/^#\/ride\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
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

const speakWithBrowser = (text) => new Promise((resolve) => {
    try {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            resolve();
            return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-VE';
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onend = resolve;
        utterance.onerror = resolve;
        window.speechSynthesis.speak(utterance);
    } catch {
        resolve();
    }
});

const speak = (text) => {
    speechQueue = speechQueue
        .catch(() => {})
        .then(async () => {
            try {
                await TextToSpeech.speak({
                    text,
                    lang: 'es-VE',
                    rate: 0.95,
                    pitch: 1,
                    volume: 1,
                    category: 'ambient',
                });
            } catch {
                await speakWithBrowser(text);
            }
        });
    return speechQueue;
};

const subscribeToRideVoice = async (rideId, sequence) => {
    let disposed = false;
    let latestRide = null;
    let driverChannel = null;
    let trackedDriverId = null;
    const spokenMilestones = new Set();

    const announceMilestone = (milestone) => {
        if (disposed || sequence !== syncSequence) return;
        if (!milestone || spokenMilestones.has(milestone)) return;
        spokenMilestones.add(milestone);
        void speak(VOICE_MESSAGES[milestone]);
    };

    const checkDriverProximity = (profile) => {
        if (!latestRide || spokenMilestones.has('arrived')) return;
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

    const stopDriverTracking = () => {
        if (driverChannel) supabase.removeChannel(driverChannel);
        driverChannel = null;
        trackedDriverId = null;
    };

    const ensureDriverTracking = async (ride) => {
        if (!ride?.driver_id || isDeliveryRide(ride) || spokenMilestones.has('arrived')) {
            if (spokenMilestones.has('arrived')) stopDriverTracking();
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
        announceMilestone(getMilestone(ride));
        void ensureDriverTracking(ride);
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
    if (!rideId) return;

    const cleanup = await subscribeToRideVoice(rideId, sequence);
    if (sequence !== syncSequence) {
        cleanup();
        return;
    }
    activeCleanup = cleanup;
};

if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', syncPassengerRideVoice);
    queueMicrotask(syncPassengerRideVoice);
}

export const stopPassengerRideVoice = () => {
    syncSequence += 1;
    activeCleanup?.();
    activeCleanup = null;
};
