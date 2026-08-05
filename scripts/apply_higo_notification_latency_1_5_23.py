#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one regex match, found {count}')
    return updated


NOTIFICATION_SERVICE = r'''// notificationService.js
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
'''
write('src/services/notificationService.js', NOTIFICATION_SERVICE)

# Driver dashboard: independent online voice and immediate alert for directed offer reconciliation.
dashboard = read('src/pages/DriverDashboard.jsx')
dashboard = replace_once(
    dashboard,
    "import { startLoopingRequestAlert, stopLoopingRequestAlert } from '../services/notificationService';",
    "import { speakOperationalMessage, startLoopingRequestAlert, stopLoopingRequestAlert } from '../services/notificationService';",
    'driver notification import',
)
dashboard = replace_once(
    dashboard,
    "    const membershipNotifiedRef = useRef(false);",
    "    const membershipNotifiedRef = useRef(false);\n    const announcedRequestKeysRef = useRef(new Set());",
    'driver announced request ref',
)
new_notify = r'''    // Immediate in-app alert plus native banner. Operational TTS does not
    // depend on the optional turn-by-turn navigation voice setting.
    const notifyNewRequest = useCallback(async (ride) => {
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000]);
        void speakOperationalMessage('Nueva solicitud de viaje disponible');
        startLoopingRequestAlert();

        try {
            let distText = '';
            if (lastLocationRef.current && ride.pickup_lat) {
                const dist = getDistanceFromLatLonInKm(
                    lastLocationRef.current.latitude, lastLocationRef.current.longitude,
                    ride.pickup_lat, ride.pickup_lng
                );
                distText = ` | ${dist.toFixed(1)} km`;
            }

            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: '🚗 ¡Nueva solicitud Higo!',
                        body: `$${ride.price} - ${ride.dropoff}${distText}`,
                        id: Math.floor(Date.now() % 2147483647),
                        schedule: { at: new Date(Date.now() + 10) },
                        channelId: 'higo_rides_v13_immediate',
                        actionTypeId: 'RIDE_REQUEST_ACTIONS',
                        extra: { rideId: ride.id, offerId: ride.offerId || ride.offer_id || null },
                        visibility: 1,
                        priority: 2,
                        sound: 'alert_sound.wav'
                    }
                ]
            });
        } catch (error) {
            console.error('Local Notification fail:', error);
        }
    }, []);
'''
dashboard = regex_once(
    dashboard,
    r"    // Native notifications play loop audio backup helper\n    const notifyNewRequest = useCallback\(async \(ride\) => \{.*?\n    \}, \[speak\]\);\n",
    new_notify,
    'driver notify callback',
)
old_process_tail = r'''        setRequests(prev => {
            if (replace) return filtered;
            const combined = [...filtered, ...prev];
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            return unique.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        });

        if (!replace && filtered.length > 0) {
            LocalNotifications.checkPermissions().then(status => {
                if (status.display !== 'granted') {
                    LocalNotifications.requestPermissions();
                }
            });

            speak("Nueva solicitud de viaje");
            startLoopingRequestAlert();
            notifyNewRequest(filtered[0]);
        }
    }, [profile, activeRide, notifyNewRequest, speak]);'''
new_process_tail = r'''        const requestAlertKey = (ride) => {
            const offerId = ride.offerId ?? ride.offer_id ?? null;
            return offerId == null ? `ride:${ride.id}` : `offer:${offerId}`;
        };
        const unseenRequests = filtered.filter(
            (ride) => !announcedRequestKeysRef.current.has(requestAlertKey(ride)),
        );
        filtered.forEach((ride) => announcedRequestKeysRef.current.add(requestAlertKey(ride)));

        setRequests(prev => {
            if (replace) return filtered;
            const combined = [...filtered, ...prev];
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            return unique.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        });

        if (unseenRequests.length > 0) {
            LocalNotifications.checkPermissions().then(status => {
                if (status.display !== 'granted') void LocalNotifications.requestPermissions();
            });
            void notifyNewRequest(unseenRequests[0]);
        }
    }, [profile, activeRide, notifyNewRequest]);'''
