import React, { useEffect, useRef, useState } from 'react';

// Grabador de audio in-app para el chat de soporte. Usa MediaRecorder
// (web) + getUserMedia. En Capacitor WebView funciona si el manifest
// declara el permiso de micrófono (Android: RECORD_AUDIO; iOS:
// NSMicrophoneUsageDescription). Si el browser no lo soporta o el
// user niega permisos, el botón se oculta o el flujo aborta limpio.
//
// Props:
//   disabled       deshabilita el botón (uploading en curso, etc.)
//   onRecording    callback(boolean) cada vez que entramos/salimos del
//                  modo grabación — el padre lo usa para ocultar el
//                  resto de la input row mientras se graba.
//   onComplete     callback(file: File, mime: string) cuando el user
//                  presiona "enviar". File ya armado con nombre
//                  voice-<ts>.<ext> para que el upload lo trate como
//                  audio normal.
//   variant        'user' | 'admin' — paleta del botón idle.

const MAX_DURATION_S = 300; // 5 min de tope, parejo con MAX_UPLOAD_BYTES.

const pickMime = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
    ];
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
};

const extFromMime = (mime) => {
    if (!mime) return 'webm';
    if (mime.startsWith('audio/mp4')) return 'm4a';
    if (mime.startsWith('audio/ogg')) return 'ogg';
    if (mime.startsWith('audio/mpeg')) return 'mp3';
    return 'webm';
};

const AudioRecorder = ({ disabled, onRecording, onComplete, variant = 'user' }) => {
    const [recording, setRecording] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [supported, setSupported] = useState(true);

    const recRef = useRef(null);
    const streamRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);
    const mimeRef = useRef('');
    const cancelledRef = useRef(false);

    useEffect(() => {
        if (typeof navigator === 'undefined'
            || !navigator.mediaDevices
            || !navigator.mediaDevices.getUserMedia
            || typeof MediaRecorder === 'undefined') {
            setSupported(false);
        }
    }, []);

    const cleanup = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    useEffect(() => () => cleanup(), []);

    const start = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mime = pickMime();
            mimeRef.current = mime || 'audio/webm';
            const rec = mime
                ? new MediaRecorder(stream, { mimeType: mime })
                : new MediaRecorder(stream);
            recRef.current = rec;
            chunksRef.current = [];
            cancelledRef.current = false;

            rec.ondataavailable = (e) => {
                if (e.data && e.data.size) chunksRef.current.push(e.data);
            };
            rec.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeRef.current });
                chunksRef.current = [];
                cleanup();
                setRecording(false);
                setElapsed(0);
                onRecording?.(false);
                if (cancelledRef.current || blob.size === 0) return;
                const ext = extFromMime(mimeRef.current);
                const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeRef.current });
                onComplete?.(file, mimeRef.current);
            };

            rec.start();
            setRecording(true);
            setElapsed(0);
            onRecording?.(true);
            timerRef.current = setInterval(() => {
                setElapsed(prev => {
                    const next = prev + 1;
                    if (next >= MAX_DURATION_S) {
                        // tope alcanzado → enviar lo grabado.
                        try { recRef.current?.stop(); } catch { /* noop */ }
                    }
                    return next;
                });
            }, 1000);
        } catch (err) {
            console.error('Mic denied/unavailable:', err);
            const msg = err?.name === 'NotAllowedError'
                ? 'Permiso de micrófono denegado. Habilitalo en los ajustes del navegador.'
                : 'No pude acceder al micrófono.';
            alert(msg);
            cleanup();
        }
    };

    const stopAndSend = () => {
        cancelledRef.current = false;
        try { recRef.current?.stop(); } catch { /* noop */ }
    };
    const cancel = () => {
        cancelledRef.current = true;
        try { recRef.current?.stop(); } catch { /* noop */ }
    };

    if (!supported) return null;

    if (!recording) {
        const idleCls = variant === 'admin'
            ? 'bg-white/5 text-blue-300 hover:bg-white/10'
            : 'bg-blue-600/10 text-blue-500 hover:bg-blue-600/20';
        return (
            <button
                type="button"
                onClick={start}
                disabled={disabled}
                title="Grabar audio"
                className={`w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${idleCls}`}
            >
                <span className="material-symbols-outlined text-[20px]">mic</span>
            </button>
        );
    }

    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    const nearLimit = elapsed >= MAX_DURATION_S - 10;

    return (
        <div className="flex-1 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-1.5 min-h-[42px]">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0"></span>
            <span className={`text-xs font-mono tabular-nums ${nearLimit ? 'text-amber-400' : 'text-red-400'}`}>
                {mm}:{ss}
            </span>
            <span className="text-xs text-gray-400 hidden sm:inline">Grabando…</span>
            <button
                type="button"
                onClick={cancel}
                className="ml-auto w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-white/10"
                title="Cancelar"
            >
                <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
            <button
                type="button"
                onClick={stopAndSend}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-600 text-white hover:bg-blue-500"
                title="Enviar"
            >
                <span className="material-symbols-outlined text-[18px]">send</span>
            </button>
        </div>
    );
};

export default AudioRecorder;
