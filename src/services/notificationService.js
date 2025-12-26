
// notificationService.js
// Handles intense sound and vibration for Higo App

let audioContext = null;
let requestLoopInterval = null;

const initAudioContext = () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
};

/**
 * Initializes audio context on first user interaction.
 * Call this from App.jsx mount.
 */
export const initGlobalAudio = () => {
    const unlockAudio = () => {
        initAudioContext();
        // Play silent sound to unlock buffer
        const buffer = audioContext.createBuffer(1, 1, 22050);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(0);

        // Remove listener after first successful unlock
        if (audioContext.state === 'running') {
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
        }
    };

    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
};

/**
 * Plays a single intense beep (Square wave)
 * Duration: 300ms, Frequency: 800Hz (High pitch alert)
 */
export const playIntenseBeep = () => {
    try {
        initAudioContext();

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'square'; // Harsh, loud sound
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // High pitch

        // Volume 
        gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.3);

    } catch (e) {
        console.error("Audio Play Error:", e);
    }
};

/**
 * Triggers an intense vibration pattern
 * Pattern: Long vibration for urgency
 */
export const vibrateIntense = () => {
    if (navigator.vibrate) {
        // [vibrate, pause, vibrate, pause, vibrate]
        navigator.vibrate([500, 100, 500, 100, 500]);
    }
};

/**
 * Starts a looping alert for Ride Requests.
 * Plays sound and vibrates every 2 seconds.
 */
export const startLoopingRequestAlert = () => {
    if (requestLoopInterval) return; // Already running

    // Play immediately
    playIntenseBeep();
    vibrateIntense();

    requestLoopInterval = setInterval(() => {
        playIntenseBeep();
        vibrateIntense();
    }, 2000); // Repeat every 2 seconds
};

/**
 * Stops the looping alert.
 */
export const stopLoopingRequestAlert = () => {
    if (requestLoopInterval) {
        clearInterval(requestLoopInterval);
        requestLoopInterval = null;
    }
    // Also stop vibration immediately
    if (navigator.vibrate) {
        navigator.vibrate(0);
    }
};