dashboard = replace_once(dashboard, old_process_tail, new_process_tail, 'driver process request alerts')
dashboard = dashboard.replace("'higo_rides_v12'", "'higo_rides_v13_immediate'")
dashboard = replace_once(
    dashboard,
    '            if (!serverOnline) setRequests([]);',
    "            if (!serverOnline) {\n                setRequests([]);\n                announcedRequestKeysRef.current.clear();\n            }",
    'driver offline cleanup',
)
dashboard = replace_once(
    dashboard,
    '            speak(serverOnline ? "Conectado. Buscando solicitudes." : "Desconectado.");',
    "            void speakOperationalMessage(serverOnline\n                ? 'Ahora estás disponible para recibir servicios'\n                : 'Ahora estás fuera de línea');",
    'driver online operational phrase',
)
write('src/pages/DriverDashboard.jsx', dashboard)

# Chat: sound immediately anywhere in the foreground, a fresh Android channel,
# push delivery while background/killed, and deep-link opening from a push tap.
chat = read('src/components/ChatWidget.jsx')
chat = replace_once(
    chat,
    "import { Capacitor } from '@capacitor/core';",
    "import { Capacitor } from '@capacitor/core';\nimport { App as CapacitorApp } from '@capacitor/app';",
    'chat capacitor app import',
)
chat = replace_once(chat, "const CHAT_CHANNEL_ID = 'higo_messages_v2';", "const CHAT_CHANNEL_ID = 'higo_messages_v3_immediate';", 'chat channel id')
chat_deeplink_effect = r'''
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return undefined;
        let appUrlListener = null;
        let disposed = false;

        const openChatFromUrl = (url) => {
            if (!url || !url.startsWith('higo://chat')) return;
            try {
                const parsed = new URL(url);
                const nextRideId = parsed.searchParams.get('rideId');
                if (!nextRideId) return;
                setRideId(nextRideId);
                setIsOpen(true);
            } catch (error) {
                console.warn('[ride-chat] invalid push deep link:', error);
            }
        };

        void (async () => {
            try {
                appUrlListener = await CapacitorApp.addListener('appUrlOpen', ({ url }) => openChatFromUrl(url));
                const launch = await CapacitorApp.getLaunchUrl();
                if (launch?.url) openChatFromUrl(launch.url);
                if (disposed) appUrlListener?.remove?.();
            } catch (error) {
                console.warn('[ride-chat] app URL listener failed:', error);
            }
        })();

        return () => {
            disposed = true;
            appUrlListener?.remove?.();
        };
    }, []);

'''
chat = replace_once(
    chat,
    "    useEffect(() => {\n        if (!rideId) return undefined;",
    chat_deeplink_effect + "    useEffect(() => {\n        if (!rideId) return undefined;",
    'chat push deep link effect',
)
old_chat_sound = r'''            // Mientras el chat está abierto emitimos el sonido directamente.
            // Cuando está cerrado, Android espera a que el canal esté listo y
            // luego muestra el banner con alert_sound.wav.
            if (!Capacitor.isNativePlatform() || chatIsOpen) {
                void playAlertSound();
                vibrateIntense();
            }

            if (chatIsOpen) return;'''
new_chat_sound = r'''            // Realtime must sound immediately anywhere in the foreground,
            // not only while the chat panel is open. Background/killed delivery
            // is covered by the native high-priority push below.
            const appIsVisible = typeof document === 'undefined'
                || document.visibilityState === 'visible';
            if (!Capacitor.isNativePlatform() || appIsVisible) {
                void playAlertSound();
                vibrateIntense();
            }

            if (chatIsOpen) return;'''
chat = replace_once(chat, old_chat_sound, new_chat_sound, 'chat immediate foreground sound')
chat = chat.replace('schedule: { at: new Date(Date.now() + 150) },', 'schedule: { at: new Date(Date.now() + 10) },')
old_send_finish = "        setMessages((current) => mergeMessages(current, [data]));\n    };"
new_send_finish = r'''        setMessages((current) => mergeMessages(current, [data]));

        // Wake the other participant when their app is backgrounded or closed.
        // This is fire-and-forget so sending the chat message never waits on FCM.
        void (async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.access_token || !data?.id) return;
                await fetch('/api/send-ride-message-push.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ message_id: data.id, ride_id: rideId }),
                });
            } catch (pushError) {
                console.warn('[ride-chat] background push failed:', pushError);
            }
        })();
    };'''
