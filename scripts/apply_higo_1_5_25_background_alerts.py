#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path, old, new):
    content = read(path)
    if old not in content:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


trigger_emergency = r"""import { supabase } from '../services/supabase';
import { logger } from './logger';
import { apiUrl } from './apiUrl';

const GEO_SOFT_TIMEOUT_MS = 700;
const GEO_FOLLOW_UP_TIMEOUT_MS = 12000;
const LOCATION_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const LOCATION_CACHE_KEY = 'higo:last-known-location';

const validCoordinate = (value, min, max) => (
    Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max
);

const normalizeLocation = (value) => {
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) return null;
    return { lat, lng };
};

const readCachedLocation = () => {
    if (typeof window === 'undefined') return null;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(LOCATION_CACHE_KEY) || 'null');
        if (!parsed || Date.now() - Number(parsed.savedAt || 0) > LOCATION_CACHE_MAX_AGE_MS) return null;
        return normalizeLocation(parsed);
    } catch {
        return null;
    }
};

const cacheLocation = (location) => {
    if (typeof window === 'undefined' || !location) return;
    try {
        window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({
            ...location,
            savedAt: Date.now(),
        }));
    } catch {
        // Storage is best-effort; the emergency request must never depend on it.
    }
};

const requestLocation = (timeoutMs) => new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
    }

    let settled = false;
    const finish = (value) => {
        if (settled) return;
        settled = true;
        const normalized = normalizeLocation(value);
        if (normalized) cacheLocation(normalized);
        resolve(normalized);
    };

    const timer = setTimeout(() => finish(null), timeoutMs + 250);
    navigator.geolocation.getCurrentPosition(
        (position) => {
            clearTimeout(timer);
            finish({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            });
        },
        () => {
            clearTimeout(timer);
            finish(null);
        },
        {
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 60000,
        },
    );
});

const wait = (ms, value = null) => new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
});

const locationsMatch = (left, right) => (
    left && right
    && Math.abs(left.lat - right.lat) < 0.00001
    && Math.abs(left.lng - right.lng) < 0.00001
);

const postJson = async (path, token, body, keepalive = true) => {
    const response = await fetch(apiUrl(path), {
        method: 'POST',
        keepalive,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* non-JSON response */ }

    if (!response.ok) {
        throw new Error(`${path} returned ${response.status}: ${text.slice(0, 200)}`);
    }
    return payload || {};
};

export const triggerEmergencyAlert = async ({ rideId, triggeredBy }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No session token for emergency alert');

    // Start a longer high-accuracy lookup immediately, but never delay the
    // initial SOS by more than 700 ms. A fresh cached point is preferable to
    // sending null while the GPS warms up.
    const locationPromise = requestLocation(GEO_FOLLOW_UP_TIMEOUT_MS);
    const fastLocation = await Promise.race([
        locationPromise,
        wait(GEO_SOFT_TIMEOUT_MS),
    ]);
    const initialLocation = fastLocation || readCachedLocation();

    const payload = await postJson('/api/send-emergency.php', token, {
        ride_id: rideId || null,
        lat: initialLocation?.lat ?? null,
        lng: initialLocation?.lng ?? null,
        triggered_by: triggeredBy || 'passenger',
    });

    // The emergency is already persisted. Continue resolving GPS in the
    // background and append the precise coordinates to the SOS/admin thread.
    void locationPromise.then(async (preciseLocation) => {
        if (!preciseLocation || !payload?.sos_id || locationsMatch(initialLocation, preciseLocation)) return;
        try {
            await postJson('/api/update-emergency-location.php', token, {
                sos_id: payload.sos_id,
                support_thread_id: payload.support_thread_id || null,
                lat: preciseLocation.lat,
                lng: preciseLocation.lng,
            });
            logger.debug('[SOS] precise location attached to event #' + payload.sos_id);
        } catch (error) {
            console.warn('[SOS] precise location follow-up failed:', error);
        }
    });

    if (payload?.support_ok === false) {
        console.warn('[SOS] support chat integration failed. Request ID: ' + (payload.request_id || '?'));
    } else if (payload?.support_thread_id) {
        logger.debug('[SOS] OK · thread #' + payload.support_thread_id + ' · req=' + (payload.request_id || '?'));
    } else {
        logger.debug('[SOS] OK · response:', payload);
    }

    return payload;
};
"""
write("src/utils/triggerEmergencyAlert.js", trigger_emergency)

