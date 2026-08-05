<?php
declare(strict_types=1);

/**
 * Push dirigido para una fila nueva de public.ride_offers.
 *
 * Configurar un Database Webhook de Supabase:
 *   table: public.ride_offers
 *   event: INSERT
 *   url:   https://higoapp.com/api/send-ride-offer-push.php
 *   header x-webhook-secret: el mismo RIDE_PUSH_WEBHOOK_SECRET del servidor
 *
 * El endpoint valida nuevamente la oferta, el viaje, el conductor y la
 * bandera de rollout. Nunca decide candidatos: solo entrega la oferta que la
 * base de datos ya asignó.
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg_cors = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg_cors, 'POST, OPTIONS');
api_rate_limit('send-ride-offer-push', 240, '/tmp/higo_ratelimit.log');

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function rop_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function rop_get_json(string $url, array $headers): array {
    [$status, $body] = bl_http_get($url, $headers, 15);
    $decoded = json_decode($body, true);
    return [$status, is_array($decoded) ? $decoded : []];
}

function rop_patch_json(string $url, array $payload, array $headers): void {
    bl_http_patch(
        $url,
        (string) json_encode($payload, JSON_UNESCAPED_SLASHES),
        array_merge($headers, [
            'Content-Type: application/json',
            'Prefer: return=minimal',
        ]),
        10
    );
}

function rop_get_google_access_token(string $saPath): string {
    if (!is_file($saPath)) {
        throw new RuntimeException("SA JSON no existe en $saPath");
    }

    $cachePath = sys_get_temp_dir() . '/higo-fcm-token-' . md5($saPath) . '.json';
    if (is_file($cachePath)) {
        $cached = json_decode((string) @file_get_contents($cachePath), true);
        if (is_array($cached) && ($cached['expires'] ?? 0) > time() + 60) {
            return (string) $cached['token'];
        }
    }

    $sa = json_decode((string) file_get_contents($saPath), true);
    if (!is_array($sa) || empty($sa['client_email']) || empty($sa['private_key'])) {
        throw new RuntimeException('SA JSON invalido');
    }

    $now = time();
    $b64 = static fn(string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $unsigned = $b64((string) json_encode(['alg' => 'RS256', 'typ' => 'JWT']))
        . '.'
        . $b64((string) json_encode([
            'iss' => $sa['client_email'],
            'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
            'aud' => 'https://oauth2.googleapis.com/token',
            'iat' => $now,
            'exp' => $now + 3600,
        ], JSON_UNESCAPED_SLASHES));

    $signature = '';
    if (!openssl_sign($unsigned, $signature, $sa['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('openssl_sign failed');
    }

    [$status, $body] = bl_http_post(
        'https://oauth2.googleapis.com/token',
        http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $unsigned . '.' . $b64($signature),
        ]),
        ['Content-Type: application/x-www-form-urlencoded'],
        15
    );

    if ($status !== 200) {
        throw new RuntimeException("google_oauth_$status");
    }

    $tokenResponse = json_decode($body, true);
    if (!is_array($tokenResponse) || empty($tokenResponse['access_token'])) {
        throw new RuntimeException('bad_token_response');
    }

    @file_put_contents($cachePath, (string) json_encode([
        'token' => $tokenResponse['access_token'],
        'expires' => $now + (int) ($tokenResponse['expires_in'] ?? 3000),
    ]));

    return (string) $tokenResponse['access_token'];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    rop_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    rop_send(503, ['ok' => false, 'error' => 'config_missing', 'detail' => $e->getMessage()]);
}

$required = [
    'SUPABASE_PROJECT_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_SA_PATH',
    'RIDE_PUSH_WEBHOOK_SECRET',
];
foreach ($required as $key) {
    if (empty($cfg[$key])) {
        rop_send(503, ['ok' => false, 'error' => 'config_incomplete', 'detail' => "missing_$key"]);
    }
}

$providedSecret = $_SERVER['HTTP_X_WEBHOOK_SECRET']
    ?? $_SERVER['REDIRECT_HTTP_X_WEBHOOK_SECRET']
    ?? '';
if (!hash_equals((string) $cfg['RIDE_PUSH_WEBHOOK_SECRET'], (string) $providedSecret)) {
    rop_send(401, ['ok' => false, 'error' => 'unauthorized']);
}

$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    rop_send(400, ['ok' => false, 'error' => 'bad_json']);
}

$record = is_array($payload['record'] ?? null) ? $payload['record'] : $payload;
$offerId = isset($record['id']) ? (string) $record['id'] : '';
if ($offerId === '') {
    rop_send(400, ['ok' => false, 'error' => 'bad_record', 'detail' => 'missing_offer_id']);
}

$supaUrl = rtrim((string) $cfg['SUPABASE_PROJECT_URL'], '/');
$supaKey = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
$projectId = (string) $cfg['FIREBASE_PROJECT_ID'];
$saPath = (string) $cfg['FIREBASE_SA_PATH'];
$restHeaders = [
    'apikey: ' . $supaKey,
    'Authorization: Bearer ' . $supaKey,
];

[, $flags] = rop_get_json(
    $supaUrl . '/rest/v1/platform_runtime_flags?singleton=eq.true'
        . '&select=directed_ride_offers,fair_progressive_dispatch&limit=1',
    $restHeaders
);
$flag = $flags[0] ?? null;
if (!is_array($flag)
    || empty($flag['directed_ride_offers'])
    || empty($flag['fair_progressive_dispatch'])) {
    rop_send(200, ['ok' => true, 'sent' => 0, 'note' => 'fair_dispatch_disabled']);
}

[, $offers] = rop_get_json(
    $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId)
        . '&select=id,ride_id,driver_id,status,distance_km,score,wave_number,rank_position,expires_at,notification_status'
        . '&limit=1',
    $restHeaders
);
$offer = $offers[0] ?? null;
if (!is_array($offer)) {
    rop_send(404, ['ok' => false, 'error' => 'offer_not_found']);
}
if (($offer['status'] ?? '') !== 'offered'
    || strtotime((string) ($offer['expires_at'] ?? '')) <= time()) {
    rop_patch_json(
        $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId),
        ['notification_status' => 'skipped'],
        $restHeaders
    );
    rop_send(200, ['ok' => true, 'sent' => 0, 'note' => 'offer_inactive']);
}

$rideId = (string) ($offer['ride_id'] ?? '');
$driverId = (string) ($offer['driver_id'] ?? '');
if ($rideId === '' || $driverId === '') {
    rop_send(400, ['ok' => false, 'error' => 'offer_missing_relations']);
}

[, $rides] = rop_get_json(
    $supaUrl . '/rest/v1/rides?id=eq.' . rawurlencode($rideId)
        . '&status=eq.requested&driver_id=is.null'
        . '&select=id,pickup,dropoff,pickup_lat,pickup_lng,price,service_type,ride_type,status,created_at'
        . '&limit=1',
    $restHeaders
);
$ride = $rides[0] ?? null;
if (!is_array($ride)) {
    rop_patch_json(
        $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId),
        ['notification_status' => 'skipped'],
        $restHeaders
    );
    rop_send(200, ['ok' => true, 'sent' => 0, 'note' => 'ride_inactive']);
}

[, $drivers] = rop_get_json(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($driverId)
        . '&role=eq.driver&status=eq.online'
        . '&select=id,full_name,fcm_token,status&limit=1',
    $restHeaders
);
$driver = $drivers[0] ?? null;
$token = is_array($driver) ? (string) ($driver['fcm_token'] ?? '') : '';
if ($token === '') {
    rop_patch_json(
        $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId),
        ['notification_status' => 'skipped', 'notification_error' => 'missing_fcm_token'],
        $restHeaders
    );
    rop_send(200, ['ok' => true, 'sent' => 0, 'note' => 'driver_without_token']);
}

try {
    $accessToken = rop_get_google_access_token($saPath);
} catch (Throwable $e) {
    rop_patch_json(
        $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId),
        ['notification_status' => 'failed', 'notification_error' => substr($e->getMessage(), 0, 300)],
        $restHeaders
    );
    rop_send(500, ['ok' => false, 'error' => 'oauth_fail', 'detail' => $e->getMessage()]);
}

$isDelivery = strtolower((string) ($ride['service_type'] ?? 'ride')) === 'delivery';
$title = $isDelivery ? 'Nuevo envío para ti' : 'Nueva solicitud para ti';
$bodyParts = [];
if (!empty($ride['pickup'])) {
    $bodyParts[] = 'Recogida: ' . mb_substr((string) $ride['pickup'], 0, 70);
}
if ($ride['price'] !== null) {
    $bodyParts[] = '$' . number_format((float) $ride['price'], 2);
}
if ($offer['distance_km'] !== null) {
    $bodyParts[] = number_format((float) $offer['distance_km'], 1, '.', '') . ' km';
}
$body = $bodyParts !== [] ? implode(' · ', $bodyParts) : 'Tocá para ver los detalles';

$data = [
    'type' => 'ride_request',
    'ride_id' => $rideId,
    'offer_id' => $offerId,
    'wave_number' => (string) ($offer['wave_number'] ?? ''),
    'expires_at' => (string) ($offer['expires_at'] ?? ''),
    'service_type' => (string) ($ride['service_type'] ?? 'ride'),
    'vehicle_type' => (string) ($ride['ride_type'] ?? 'standard'),
    'pickupAddress' => (string) ($ride['pickup'] ?? ''),
    'dropoffAddress' => (string) ($ride['dropoff'] ?? ''),
    'pickup_lat' => (string) ($ride['pickup_lat'] ?? ''),
    'pickup_lng' => (string) ($ride['pickup_lng'] ?? ''),
    'price' => $ride['price'] !== null ? (string) $ride['price'] : '',
    'title' => $title,
    'body' => $body,
    'click_action' => '/#/driver',
];

$fcmPayload = [
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
];

[$fcmStatus, $fcmBody] = bl_http_post(
    "https://fcm.googleapis.com/v1/projects/$projectId/messages:send",
    (string) json_encode($fcmPayload, JSON_UNESCAPED_SLASHES),
    [
        'Authorization: Bearer ' . $accessToken,
        'Content-Type: application/json',
    ],
    15
);

if ($fcmStatus >= 200 && $fcmStatus < 300) {
    rop_patch_json(
        $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId),
        [
            'notification_status' => 'sent',
            'notification_sent_at' => gmdate('c'),
            'notification_error' => null,
        ],
        $restHeaders
    );
    rop_send(200, [
        'ok' => true,
        'sent' => 1,
        'offer_id' => $offerId,
        'ride_id' => $rideId,
        'driver_id' => $driverId,
        'wave_number' => $offer['wave_number'] ?? null,
    ]);
}

$errorText = substr((string) $fcmBody, 0, 300);
rop_patch_json(
    $supaUrl . '/rest/v1/ride_offers?id=eq.' . rawurlencode($offerId),
    ['notification_status' => 'failed', 'notification_error' => $errorText],
    $restHeaders
);

if ($fcmStatus === 404
    || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
    rop_patch_json(
        $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($driverId),
        ['fcm_token' => null],
        $restHeaders
    );
}

rop_send(502, [
    'ok' => false,
    'error' => 'fcm_failed',
    'fcm_status' => $fcmStatus,
    'detail' => $errorText,
]);