chat = replace_once(chat, old_send_finish, new_send_finish, 'chat send push hook')
write('src/components/ChatWidget.jsx', chat)

# Directed and legacy ride push endpoints: data-only HIGH priority wakes the
# custom FirebaseMessagingService instead of waiting for Android's system tray.
offer_push = read('public/api/send-ride-offer-push.php')
offer_push = replace_once(
    offer_push,
    "    'price' => $ride['price'] !== null ? (string) $ride['price'] : '',\n    'click_action' => '/#/driver',",
    "    'price' => $ride['price'] !== null ? (string) $ride['price'] : '',\n    'title' => $title,\n    'body' => $body,\n    'click_action' => '/#/driver',",
    'offer push data title body',
)
old_offer_payload = r'''$fcmPayload = [
    'message' => [
        'token' => $token,
        'notification' => ['title' => $title, 'body' => $body],
        'data' => $data,
        'android' => [
            'priority' => 'HIGH',
            'notification' => [
                'channel_id' => 'ride_requests',
                'sound' => 'default',
                'click_action' => 'FLUTTER_NOTIFICATION_CLICK',
            ],
        ],
        'webpush' => [
            'fcm_options' => ['link' => '/#/driver'],
            'notification' => [
                'icon' => '/higo-icon.svg',
                'vibrate' => [500, 200, 500, 200, 500],
            ],
        ],
    ],
];'''
new_offer_payload = r'''$fcmPayload = [
    'message' => [
        'token' => $token,
        'data' => $data,
        'android' => [
            'priority' => 'HIGH',
            'ttl' => '20s',
            'direct_boot_ok' => true,
        ],
        'webpush' => [
            'headers' => ['Urgency' => 'high', 'TTL' => '20'],
            'fcm_options' => ['link' => '/#/driver'],
            'notification' => [
                'title' => $title,
                'body' => $body,
                'icon' => '/higo-icon.svg',
                'vibrate' => [500, 200, 500, 200, 500],
            ],
        ],
    ],
];'''
offer_push = replace_once(offer_push, old_offer_payload, new_offer_payload, 'offer data-only payload')
write('public/api/send-ride-offer-push.php', offer_push)

legacy_push = read('public/api/send-ride-request-push.php')
old_legacy_payload = r'''    $fcmPayload = [
        'message' => [
            'token'        => $token,
            'notification' => ['title' => $title, 'body' => $bodyForDriver],
            'data'         => $dataPayload,
            'android'      => [
                'priority' => 'HIGH',
                'notification' => [
                    'channel_id'   => 'ride_requests',
                    'sound'        => 'default',
                    'click_action' => 'FLUTTER_NOTIFICATION_CLICK', // no-op en Capacitor pero
                                                                    // algunos ROMs lo respetan
                ],
            ],
            'webpush' => [
                'fcm_options'  => ['link' => $clickAction],
                'notification' => [
                    'icon'    => '/higo-icon.svg',
                    'vibrate' => [500, 200, 500, 200, 500],
                ],
            ],
        ],
    ];'''
new_legacy_payload = r'''    $messageData = array_merge($dataPayload, [
        'title' => $title,
        'body' => $bodyForDriver,
    ]);
    $fcmPayload = [
        'message' => [
            'token' => $token,
            'data' => $messageData,
            'android' => [
                'priority' => 'HIGH',
                'ttl' => '30s',
                'direct_boot_ok' => true,
            ],
            'webpush' => [
                'headers' => ['Urgency' => 'high', 'TTL' => '30'],
                'fcm_options' => ['link' => $clickAction],
                'notification' => [
                    'title' => $title,
                    'body' => $bodyForDriver,
                    'icon' => '/higo-icon.svg',
                    'vibrate' => [500, 200, 500, 200, 500],
                ],
            ],
        ],
    ];'''
