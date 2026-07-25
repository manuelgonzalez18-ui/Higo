import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { supabase } from './supabase';

const VOICE_MESSAGES = Object.freeze({
    searching: 'Buscando un Higo Driver.',
    found: 'Higo Driver encontrado.',
    arrived: 'El Higo Driver ha llegado.',
    completed: 'Ha llegado a su destino. Gracias.',
});

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
    const spokenMilestones = new Set();

    const announceCurrentMilestone = (ride) => {
        if (disposed || sequence !== syncSequence) return;
        const milestone = getMilestone(ride);
        if (!milestone || spokenMilestones.has(milestone)) return;
        spokenMilestones.add(milestone);
        void speak(VOICE_MESSAGES[milestone]);
    };

    const { data: initialRide, error } = await supabase
        .from('rides')
        .select('id,status,driver_id,service_type,delivery_info,arrived_at_pickup_at')
        .eq('id', rideId)
        .maybeSingle();

    if (!disposed && sequence === syncSequence && !error && initialRide) {
        announceCurrentMilestone(initialRide);
    }

    const channel = supabase
        .channel(`passenger-ride-voice:${rideId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'rides',
            filter: `id=eq.${rideId}`,
        }, (payload) => {
            announceCurrentMilestone(payload.new);
        })
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(channel);
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