update_emergency_php = r"""<?php
declare(strict_types=1);

/**
 * Adds a precise GPS point to an already-created SOS without delaying the
 * initial emergency request. The caller may only update its own SOS event.
 */
require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('update-emergency-location', 20, '/tmp/higo_ratelimit.log');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function uel_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    uel_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $match)) {
    uel_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = trim((string) $match[1]);

$supaUrl = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaKey = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
$supaAnon = (string) ($cfg['SUPABASE_ANON_KEY'] ?? '');
if ($supaUrl === '' || $supaKey === '' || $supaAnon === '') {
    uel_send(503, ['ok' => false, 'error' => 'config_missing']);
}

[$userStatus, $userBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaAnon, 'Authorization: Bearer ' . $callerJwt],
    15
);
if ($userStatus !== 200) uel_send(401, ['ok' => false, 'error' => 'invalid_token']);
$user = json_decode((string) $userBody, true);
$callerId = (string) ($user['id'] ?? '');
if ($callerId === '') uel_send(401, ['ok' => false, 'error' => 'invalid_token']);

$body = json_decode((string) file_get_contents('php://input'), true);
$sosId = (int) ($body['sos_id'] ?? 0);
$threadId = (int) ($body['support_thread_id'] ?? 0);
$lat = isset($body['lat']) ? (float) $body['lat'] : null;
$lng = isset($body['lng']) ? (float) $body['lng'] : null;
if ($sosId <= 0) uel_send(400, ['ok' => false, 'error' => 'sos_id_required']);
if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
    uel_send(400, ['ok' => false, 'error' => 'invalid_coordinates']);
}

$serviceHeaders = ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey];
[$eventStatus, $eventBody] = bl_http_get(
    $supaUrl . '/rest/v1/sos_events?id=eq.' . $sosId . '&select=id,user_id,ride_id&limit=1',
    $serviceHeaders,
    15
);
$events = json_decode((string) $eventBody, true);
$event = is_array($events) ? ($events[0] ?? null) : null;
if ($eventStatus !== 200 || !is_array($event)) uel_send(404, ['ok' => false, 'error' => 'sos_not_found']);
if ((string) ($event['user_id'] ?? '') !== $callerId) uel_send(403, ['ok' => false, 'error' => 'not_owner']);

[$patchStatus] = bl_http_patch(
    $supaUrl . '/rest/v1/sos_events?id=eq.' . $sosId,
    (string) json_encode([
        'location_lat' => $lat,
        'location_lng' => $lng,
    ]),
    array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
    15
);
if ($patchStatus < 200 || $patchStatus >= 300) {
    uel_send(502, ['ok' => false, 'error' => 'sos_update_failed']);
}

$supportUpdated = false;
if ($threadId > 0) {
    [$threadStatus, $threadBody] = bl_http_get(
        $supaUrl . '/rest/v1/support_threads?id=eq.' . $threadId . '&select=id,user_id&limit=1',
        $serviceHeaders,
        15
    );
    $threads = json_decode((string) $threadBody, true);
    $thread = is_array($threads) ? ($threads[0] ?? null) : null;
    if ($threadStatus === 200 && is_array($thread) && (string) ($thread['user_id'] ?? '') === $callerId) {
        $maps = 'https://www.google.com/maps?q=' . $lat . ',' . $lng;
        $message = "📍 UBICACIÓN SOS ACTUALIZADA\n"
            . "- Evento SOS: #" . $sosId . "\n"
            . "- Coordenadas: " . $lat . ", " . $lng . "\n"
            . "- Google Maps: " . $maps . "\n"
            . "- Hora UTC: " . gmdate('Y-m-d H:i:s');

        [$messageStatus] = bl_http_post(
            $supaUrl . '/rest/v1/support_messages',
            (string) json_encode([
                'thread_id' => $threadId,
                'sender_id' => $callerId,
                'sender_role' => 'user',
                'content' => $message,
            ]),
            array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
            15
        );
        if ($messageStatus >= 200 && $messageStatus < 300) {
            $supportUpdated = true;
            bl_http_patch(
                $supaUrl . '/rest/v1/support_threads?id=eq.' . $threadId,
                (string) json_encode([
                    'status' => 'open',
                    'unread_for_admin' => true,
                    'last_message_at' => gmdate('c'),
                ]),
                array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
                10
            );
        }
    }
}

uel_send(200, [
    'ok' => true,
    'sos_id' => $sosId,
    'support_updated' => $supportUpdated,
]);
"""
write("public/api/update-emergency-location.php", update_emergency_php)