legacy_push = replace_once(legacy_push, old_legacy_payload, new_legacy_payload, 'legacy data-only payload')
write('public/api/send-ride-request-push.php', legacy_push)

RIDE_MESSAGE_PUSH = r'''<?php
declare(strict_types=1);

/** Authenticated FCM wake-up for passenger ↔ driver ride messages. */
require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg_cors = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg_cors, 'POST, OPTIONS');
api_rate_limit('send-ride-message-push', 90, '/tmp/higo_ratelimit.log');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function rmp_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function rmp_get(string $url, array $headers): array {
    [$status, $body] = bl_http_get($url, $headers, 15);
    $decoded = json_decode($body, true);
    return [$status, is_array($decoded) ? $decoded : []];
}

function rmp_access_token(string $saPath): string {
    if (!is_file($saPath)) throw new RuntimeException('service_account_missing');
    $cachePath = sys_get_temp_dir() . '/higo-fcm-token-' . md5($saPath) . '.json';
    if (is_file($cachePath)) {
        $cached = json_decode((string) @file_get_contents($cachePath), true);
        if (is_array($cached) && ($cached['expires'] ?? 0) > time() + 60) {
            return (string) $cached['token'];
        }
    }

    $sa = json_decode((string) file_get_contents($saPath), true);
    if (!is_array($sa) || empty($sa['client_email']) || empty($sa['private_key'])) {
        throw new RuntimeException('service_account_invalid');
    }
    $now = time();
    $b64 = static fn(string $value): string => rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    $unsigned = $b64((string) json_encode(['alg' => 'RS256', 'typ' => 'JWT']))
        . '.' . $b64((string) json_encode([
            'iss' => $sa['client_email'],
            'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
            'aud' => 'https://oauth2.googleapis.com/token',
            'iat' => $now,
            'exp' => $now + 3600,
        ], JSON_UNESCAPED_SLASHES));
    $signature = '';
    if (!openssl_sign($unsigned, $signature, $sa['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('openssl_sign_failed');
    }

    [$status, $body] = bl_http_post(
        'https://oauth2.googleapis.com/token',
        http_build_query([
            'grant_type' => 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
            'assertion' => $unsigned . '.' . $b64($signature),
        ]),
        ['Content-Type: application/x-www-form-urlencoded'],
        15
    );
    if ($status !== 200) throw new RuntimeException("google_oauth_$status");
    $response = json_decode($body, true);
    if (!is_array($response) || empty($response['access_token'])) {
        throw new RuntimeException('bad_token_response');
    }
    @file_put_contents($cachePath, (string) json_encode([
        'token' => $response['access_token'],
        'expires' => $now + (int) ($response['expires_in'] ?? 3000),
    ]));
    return (string) $response['access_token'];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') rmp_send(405, ['ok' => false, 'error' => 'method_not_allowed']);

$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!str_starts_with($authorization, 'Bearer ') || substr_count($authorization, '.') < 2) {
    rmp_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = substr($authorization, 7);

try { $cfg = bl_load_config(); }
catch (Throwable $error) { rmp_send(503, ['ok' => false, 'error' => 'config_missing']); }
foreach (['SUPABASE_PROJECT_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_SA_PATH'] as $key) {
    if (empty($cfg[$key])) rmp_send(503, ['ok' => false, 'error' => 'config_incomplete', 'detail' => "missing_$key"]);
}

$supaUrl = rtrim((string) $cfg['SUPABASE_PROJECT_URL'], '/');
$supaKey = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
$projectId = (string) $cfg['FIREBASE_PROJECT_ID'];
$serviceHeaders = ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey];

$body = json_decode((string) file_get_contents('php://input'), true);
$messageId = (int) ($body['message_id'] ?? 0);
$requestedRideId = (string) ($body['ride_id'] ?? '');
if ($messageId <= 0) rmp_send(400, ['ok' => false, 'error' => 'message_id_required']);

[$userStatus, $userBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $callerJwt],
    15
);
if ($userStatus !== 200) rmp_send(401, ['ok' => false, 'error' => 'invalid_token']);
$caller = json_decode($userBody, true);
$callerId = (string) ($caller['id'] ?? '');
if ($callerId === '') rmp_send(401, ['ok' => false, 'error' => 'invalid_token']);

[, $messageRows] = rmp_get(
    $supaUrl . '/rest/v1/ride_messages?id=eq.' . $messageId
        . '&select=id,ride_id,sender_id,content,created_at&limit=1',
    $serviceHeaders
);
$message = $messageRows[0] ?? null;
if (!is_array($message)) rmp_send(404, ['ok' => false, 'error' => 'message_not_found']);
if ((string) ($message['sender_id'] ?? '') !== $callerId) rmp_send(409, ['ok' => false, 'error' => 'sender_mismatch']);

$rideId = (string) ($message['ride_id'] ?? '');
if ($rideId === '' || ($requestedRideId !== '' && $requestedRideId !== $rideId)) {
    rmp_send(409, ['ok' => false, 'error' => 'ride_mismatch']);
}

[, $rideRows] = rmp_get(
    $supaUrl . '/rest/v1/rides?id=eq.' . rawurlencode($rideId)
        . '&select=id,user_id,driver_id,status&limit=1',
    $serviceHeaders
);
$ride = $rideRows[0] ?? null;
if (!is_array($ride)) rmp_send(404, ['ok' => false, 'error' => 'ride_not_found']);

$passengerId = (string) ($ride['user_id'] ?? '');
$driverId = (string) ($ride['driver_id'] ?? '');
if ($callerId === $passengerId) $recipientId = $driverId;
elseif ($callerId === $driverId) $recipientId = $passengerId;
else rmp_send(403, ['ok' => false, 'error' => 'not_a_participant']);
if ($recipientId === '') rmp_send(200, ['ok' => true, 'sent' => 0, 'note' => 'recipient_not_assigned']);

[, $profileRows] = rmp_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($recipientId)
        . '&fcm_token=not.is.null&select=id,fcm_token&limit=1',
    $serviceHeaders
);
$recipient = $profileRows[0] ?? null;
$token = is_array($recipient) ? (string) ($recipient['fcm_token'] ?? '') : '';
if ($token === '') rmp_send(200, ['ok' => true, 'sent' => 0, 'note' => 'recipient_without_token']);

$preview = trim(preg_replace('/\s+/', ' ', (string) ($message['content'] ?? '')) ?? '');
if ($preview === '') $preview = 'Tienes un nuevo mensaje';
$preview = mb_substr($preview, 0, 140);
$title = 'Nuevo mensaje del viaje';
$clickAction = '/#/ride/' . rawurlencode($rideId);

try { $accessToken = rmp_access_token((string) $cfg['FIREBASE_SA_PATH']); }
catch (Throwable $error) { rmp_send(500, ['ok' => false, 'error' => 'oauth_fail', 'detail' => $error->getMessage()]); }

$fcmPayload = [
    'message' => [
        'token' => $token,
        'data' => [
            'type' => 'ride_message',
            'ride_id' => $rideId,
            'message_id' => (string) $messageId,
            'title' => $title,
            'body' => $preview,
            'click_action' => $clickAction,
        ],
        'android' => [
            'priority' => 'HIGH',
            'ttl' => '60s',
            'direct_boot_ok' => true,
        ],
        'webpush' => [
            'headers' => ['Urgency' => 'high', 'TTL' => '60'],
            'fcm_options' => ['link' => $clickAction],
            'notification' => [
                'title' => $title,
                'body' => $preview,
                'icon' => '/higo-icon.svg',
                'tag' => 'ride-message-' . $rideId,
                'vibrate' => [180, 100, 180],
            ],
        ],
    ],
];

[$fcmStatus, $fcmBody] = bl_http_post(
    "https://fcm.googleapis.com/v1/projects/$projectId/messages:send",
    (string) json_encode($fcmPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ['Authorization: Bearer ' . $accessToken, 'Content-Type: application/json'],
    15
);
if ($fcmStatus >= 200 && $fcmStatus < 300) {
    rmp_send(200, ['ok' => true, 'sent' => 1, 'message_id' => $messageId, 'ride_id' => $rideId]);
}

if ($fcmStatus === 404 || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
    bl_http_patch(
        $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($recipientId),
        (string) json_encode(['fcm_token' => null]),
        array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
        10
    );
}
rmp_send(502, ['ok' => false, 'error' => 'fcm_failed', 'status' => $fcmStatus, 'detail' => substr((string) $fcmBody, 0, 240)]);
'''
write('public/api/send-ride-message-push.php', RIDE_MESSAGE_PUSH)

