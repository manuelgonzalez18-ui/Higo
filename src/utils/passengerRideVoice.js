// Passenger and Higo Envíos voice contract. Keep these prompts synchronized with
// the authoritative ride milestones used by ConfirmTripPage and RideStatusPage.
const STORAGE_PREFIX = 'higo.passenger-ride-voice.v1';
const MAX_STORED_ANNOUNCEMENTS = 100;
const pendingAnnouncements = new Set();

export const PASSENGER_RIDE_VOICE_PHRASES = Object.freeze({
    searching: 'Buscando Higo Driver',
    accepted: 'Higo Driver encontrado',
    arrived: 'Tu Higo Driver llegó',
    started: 'Tu viaje ha comenzado',
    completed: 'Has llegado a tu destino',
    delivery_searching: 'Buscando Higo Driver',
    delivery_accepted: 'Higo Driver Encontrado',
    delivery_picked_up: 'Tu envío ha sido Recogido',
    delivery_completed: 'Tu Envío ha sido entregado',
});

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

const isDeliveryRide = (ride = {}) => (
    normalizeStatus(ride.service_type) === 'delivery' || Boolean(ride.delivery_info)
);

export const resolvePassengerRideMilestone = (ride = {}) => {
    if (!ride?.id) return null;

    const status = normalizeStatus(ride.status);

    if (isDeliveryRide(ride)) {
        if (['completed', 'finished', 'delivered'].includes(status)) return 'delivery_completed';
        if (['in_progress', 'started', 'ongoing', 'picked_up', 'collected'].includes(status)) return 'delivery_picked_up';
        if (
            ride.driver_id
            || ['accepted', 'assigned', 'driver_assigned'].includes(status)
        ) return 'delivery_accepted';
        if (['requested', 'searching', 'pending'].includes(status)) return 'delivery_searching';
        return null;
    }

    if (['completed', 'finished'].includes(status)) return 'completed';
    if (['in_progress', 'started', 'ongoing'].includes(status)) return 'started';
    if (
        ride.arrived_at_pickup_at
        || ['arrived', 'arrived_at_pickup', 'at_pickup'].includes(status)
    ) return 'arrived';
    if (
        ride.driver_id
        || ['accepted', 'assigned', 'driver_assigned'].includes(status)
    ) return 'accepted';
    if (['requested', 'searching', 'pending'].includes(status)) return 'searching';

    return null;
};

export const passengerRideVoiceStorageKey = (rideId, milestone) => (
    `${STORAGE_PREFIX}:${String(rideId)}:${String(milestone)}`
);

const getStorage = () => {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
};

const alreadyAnnounced = (key) => {
    const storage = getStorage();
    if (!storage) return false;
    try {
        return Boolean(storage.getItem(key));
    } catch {
        return false;
    }
};

const rememberAnnouncement = (key) => {
    const storage = getStorage();
    if (!storage) return;

    try {
        storage.setItem(key, String(Date.now()));

        const entries = [];
        for (let index = 0; index < storage.length; index += 1) {
            const entryKey = storage.key(index);
            if (!entryKey?.startsWith(`${STORAGE_PREFIX}:`)) continue;
            entries.push({
                key: entryKey,
                timestamp: Number(storage.getItem(entryKey) || 0),
            });
        }

        if (entries.length > MAX_STORED_ANNOUNCEMENTS) {
            entries
                .sort((left, right) => left.timestamp - right.timestamp)
                .slice(0, entries.length - MAX_STORED_ANNOUNCEMENTS)
                .forEach((entry) => storage.removeItem(entry.key));
        }
    } catch {
        // Voice feedback must never interrupt the ride flow because storage failed.
    }
};

const speakWithWebSpeech = (text) => new Promise((resolve, reject) => {
    if (
        typeof window === 'undefined'
        || !window.speechSynthesis
        || typeof window.SpeechSynthesisUtterance !== 'function'
    ) {
        reject(new Error('speech_synthesis_unavailable'));
        return;
    }

    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(event?.error || new Error('speech_synthesis_failed'));
    window.speechSynthesis.speak(utterance);
});

const speakText = async (text) => {
    try {
        const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
        await TextToSpeech.speak({
            text,
            lang: 'es-ES',
            rate: 0.95,
            pitch: 1,
            volume: 1,
            category: 'ambient',
            queueStrategy: 1,
        });
        return true;
    } catch (nativeError) {
        try {
            await speakWithWebSpeech(text);
            return true;
        } catch (webError) {
            console.warn('[passenger-voice] unavailable', nativeError, webError);
            return false;
        }
    }
};

export const announcePassengerRideMilestone = async ({
    rideId,
    milestone,
    force = false,
} = {}) => {
    const phrase = PASSENGER_RIDE_VOICE_PHRASES[milestone];
    if (!rideId || !phrase) return false;

    const key = passengerRideVoiceStorageKey(rideId, milestone);
    if (!force && (pendingAnnouncements.has(key) || alreadyAnnounced(key))) return false;

    pendingAnnouncements.add(key);
    try {
        const spoken = await speakText(phrase);
        if (spoken) rememberAnnouncement(key);
        return spoken;
    } finally {
        pendingAnnouncements.delete(key);
    }
};

export const announcePassengerRideState = async (ride) => {
    const milestone = resolvePassengerRideMilestone(ride);
    if (!milestone) return false;
    return announcePassengerRideMilestone({ rideId: ride.id, milestone });
};