replace_once(
    "public/api/send-ride-message-push.php",
    "if (!str_starts_with($authorization, 'Bearer ') || substr_count($authorization, '.') < 2) {",
    "if ($authorization === '' || strpos($authorization, 'Bearer ') !== 0 || substr_count($authorization, '.') < 2) {",
)
replace_once(
    "public/api/send-ride-message-push.php",
    "$preview = mb_substr($preview, 0, 140);",
    "$preview = function_exists('mb_substr') ? mb_substr($preview, 0, 140) : substr($preview, 0, 140);",
)

replace_once(
    "src/components/ChatWidget.jsx",
    """                await fetch('/api/send-ride-message-push.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ message_id: data.id, ride_id: rideId }),
                });""",
    """                const pushResponse = await fetch('/api/send-ride-message-push.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ message_id: data.id, ride_id: rideId }),
                });
                const pushText = await pushResponse.text();
                if (!pushResponse.ok) {
                    console.warn(
                        '[ride-chat] background push rejected:',
                        pushResponse.status,
                        pushText.slice(0, 240),
                    );
                }""",
)

send_status_js = r"""import { supabase } from '../services/supabase';
import { apiUrl } from './apiUrl';

export const sendRideStatusPush = async ({ rideId, milestone }) => {
    if (!rideId || !milestone) return { ok: false, skipped: true };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, skipped: true };

    const response = await fetch(apiUrl('/api/send-ride-status-push.php'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            ride_id: rideId,
            milestone,
        }),
    });

    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* non-JSON response */ }

    if (!response.ok) {
        throw new Error(`ride status push ${response.status}: ${text.slice(0, 240)}`);
    }
    return payload || { ok: true };
};

export const queueRideStatusPush = (args) => {
    void sendRideStatusPush(args).catch((error) => {
        console.warn('[ride-status-push] delivery failed:', error);
    });
};
"""
write("src/utils/sendRideStatusPush.js", send_status_js)

replace_once(
    "src/hooks/useDriverActiveTrip.js",
    "import { sendDeliveryMilestone } from '../utils/sendDeliveryMilestone';",
    "import { sendDeliveryMilestone } from '../utils/sendDeliveryMilestone';\nimport { queueRideStatusPush } from '../utils/sendRideStatusPush';",
)
replace_once(
    "src/hooks/useDriverActiveTrip.js",
    """            setNavStep(1);
            setArrivalTime(null);
            speak(`Viaje aceptado. Navegando a ${ride.pickup}`);""",
    """            setNavStep(1);
            setArrivalTime(null);
            queueRideStatusPush({ rideId: accepted?.id || ride.id, milestone: 'driver_found' });
            speak(`Viaje aceptado. Navegando a ${ride.pickup}`);""",
)
replace_once(
    "src/hooks/useDriverActiveTrip.js",
    """            setWaitElapsedSec(0);
            setWaitFee(0);
            speak('Llegada marcada. Esperando al pasajero.');""",
    """            setWaitElapsedSec(0);
            setWaitFee(0);
            queueRideStatusPush({ rideId: updated?.id || activeRideRef.current.id, milestone: 'arrived' });
            speak('Llegada marcada. Esperando al pasajero.');""",
)
replace_once(
    "src/hooks/useDriverActiveTrip.js",
    """            setWaitFee(Number(updated.wait_fee || 0));
            return updated;""",
    """            setWaitFee(Number(updated.wait_fee || 0));
            queueRideStatusPush({ rideId: ride.id, milestone: 'started' });
            return updated;""",
)
replace_once(
    "src/hooks/useDriverActiveTrip.js",
    """        setWaitFee(fee);
        setActiveRide((current) => ({ ...current, ...data }));
        return data;""",
    """        setWaitFee(fee);
        setActiveRide((current) => ({ ...current, ...data }));
        queueRideStatusPush({ rideId: ride.id, milestone: 'started' });
        return data;""",
)
replace_once(
    "src/hooks/useDriverActiveTrip.js",
    """            setActiveRide((current) => ({ ...current, ...updated }));
            if (delivery) sendDeliveryMilestone({ rideId: ride.id, status: 'completed' });""",
    """            setActiveRide((current) => ({ ...current, ...updated }));
            queueRideStatusPush({ rideId: ride.id, milestone: 'completed' });
            if (delivery) sendDeliveryMilestone({ rideId: ride.id, status: 'completed' });""",
)

