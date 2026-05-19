<?php
declare(strict_types=1);

/**
 * send-delivery-milestone.php — Push FCM al remitente de un envío
 * cuando el chofer cambia el status del ride.
 *
 * Lo invoca el cliente del CHOFER (DriverDashboard) en fire-and-forget
 * tras hacer el UPDATE de status. La razón de hacerlo desde el cliente
 * en vez de un trigger DB → webhook: Hostinger free no expone pg_net,
 * y un cron polling cada 30s tiene latencia. El driver app ya hizo el
 * commit antes de llamar esto, así que el push es consistente.
 *
 * Auth: Bearer JWT del CHOFER. Validamos que sea el driver_id del ride.
 * Body JSON: { ride_id: int, status: string }
 *   status ∈ {accepted, in_progress, arrived_at_dropoff, completed}
 *
 * No mandamos push para 'requested' (el remitente lo creó) ni 'cancelled'
 * (se maneja por otro canal).
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg_cors = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg_cors, 'POST, OPTIONS');
// 60 req/min/IP: un chofer activo puede emitir hasta 4 hitos por envío
// (accepted, in_progress, arrived, completed). 60/min cubre operación
// agresiva (15 envíos/min = imposible en práctica).
api_rate_limit('send-delivery-milestone', 60, '/tmp/higo_ratelimit.log');

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function dm_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    dm_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ═══ Auth ═══════════════════════════════════════════════════════════════
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!str_starts_with($auth, 'Bearer ') || substr_count($auth, '.') < 2) {
    dm_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = substr($auth, 7);

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    dm_send(503, ['ok' => false, 'error' => 'config_missing']);
}

foreach (['SUPABASE_PROJECT_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','FIREBASE_PROJECT_ID','FIREBASE_SA_PATH'] as $k) {
    if (empty($cfg[$k])) dm_send(503, ['ok' => false, 'error' => "config_incomplete_$k"]);
}
$supaUrl   = rtrim((string) $cfg['SUPABASE_PROJECT_URL'], '/');
$supaSrv   = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
$supaAnon  = (string) $cfg['SUPABASE_ANON_KEY'];
$projectId = (string) $cfg['FIREBASE_PROJECT_ID'];
$saPath    = (string) $cfg['FIREBASE_SA_PATH'];

// Validar JWT del chofer
[$uStatus, $uBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaAnon, 'Authorization: Bearer ' . $callerJwt]
);
if ($uStatus !== 200) dm_send(401, ['ok' => false, 'error' => 'bad_token']);
$caller = json_decode((string) $uBody, true);
$callerId = (string) ($caller['id'] ?? '');
if ($callerId === '') dm_send(401, ['ok' => false, 'error' => 'no_user_id']);

// ═══ Body ═══════════════════════════════════════════════════════════════
$raw  = (string) file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) dm_send(400, ['ok' => false, 'error' => 'bad_json']);

$rideId = (int) ($data['ride_id'] ?? 0);
$status = (string) ($data['status'] ?? '');
if ($rideId <= 0) dm_send(400, ['ok' => false, 'error' => 'bad_ride_id']);

$allowed = ['accepted', 'in_progress', 'arrived_at_dropoff', 'completed'];
if (!in_array($status, $allowed, true)) {
    dm_send(400, ['ok' => false, 'error' => 'unsupported_status']);
}

// ═══ Cargar ride (service-role) y validar dueño ═════════════════════════
[$rStatus, $rBody] = bl_http_get(
    $supaUrl . '/rest/v1/rides?id=eq.' . $rideId
        . '&select=id,user_id,driver_id,service_type,pickup,dropoff,delivery_info',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
if ($rStatus !== 200) dm_send(500, ['ok' => false, 'error' => 'ride_fetch_failed']);
$rows = json_decode((string) $rBody, true);
$ride = is_array($rows) ? ($rows[0] ?? null) : null;
if (!$ride) dm_send(404, ['ok' => false, 'error' => 'ride_not_found']);

if (($ride['service_type'] ?? '') !== 'delivery') {
    dm_send(409, ['ok' => false, 'error' => 'not_a_delivery']);
}
if ((string) ($ride['driver_id'] ?? '') !== $callerId) {
    dm_send(403, ['ok' => false, 'error' => 'not_assigned_driver']);
}

$recipientId = (string) ($ride['user_id'] ?? '');
if ($recipientId === '') dm_send(404, ['ok' => false, 'error' => 'no_recipient']);

// Profile del remitente (fcm_token + display name)
[$pStatus, $pBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($recipientId) . '&select=fcm_token,full_name',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$recipientProfile = ($pStatus === 200) ? (json_decode((string) $pBody, true)[0] ?? null) : null;
$fcmToken = (string) ($recipientProfile['fcm_token'] ?? '');
if ($fcmToken === '') {
    dm_send(200, ['ok' => true, 'sent' => 0, 'note' => 'recipient_no_fcm_token']);
}

// Profile del chofer para personalizar el mensaje
[$dStatus, $dBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($callerId) . '&select=full_name,license_plate',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$driverProfile = ($dStatus === 200) ? (json_decode((string) $dBody, true)[0] ?? null) : null;
$driverFirstName = '';
if ($driverProfile && !empty($driverProfile['full_name'])) {
    $parts = preg_split('/\s+/', (string) $driverProfile['full_name']);
    $driverFirstName = $parts[0] ?? '';
}

// ═══ Render del mensaje según hito ══════════════════════════════════════
$pkgDesc = '';
if (!empty($ride['delivery_info']['package_description'])) {
    $pkgDesc = (string) $ride['delivery_info']['package_description'];
    if (mb_strlen($pkgDesc) > 50) $pkgDesc = mb_substr($pkgDesc, 0, 47) . '…';
}

$titles = [
    'accepted'           => 'Tu envío fue aceptado',
    'in_progress'        => 'Paquete recogido',
    'arrived_at_dropoff' => 'El chofer llegó al destino',
    'completed'          => 'Tu paquete fue entregado',
];
$bodies = [
    'accepted'           => $driverFirstName !== ''
                                ? "$driverFirstName va en camino a retirar tu paquete."
                                : 'Un chofer está en camino a retirar tu paquete.',
    'in_progress'        => $driverFirstName !== ''
                                ? "$driverFirstName recogió tu paquete y va al destino."
                                : 'El chofer recogió tu paquete y va al destino.',
    'arrived_at_dropoff' => 'El chofer está entregando tu paquete ahora.',
    'completed'          => $pkgDesc !== ''
                                ? "Entrega de \"$pkgDesc\" confirmada. Ver foto POD →"
                                : 'Entrega confirmada. Ver foto POD →',
];

$title = $titles[$status];
$body  = $bodies[$status];
$clickAction = '/#/ride/' . $rideId;

// ═══ OAuth2 SA → Bearer FCM ════════════════════════════════════════════
function dm_get_google_access_token(string $saPath): string {
    if (!is_file($saPath)) throw new RuntimeException('sa_not_found');
    $cachePath = sys_get_temp_dir() . '/higo-fcm-token-' . md5($saPath) . '.json';
    if (is_file($cachePath)) {
        $cached = json_decode((string) @file_get_contents($cachePath), true);
        if (is_array($cached) && ($cached['expires'] ?? 0) > time() + 60) {
            return (string) $cached['token'];
        }
    }
    $sa = json_decode((string) file_get_contents($saPath), true);
    if (!is_array($sa) || empty($sa['client_email']) || empty($sa['private_key'])) {
        throw new RuntimeException('sa_invalid');
    }
    $now = time();
    $header = ['alg' => 'RS256', 'typ' => 'JWT'];
    $claim  = [
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ];
    $b64 = static fn(string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $unsigned = $b64((string) json_encode($header, JSON_UNESCAPED_SLASHES))
              . '.' . $b64((string) json_encode($claim,  JSON_UNESCAPED_SLASHES));
    $sig = '';
    if (!openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('openssl_sign_failed');
    }
    $jwt = $unsigned . '.' . $b64($sig);
    [$status, $body] = bl_http_post(
        'https://oauth2.googleapis.com/token',
        http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        ['Content-Type: application/x-www-form-urlencoded'],
        15
    );
    if ($status !== 200) throw new RuntimeException("google_oauth_$status");
    $tokenResp = json_decode($body, true);
    if (!is_array($tokenResp) || empty($tokenResp['access_token'])) {
        throw new RuntimeException('bad_token_response');
    }
    @file_put_contents($cachePath, (string) json_encode([
        'token'   => $tokenResp['access_token'],
        'expires' => $now + (int) ($tokenResp['expires_in'] ?? 3000),
    ]));
    return (string) $tokenResp['access_token'];
}

try {
    $accessToken = dm_get_google_access_token($saPath);
} catch (Throwable $e) {
    dm_send(500, ['ok' => false, 'error' => 'oauth_fail', 'detail' => $e->getMessage()]);
}

// ═══ Push FCM ══════════════════════════════════════════════════════════
$fcmPayload = [
    'message' => [
        'token'        => $fcmToken,
        'notification' => ['title' => $title, 'body' => $body],
        'data'         => [
            'type'         => 'delivery_milestone',
            'ride_id'      => (string) $rideId,
            'status'       => $status,
            'click_action' => $clickAction,
        ],
        'webpush' => [
            'fcm_options'  => ['link' => $clickAction],
            'notification' => [
                'icon'    => '/higo-icon.svg',
                'vibrate' => [200, 100, 200],
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
    dm_send(200, ['ok' => true, 'sent' => 1]);
}

// Token muerto → limpiar
if ($fcmStatus === 404 || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
    bl_http_post(
        $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($recipientId),
        (string) json_encode(['fcm_token' => null]),
        [
            'apikey: ' . $supaSrv,
            'Authorization: Bearer ' . $supaSrv,
            'Content-Type: application/json',
            'Prefer: return=minimal',
        ]
    );
    dm_send(200, ['ok' => true, 'sent' => 0, 'note' => 'token_unregistered_cleaned']);
}

dm_send(502, ['ok' => false, 'error' => 'fcm_failed', 'status' => $fcmStatus, 'detail' => substr((string) $fcmBody, 0, 200)]);
