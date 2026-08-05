// notificationService.js
// Centralized low-latency sound, vibration and operational TTS for Higo.

import { logger } from '../utils/logger';

let audioContext = null;
let alertBufferPromise = null;
let requestLoopInterval = null;

const initAudioContext = () => {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
};

const loadAlertBuffer = async () => {
    const context = initAudioContext();
    if (!context) throw new Error('audio_context_unavailable');

    if (!alertBufferPromise) {
        alertBufferPromise = fetch('/alert_sound.wav', { cache: 'force-cache' })
            .then((response) => {
                if (!response.ok) throw new Error(`alert_sound_http_${response.status}`);
                return response.arrayBuffer();
            })
            .then((buffer) => context.decodeAudioData(buffer))
            .catch((error) => {
                alertBufferPromise = null;
                throw error;
            });
    }
    return alertBufferPromise;
};

/** Unlock and preload audio on the first user gesture. */
export const initGlobalAudio = () => {
    if (typeof document === 'undefined') return;

    const unlockAudio = () => {
        try {
            const context = initAudioContext();
            if (!context) return;
            const buffer = context.createBuffer(1, 1, 22050);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            source.start(0);
            void loadAlertBuffer().catch((error) => logger.debug('Alert preload failed', error));

            if (context.state === 'running') {
                document.removeEventListener('click', unlockAudio);
                document.removeEventListener('touchstart', unlockAudio);
                document.removeEventListener('pointerdown', unlockAudio);
            }
        } catch (error) {
            logger.debug('Audio unlock failed', error);
        }
    };

    document.addEventListener('click', unlockAudio, { passive: true });
    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('pointerdown', unlockAudio, { passive: true });
};

/** Play the bundled alert immediately, reusing a decoded audio buffer. */
export const playAlertSound = async () => {
    try {
        const context = initAudioContext();
        if (!context) throw new Error('audio_context_unavailable');
        const audioBuffer = await loadAlertBuffer();
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.start(0);
        return true;
    } catch (error) {
        logger.debug('AudioContext alert failed', error);
        try {
            const audio = new Audio('/alert_sound.wav');
            audio.preload = 'auto';
            audio.volume = 1;
            await audio.play();
            return true;
        } catch (fallbackError) {
            logger.warn('Alert sound unavailable', fallbackError);
            return false;
        }
    }
};

/** Operational phrases are independent from the optional navigation voice toggle. */
export const speakOperationalMessage = async (text) => {
    const phrase = String(text || '').trim();
    if (!phrase) return false;

    try {
        const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
        try { await TextToSpeech.stop(); } catch { /* nothing queued */ }
        await TextToSpeech.speak({
            text: phrase,
            lang: 'es-ES',
            rate: 0.96,
            pitch: 1,
            volume: 1,
            category: 'ambient',
            queueStrategy: 1,
        });
        return true;
    } catch (nativeError) {
        try {
            if (typeof window === 'undefined'
                || !window.speechSynthesis
                || typeof window.SpeechSynthesisUtterance !== 'function') {
                throw new Error('speech_synthesis_unavailable');
            }
            window.speechSynthesis.cancel();
            const utterance = new window.SpeechSynthesisUtterance(phrase);
            utterance.lang = 'es-ES';
            utterance.rate = 0.96;
            utterance.pitch = 1;
            utterance.volume = 1;
            window.speechSynthesis.speak(utterance);
            return true;
        } catch (webError) {
            logger.warn('Operational voice unavailable', nativeError, webError);
            return false;
        }
    }
};

export const playIntenseBeep = () => {
    try {
        const context = initAudioContext();
        if (!context) return;
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(800, context.currentTime);
        gainNode.gain.setValueAtTime(0.5, context.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
        oscillator.connect(gainNode);
        gainNode.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.3);
    } catch (error) {
        logger.debug('Intense beep failed', error);
    }
};

export const vibrateIntense = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([500, 100, 500, 100, 500]);
    }
};

/** Start immediately, then repeat while an unhandled ride request is visible. */
export const startLoopingRequestAlert = () => {
    if (requestLoopInterval) return;
    void playAlertSound();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([1000, 500, 1000]);
    }

    requestLoopInterval = setInterval(() => {
        void playAlertSound();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([1000, 500, 1000]);
        }
    }, 2500);
};

export const stopLoopingRequestAlert = () => {
    if (requestLoopInterval) {
        clearInterval(requestLoopInterval);
        requestLoopInterval = null;
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(0);
};