send_status_php = r"""<?php
declare(strict_types=1);

/** Authenticated FCM notification for passenger ride milestones. */
require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('send-ride-status-push', 90, '/tmp/higo_ratelimit.log');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function rsp_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function rsp_get(string $url, array $headers): array {
    [$status, $body] = bl_http_get($url, $headers, 15);
    $decoded = json_decode((string) $body, true);
    return [$status, is_array($decoded) ? $decoded : []];
}

function rsp_access_token(string $saPath): string {
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
    $b64 = static function (string $value): string {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    };
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
            'grant_type' => 'urn:ietf:params:oauth2-bearer',
            'assertion' => $unsigned . '.' . $b64($signature),
        ]),
        ['Content-Type: application/x-www-form-urlencoded'],
        15
    );
    if ($status !== 200) throw new RuntimeException('google_oauth_' . $status);

    $response = json_decode((string) $body, true);
    if (!is_array($response) || empty($response['access_token'])) {
        throw new RuntimeException('bad_token_response');
    }
    @file_put_contents($cachePath, (string) json_encode([
        'token' => $response['access_token'],
        'expires' => $now + (int) ($response['expires_in'] ?? 3000),
    ]));
    return (string) $response['access_token'];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') rsp_send(405, ['ok' => false, 'error' => 'method_not_allowed']);

$authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if ($authorization === '' || strpos($authorization, 'Bearer ') !== 0 || substr_count($authorization, '.') < 2) {
    rsp_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = substr($authorization, 7);

foreach (['SUPABASE_PROJECT_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_SA_PATH'] as $key) {
    if (empty($cfg[$key])) rsp_send(503, ['ok' => false, 'error' => 'config_incomplete', 'detail' => 'missing_' . $key]);
}
$supaUrl = rtrim((string) $cfg['SUPABASE_PROJECT_URL'], '/');
$supaKey = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
$projectId = (string) $cfg['FIREBASE_PROJECT_ID'];
$serviceHeaders = ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey];

$body = json_decode((string) file_get_contents('php://input'), true);
$rideId = trim((string) ($body['ride_id'] ?? ''));
$milestone = trim((string) ($body['milestone'] ?? ''));
$allowed = ['driver_found', 'arrived', 'started', 'completed'];
if ($rideId === '') rsp_send(400, ['ok' => false, 'error' => 'ride_id_required']);
if (!in_array($milestone, $allowed, true)) rsp_send(400, ['ok' => false, 'error' => 'invalid_milestone']);

[$userStatus, $userBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $callerJwt],
    15
);
if ($userStatus !== 200) rsp_send(401, ['ok' => false, 'error' => 'invalid_token']);
$caller = json_decode((string) $userBody, true);
$callerId = (string) ($caller['id'] ?? '');
if ($callerId === '') rsp_send(401, ['ok' => false, 'error' => 'invalid_token']);

[, $rideRows] = rsp_get(
    $supaUrl . '/rest/v1/rides?id=eq.' . rawurlencode($rideId)
        . '&select=id,user_id,driver_id,status,arrived_at_pickup_at,service_type,delivery_info&limit=1',
    $serviceHeaders
);
$ride = $rideRows[0] ?? null;
if (!is_array($ride)) rsp_send(404, ['ok' => false, 'error' => 'ride_not_found']);
if ((string) ($ride['driver_id'] ?? '') !== $callerId) {
    rsp_send(403, ['ok' => false, 'error' => 'driver_mismatch']);
}

$status = (string) ($ride['status'] ?? '');
$validState = false;
if ($milestone === 'driver_found') $validState = in_array($status, ['accepted', 'in_progress', 'arrived_at_dropoff', 'completed'], true);
if ($milestone === 'arrived') $validState = !empty($ride['arrived_at_pickup_at']);
if ($milestone === 'started') $validState = in_array($status, ['in_progress', 'arrived_at_dropoff', 'completed'], true);
if ($milestone === 'completed') $validState = $status === 'completed';
if (!$validState) rsp_send(409, ['ok' => false, 'error' => 'milestone_state_mismatch', 'status' => $status]);

$passengerId = (string) ($ride['user_id'] ?? '');
if ($passengerId === '') rsp_send(200, ['ok' => true, 'sent' => 0, 'note' => 'passenger_missing']);

[, $profileRows] = rsp_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($passengerId)
        . '&fcm_token=not.is.null&select=id,fcm_token&limit=1',
    $serviceHeaders
);
$recipient = $profileRows[0] ?? null;
$token = is_array($recipient) ? (string) ($recipient['fcm_token'] ?? '') : '';
if ($token === '') rsp_send(200, ['ok' => true, 'sent' => 0, 'note' => 'passenger_without_token']);

$isDelivery = (string) ($ride['service_type'] ?? '') === 'delivery' || !empty($ride['delivery_info']);
$messages = [
    'driver_found' => [
        'title' => 'Higo Driver encontrado',
        'body' => 'Tu conductor aceptó el viaje y va hacia el punto de encuentro.',
        'voice' => 'Higo Driver encontrado',
    ],
    'arrived' => [
        'title' => $isDelivery ? 'El conductor llegó' : 'Tu Higo Driver llegó',
        'body' => $isDelivery
            ? 'El conductor llegó al punto de recolección.'
            : 'Tu conductor llegó al punto de encuentro.',
        'voice' => $isDelivery
            ? 'El conductor ha llegado al punto de recolección'
            : 'Tu Higo Driver ha llegado al punto de encuentro',
    ],
    'started' => [
        'title' => $isDelivery ? 'Envío en camino' : 'Viaje iniciado',
        'body' => $isDelivery
            ? 'Tu paquete fue recogido y va camino al destino.'
            : 'Tu viaje ha comenzado. Vas rumbo a tu destino.',
        'voice' => $isDelivery ? 'Tu envío está en camino' : 'Tu viaje ha comenzado',
    ],
    'completed' => [
        'title' => $isDelivery ? 'Envío entregado' : 'Destino alcanzado',
        'body' => $isDelivery
            ? 'Tu envío fue entregado con éxito.'
            : 'Has llegado a tu destino.',
        'voice' => $isDelivery ? 'Tu envío ha sido entregado' : 'Has llegado a tu destino',
    ],
];
$message = $messages[$milestone];
$clickAction = '/#/ride/' . rawurlencode($rideId);

try { $accessToken = rsp_access_token((string) $cfg['FIREBASE_SA_PATH']); }
catch (Throwable $error) { rsp_send(500, ['ok' => false, 'error' => 'oauth_fail']); }

$fcmPayload = [
    'message' => [
        'token' => $token,
        'data' => [
            'type' => 'ride_status',
            'ride_id' => $rideId,
            'milestone' => $milestone,
            'title' => $message['title'],
            'body' => $message['body'],
            'voice_text' => $message['voice'],
            'click_action' => $clickAction,
        ],
        'android' => [
            'priority' => 'HIGH',
            'ttl' => '120s',
            'direct_boot_ok' => true,
        ],
        'webpush' => [
            'headers' => ['Urgency' => 'high', 'TTL' => '120'],
            'fcm_options' => ['link' => $clickAction],
            'notification' => [
                'title' => $message['title'],
                'body' => $message['body'],
                'icon' => '/higo-icon.svg',
                'tag' => 'ride-status-' . $rideId . '-' . $milestone,
                'renotify' => true,
                'vibrate' => [250, 120, 250],
            ],
        ],
    ],
];

[$fcmStatus, $fcmBody] = bl_http_post(
    'https://fcm.googleapis.com/v1/projects/' . $projectId . '/messages:send',
    (string) json_encode($fcmPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ['Authorization: Bearer ' . $accessToken, 'Content-Type: application/json'],
    15
);
if ($fcmStatus >= 200 && $fcmStatus < 300) {
    rsp_send(200, ['ok' => true, 'sent' => 1, 'ride_id' => $rideId, 'milestone' => $milestone]);
}

if ($fcmStatus === 404 || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
    bl_http_patch(
        $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($passengerId),
        (string) json_encode(['fcm_token' => null]),
        array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
        10
    );
}
rsp_send(502, [
    'ok' => false,
    'error' => 'fcm_failed',
    'status' => $fcmStatus,
    'detail' => substr((string) $fcmBody, 0, 240),
]);
"""
write("public/api/send-ride-status-push.php", send_status_php)