NATIVE_FCM_SERVICE = r'''package com.higoapp.ve;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;

public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String RIDE_CHANNEL_ID = "higo_rides_v13_immediate";
    private static final String CHAT_CHANNEL_ID = "higo_messages_v3_immediate";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        if (remoteMessage.getData().isEmpty()) return;

        String type = value(remoteMessage, "type");
        if ("ride_message".equals(type)) {
            // Realtime handles foreground chat instantly. Native push is the
            // reliable background/killed path and must not duplicate it.
            if (!isAppInForeground()) showChatNotification(remoteMessage);
            return;
        }
        if ("ride_request".equals(type) || remoteMessage.getData().containsKey("price")) {
            showRideNotification(remoteMessage);
        }
    }

    private String value(RemoteMessage message, String... keys) {
        for (String key : keys) {
            String candidate = message.getData().get(key);
            if (candidate != null && !candidate.isEmpty()) return candidate;
        }
        return null;
    }

    private Uri alertSoundUri() {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.alert_sound);
    }

    private void ensureChannel(String id, String name, String description) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
        channel.setSound(alertSoundUri(), attributes);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    private void showRideNotification(RemoteMessage remoteMessage) {
        ensureChannel(RIDE_CHANNEL_ID, "Solicitudes Higo", "Nuevas solicitudes de viaje y envíos");
        String title = value(remoteMessage, "title");
        if (title == null) title = "¡Solicitud de Viaje!";
        String body = value(remoteMessage, "body");
        if (body == null) body = "Tienes una nueva solicitud de viaje.";
        String rideId = value(remoteMessage, "ride_id", "rideId", "id");
        int notificationId = rideId != null ? rideId.hashCode() : (int) System.currentTimeMillis();

        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (String key : remoteMessage.getData().keySet()) {
            fullScreenIntent.putExtra(key, remoteMessage.getData().get(key));
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notificationId, fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent acceptIntent = new Intent(Intent.ACTION_VIEW);
        acceptIntent.setData(Uri.parse("higo://accept?rideId=" + Uri.encode(rideId != null ? rideId : "")));
        acceptIntent.setPackage(getPackageName());
        acceptIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent acceptPendingIntent = PendingIntent.getActivity(
                this, notificationId + 1, acceptIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RIDE_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setFullScreenIntent(contentIntent, true)
                .setContentIntent(contentIntent)
                .setSound(alertSoundUri())
                .setVibrate(new long[]{0, 1000, 500, 1000, 500, 1000})
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_menu_add, "Aceptar Viaje", acceptPendingIntent);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(notificationId, builder.build());
    }

    private void showChatNotification(RemoteMessage remoteMessage) {
        ensureChannel(CHAT_CHANNEL_ID, "Mensajes del viaje", "Mensajes entre pasajero y conductor");
        String title = value(remoteMessage, "title");
        if (title == null) title = "Nuevo mensaje del viaje";
        String body = value(remoteMessage, "body");
        if (body == null) body = "Tienes un nuevo mensaje";
        String rideId = value(remoteMessage, "ride_id", "rideId");
        String messageId = value(remoteMessage, "message_id", "messageId");
        int notificationId = messageId != null
                ? messageId.hashCode()
                : (rideId != null ? ("chat:" + rideId).hashCode() : (int) System.currentTimeMillis());

        Intent openChatIntent = new Intent(Intent.ACTION_VIEW);
        openChatIntent.setData(Uri.parse("higo://chat?rideId=" + Uri.encode(rideId != null ? rideId : "")));
        openChatIntent.setPackage(getPackageName());
        openChatIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notificationId, openChatIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHAT_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(contentIntent)
                .setSound(alertSoundUri())
                .setVibrate(new long[]{0, 180, 100, 180})
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(notificationId, builder.build());
    }

    private boolean isAppInForeground() {
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return false;
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return false;
        String packageName = getPackageName();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (packageName.equals(process.processName)
                    && process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                return true;
            }
        }
        return false;
    }
}
'''
write('android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java', NATIVE_FCM_SERVICE)

