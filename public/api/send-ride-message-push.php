<?php
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
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
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
if ($authorization === '' || strpos($authorization, 'Bearer ') !== 0 || substr_count($authorization, '.') < 2) {
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
$preview = function_exists('mb_substr') ? mb_substr($preview, 0, 140) : substr($preview, 0, 140);
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