firebase_service = r"""package com.higoapp.ve;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Locale;

public class MyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String RIDE_CHANNEL_ID = "higo_rides_v13_immediate";
    private static final String CHAT_CHANNEL_ID = "higo_messages_v3_immediate";
    private static final String STATUS_CHANNEL_ID = "higo_ride_status_v1";
    private static final String STATUS_PREFS = "higo_ride_status_dedupe";
    private static final long STATUS_DEDUPE_MS = 24L * 60L * 60L * 1000L;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        if (remoteMessage.getData().isEmpty()) return;

        String type = value(remoteMessage, "type");
        if ("ride_message".equals(type)) {
            if (!isAppInForeground()) showChatNotification(remoteMessage);
            return;
        }
        if ("ride_status".equals(type)) {
            if (!isAppInForeground() && markRideStatusAsNew(remoteMessage)) {
                showRideStatusNotification(remoteMessage);
                speakRideStatus(remoteMessage);
            }
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

    private void showRideStatusNotification(RemoteMessage remoteMessage) {
        ensureChannel(STATUS_CHANNEL_ID, "Estado del viaje", "Avisos de llegada, inicio y finalización del viaje");
        String title = value(remoteMessage, "title");
        if (title == null) title = "Actualización de tu viaje";
        String body = value(remoteMessage, "body");
        if (body == null) body = "Tu viaje tiene una actualización";
        String rideId = value(remoteMessage, "ride_id", "rideId");
        String milestone = value(remoteMessage, "milestone");
        int notificationId = ("status:" + (rideId != null ? rideId : "") + ":" + (milestone != null ? milestone : "")).hashCode();

        Intent openRideIntent = new Intent(Intent.ACTION_VIEW);
        openRideIntent.setData(Uri.parse("higo://ride?rideId=" + Uri.encode(rideId != null ? rideId : "")));
        openRideIntent.setPackage(getPackageName());
        openRideIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notificationId, openRideIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, STATUS_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(contentIntent)
                .setSound(alertSoundUri())
                .setVibrate(new long[]{0, 250, 120, 250})
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(notificationId, builder.build());
    }

    private boolean markRideStatusAsNew(RemoteMessage remoteMessage) {
        String rideId = value(remoteMessage, "ride_id", "rideId");
        String milestone = value(remoteMessage, "milestone");
        if (rideId == null || milestone == null) return true;

        String key = rideId + ":" + milestone;
        long now = System.currentTimeMillis();
        SharedPreferences preferences = getSharedPreferences(STATUS_PREFS, MODE_PRIVATE);
        long previous = preferences.getLong(key, 0L);
        if (previous > 0L && now - previous < STATUS_DEDUPE_MS) return false;
        preferences.edit().putLong(key, now).apply();
        return true;
    }

    private void speakRideStatus(RemoteMessage remoteMessage) {
        final String text = value(remoteMessage, "voice_text", "body");
        if (text == null || text.trim().isEmpty()) return;

        final TextToSpeech[] engine = new TextToSpeech[1];
        engine[0] = new TextToSpeech(getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS || engine[0] == null) {
                if (engine[0] != null) engine[0].shutdown();
                return;
            }
            engine[0].setLanguage(new Locale("es", "ES"));
            engine[0].setSpeechRate(1.0f);
            engine[0].setPitch(1.0f);
            final String utteranceId = "higo-status-" + System.currentTimeMillis();
            engine[0].setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) {
                    if (engine[0] != null) engine[0].shutdown();
                }
                @Override public void onError(String id) {
                    if (engine[0] != null) engine[0].shutdown();
                }
            });
            engine[0].speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        });
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
"""
write("android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java", firebase_service)