# Release version and existing regression expectations.
gradle = read('android/app/build.gradle')
gradle = gradle.replace('// Higo 1.5.22: Higo Envíos voice milestones.', '// Higo 1.5.23: immediate driver and chat notifications.')
gradle = replace_once(gradle, 'versionCode 54', 'versionCode 55', 'android version code')
gradle = replace_once(gradle, 'versionName "1.5.22"', 'versionName "1.5.23"', 'android version name')
write('android/app/build.gradle', gradle)

for test_path in (ROOT / 'tests').glob('*.mjs'):
    source = test_path.read_text(encoding='utf-8')
    source = source.replace('versionCode 54', 'versionCode 55')
    source = source.replace('1\\.5\\.22', '1\\.5\\.23')
    test_path.write_text(source, encoding='utf-8')

REGRESSION_TEST = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('driver online confirmation uses operational native TTS with the exact phrase', async () => {
    const [dashboard, notifications] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/services/notificationService.js'),
    ]);
    assert.match(dashboard, /Ahora estás disponible para recibir servicios/);
    assert.match(dashboard, /speakOperationalMessage\(serverOnline/);
    assert.match(notifications, /@capacitor-community\/text-to-speech/);
    assert.match(notifications, /export const speakOperationalMessage/);
});

test('directed offer reconciliation alerts unseen offers immediately', async () => {
    const dashboard = await read('src/pages/DriverDashboard.jsx');
    assert.match(dashboard, /announcedRequestKeysRef/);
    assert.match(dashboard, /const unseenRequests = filtered\.filter/);
    assert.match(dashboard, /void notifyNewRequest\(unseenRequests\[0\]\)/);
    assert.doesNotMatch(dashboard, /if \(!replace && filtered\.length > 0\)/);
    assert.match(dashboard, /higo_rides_v13_immediate/);
});

