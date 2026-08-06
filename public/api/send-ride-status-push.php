<?php
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
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
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