native_handler = r"""
const NativeRideDeepLinkHandler = () => {
    const navigate = useNavigate();

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return undefined;

        let listener = null;
        let disposed = false;
        const openRide = (url) => {
            if (!url || !url.startsWith('higo://ride')) return;
            try {
                const parsed = new URL(url);
                const rideId = parsed.searchParams.get('rideId');
                if (rideId) navigate(`/ride/${rideId}`);
            } catch (error) {
                console.warn('[ride-status-push] invalid deep link:', error);
            }
        };

        void (async () => {
            listener = await CapacitorApp.addListener('appUrlOpen', ({ url }) => openRide(url));
            const launch = await CapacitorApp.getLaunchUrl();
            if (launch?.url) openRide(launch.url);
            if (disposed) listener?.remove?.();
        })();

        return () => {
            disposed = true;
            listener?.remove?.();
        };
    }, [navigate]);

    return null;
};

"""
replace_once(
    "src/App.jsx",
    "const App = () => {",
    native_handler + "const App = () => {",
)
replace_once(
    "src/App.jsx",
    """    <HashRouter>
      <OnboardingGate />""",
    """    <HashRouter>
      <NativeRideDeepLinkHandler />
      <OnboardingGate />""",
)

replace_once(
    "android/app/build.gradle",
    """        // Higo 1.5.24: chat discovers the active ride before the panel opens.
        versionCode 56
        versionName \"1.5.24\"""",
    """        // Higo 1.5.25: background passenger voice/status, reliable chat push and SOS GPS follow-up.
        versionCode 57
        versionName \"1.5.25\"""",
)