test('ride chat sounds outside the open panel and sends a background push', async () => {
    const chat = await read('src/components/ChatWidget.jsx');
    const soundIndex = chat.indexOf('void playAlertSound();', chat.indexOf('const appIsVisible'));
    const openReturnIndex = chat.indexOf('if (chatIsOpen) return;', chat.indexOf('const appIsVisible'));
    assert.ok(soundIndex >= 0 && soundIndex < openReturnIndex);
    assert.match(chat, /send-ride-message-push\.php/);
    assert.match(chat, /higo_messages_v3_immediate/);
    assert.match(chat, /higo:\/\/chat/);
});

test('Android uses high-priority data-only paths for fresh ride and chat alerts', async () => {
    const [nativeService, directedPush, legacyPush, chatPush] = await Promise.all([
        read('android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java'),
        read('public/api/send-ride-offer-push.php'),
        read('public/api/send-ride-request-push.php'),
        read('public/api/send-ride-message-push.php'),
    ]);
    assert.match(nativeService, /"ride_message"\.equals\(type\)/);
    assert.match(nativeService, /higo_rides_v13_immediate/);
    assert.match(nativeService, /higo_messages_v3_immediate/);
    assert.match(directedPush, /'ttl' => '20s'/);
    assert.match(legacyPush, /'ttl' => '30s'/);
    assert.match(chatPush, /'type' => 'ride_message'/);
    assert.match(chatPush, /'priority' => 'HIGH'/);
});

test('release is Higo 1.5.23 build 55', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 55/);
    assert.match(gradle, /versionName "1\.5\.23"/);
});
'''
write('tests/notificationLatencyRegression.test.mjs', REGRESSION_TEST)

print('Applied Higo 1.5.23 notification latency corrections.')