test_content = r"""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('passenger ride milestones have a server FCM path and native TTS', async () => {
    const [hook, endpoint, service] = await Promise.all([
        read('src/hooks/useDriverActiveTrip.js'),
        read('public/api/send-ride-status-push.php'),
        read('android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java'),
    ]);

    for (const milestone of ['driver_found', 'arrived', 'started', 'completed']) {
        assert.match(hook, new RegExp(`milestone: '${milestone}'`));
        assert.match(endpoint, new RegExp(`'${milestone}'`));
    }
    assert.match(endpoint, /'type' => 'ride_status'/);
    assert.match(endpoint, /'voice_text' => \$message\['voice'\]/);
    assert.match(service, /\"ride_status\"\.equals\(type\)/);
    assert.match(service, /TextToSpeech/);
    assert.match(service, /markRideStatusAsNew/);
    assert.match(service, /higo:\/\/ride\?rideId=/);
});

test('SOS is sent quickly and receives a precise GPS follow-up', async () => {
    const [client, endpoint] = await Promise.all([
        read('src/utils/triggerEmergencyAlert.js'),
        read('public/api/update-emergency-location.php'),
    ]);
    assert.match(client, /GEO_SOFT_TIMEOUT_MS = 700/);
    assert.match(client, /GEO_FOLLOW_UP_TIMEOUT_MS = 12000/);
    assert.match(client, /update-emergency-location\.php/);
    assert.match(endpoint, /location_lat/);
    assert.match(endpoint, /UBICACIÓN SOS ACTUALIZADA/);
});

test('ride message push remains compatible with PHP hosts without str_starts_with or mbstring', async () => {
    const [endpoint, chat] = await Promise.all([
        read('public/api/send-ride-message-push.php'),
        read('src/components/ChatWidget.jsx'),
    ]);
    assert.doesNotMatch(endpoint, /str_starts_with/);
    assert.match(endpoint, /function_exists\('mb_substr'\)/);
    assert.match(chat, /if \(!pushResponse\.ok\)/);
});

test('Android release version is 1.5.25 build 57', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 57/);
    assert.match(gradle, /versionName \"1\.5\.25\"/);
});
"""
write("tests/backgroundPassengerAlertsRegression.test.mjs", test_content)

print("Applied Higo 1.5.25 background alerts and SOS improvements.")
