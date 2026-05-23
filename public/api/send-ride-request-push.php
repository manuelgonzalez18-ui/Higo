<?php
declare(strict_types=1);

/**
 * api/send-ride-request-push.php — Push FCM a drivers online cuando
 * se crea una nueva ride (Parte C del plan de push notifications).
 *
 * Lo invoca un Supabase Database Webhook cuando se INSERTa en la
 * tabla public.rides. El webhook manda un POST con payload:
 *   {
 *     type: 'INSERT',
 *     table: 'rides',
 *     schema: 'public',
 *     record: { id, pickup_lat, pickup_lng, vehicle_type, service_type, ... },
 *     old_record: null
 *   }
 *
 * Flow:
 *   1. Valida shared secret (header x-webhook-secret).
 *   2. Parse del record. Si status != 'requested' o sin coords → no-op.
 *   3. SELECT profiles WHERE role='driver' AND status='online' AND
 *      updated_at > now()-90s AND fcm_token IS NOT NULL AND
 *      vehicle_type compatible con la ride.
 *   4. Filtra por distancia (Haversine en PHP) — radio default 10km.
 *   5. FCM HTTP v1 push a cada token. Notification + data payload con
 *      ride_id, pickup_address, service_type — App.jsx ya tiene el
 *      handler que mapea data.type='ride_request' al IncomingRequestCard.
 *   6. Limpia fcm_token de drivers con token muerto (404/UNREGISTERED).
 *
 * Config requerido en /home/<user>/private/higo-banesco.php:
 *   - SUPABASE_PROJECT_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - FIREBASE_PROJECT_ID
 *   - FIREBASE_SA_PATH                (JSON del Service Account)
 *   - RIDE_PUSH_WEBHOOK_SECRET        (string random; mismo valor en
 *                                      Supabase Webhook → Headers)
 *
 * Salida: { ok, sent, skipped, total, errors[] } o { ok:false, error }.
 *
 * Radio: 10km default. Override por header x-radius-km si hace falta
 *        para testing manual con curl.
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg_cors = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg_cors, 'POST, OPTIONS');
// Rate limit suave: 60 disparos/min. Supabase webhook deberia disparar
// 1 vez por ride; mas que eso = bug o ataque, conviene cortar.
api_rate_limit('send-ride-request-push', 60, '/tmp/higo_ratelimit.log');

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function srp_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    srp_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ═══ Config ═════════════════════════════════════════════════════════════
try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    srp_send(503, ['ok' => false, 'error' => 'config_missing', 'detail' => $e->getMessage()]);
}

$required = [
    'SUPABASE_PROJECT_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'FIREBASE_PROJECT_ID', 'FIREBASE_SA_PATH',
    'RIDE_PUSH_WEBHOOK_SECRET',
];
foreach ($required as $k) {
    if (empty($cfg[$k])) {
        srp_send(503, ['ok' => false, 'error' => 'config_incomplete', 'detail' => "missing_$k"]);
    }
}
$supaUrl   = rtrim((string) $cfg['SUPABASE_PROJECT_URL'], '/');
$supaKey   = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
$projectId = (string) $cfg['FIREBASE_PROJECT_ID'];
$saPath    = (string) $cfg['FIREBASE_SA_PATH'];
$secret    = (string) $cfg['RIDE_PUSH_WEBHOOK_SECRET'];

// ═══ Auth: shared secret ════════════════════════════════════════════════
$providedSecret = $_SERVER['HTTP_X_WEBHOOK_SECRET']
               ?? $_SERVER['REDIRECT_HTTP_X_WEBHOOK_SECRET']
               ?? '';
if (!hash_equals($secret, (string) $providedSecret)) {
    srp_send(401, ['ok' => false, 'error' => 'unauthorized']);
}

// ═══ Body ═══════════════════════════════════════════════════════════════
$raw  = (string) file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    srp_send(400, ['ok' => false, 'error' => 'bad_json']);
}

// Supabase webhook envelope vs payload directo: aceptamos ambos.
$record = is_array($data['record'] ?? null) ? $data['record'] : $data;

$rideId      = isset($record['id']) ? (string) $record['id'] : '';
$pickupLat   = isset($record['pickup_lat']) ? (float) $record['pickup_lat'] : null;
$pickupLng   = isset($record['pickup_lng']) ? (float) $record['pickup_lng'] : null;
$status      = (string) ($record['status'] ?? '');
$vehicleType = strtolower((string) ($record['vehicle_type'] ?? 'standard'));
$serviceType = strtolower((string) ($record['service_type'] ?? 'passenger'));
$pickupAddr  = (string) ($record['pickup_address'] ?? '');
$dropoffAddr = (string) ($record['dropoff_address'] ?? '');
$priceUsd    = $record['price_usd'] ?? $record['fare_usd'] ?? null;

if ($rideId === '' || $pickupLat === null || $pickupLng === null) {
    srp_send(400, ['ok' => false, 'error' => 'bad_record', 'detail' => 'missing id/pickup_lat/pickup_lng']);
}
if ($status !== '' && $status !== 'requested') {
    // No-op: la ride ya cambio de estado entre INSERT y webhook (raro).
    srp_send(200, ['ok' => true, 'sent' => 0, 'skipped' => 0, 'total' => 0, 'note' => "skipped_status_$status"]);
}

// Camioneta → van (normalizacion que ya hace el cliente).
if ($vehicleType === 'camioneta') $vehicleType = 'van';

// Radio en km. Override via header para testing.
$radiusKm = isset($_SERVER['HTTP_X_RADIUS_KM']) ? (float) $_SERVER['HTTP_X_RADIUS_KM'] : 10.0;
if ($radiusKm <= 0 || $radiusKm > 100) $radiusKm = 10.0;

// ═══ Drivers candidatos ═════════════════════════════════════════════════
// Filtros del lado DB:
//   - role=driver, status=online, fcm_token presente
//   - heartbeat reciente (updated_at >= now-90s) para descartar offline
//     mal cerrados
//   - vehicle_type compatible: si la ride pide 'moto', solo motos; si
//     pide 'van', solo vans; 'standard' acepta motos/standard/van porque
//     standard es el catch-all (todos los choferes pueden hacer un
//     standard salvo que la regla de negocio diga otra cosa).
$cutoffIso = gmdate('Y-m-d\TH:i:s\Z', time() - 90);

$vehicleFilter = '';
if ($vehicleType === 'moto') {
    $vehicleFilter = '&vehicle_type=eq.moto';
} elseif ($vehicleType === 'van') {
    $vehicleFilter = '&vehicle_type=eq.van';
}
// standard → sin filtro (todos los vehicle_types aplican).

$selectCols = 'id,full_name,vehicle_type,curr_lat,curr_lng,fcm_token,updated_at';
[$dStatus, $dBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?role=eq.driver'
        . '&status=eq.online'
        . '&fcm_token=not.is.null'
        . '&updated_at=gte.' . rawurlencode($cutoffIso)
        . $vehicleFilter
        . '&select=' . rawurlencode($selectCols),
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey]
);
$drivers = is_array(json_decode($dBody, true)) ? json_decode($dBody, true) : [];

if (empty($drivers)) {
    srp_send(200, ['ok' => true, 'sent' => 0, 'skipped' => 0, 'total' => 0, 'note' => 'no_online_drivers']);
}

// ═══ Filtro por distancia (Haversine en PHP) ════════════════════════════
$nearby = [];
foreach ($drivers as $d) {
    $lat = isset($d['curr_lat']) ? (float) $d['curr_lat'] : null;
    $lng = isset($d['curr_lng']) ? (float) $d['curr_lng'] : null;
    if ($lat === null || $lng === null) continue;

    $dKm = srp_haversine_km($pickupLat, $pickupLng, $lat, $lng);
    if ($dKm <= $radiusKm) {
        $d['distance_km'] = $dKm;
        $nearby[] = $d;
    }
}

if (empty($nearby)) {
    srp_send(200, ['ok' => true, 'sent' => 0, 'skipped' => 0, 'total' => count($drivers), 'note' => 'no_drivers_in_radius']);
}

// ═══ OAuth2 SA → FCM access token ═══════════════════════════════════════
// Duplicamos la funcion de send-support-push.php (con prefijo distinto)
// para mantener los dos endpoints independientes. Misma logica de cache
// en /tmp para reusar el access_token 1h.
function srp_get_google_access_token(string $saPath): string {
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
        throw new RuntimeException('openssl_sign failed');
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
    if ($status !== 200) {
        throw new RuntimeException("google_oauth_$status");
    }
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
    $accessToken = srp_get_google_access_token($saPath);
} catch (Throwable $e) {
    srp_send(500, ['ok' => false, 'error' => 'oauth_fail', 'detail' => $e->getMessage()]);
}

// ═══ Armado del push ════════════════════════════════════════════════════
$isDelivery = ($serviceType === 'delivery');
$title = $isDelivery ? 'Nuevo envío cerca' : 'Nueva solicitud de viaje';

// Body: address si la tenemos, sino distancia/precio.
$bodyParts = [];
if ($pickupAddr !== '') {
    $bodyParts[] = 'Recogida: ' . mb_substr($pickupAddr, 0, 80);
}
if ($priceUsd !== null) {
    $bodyParts[] = '$' . number_format((float) $priceUsd, 2);
}
$body = $bodyParts !== [] ? implode(' · ', $bodyParts) : 'Tocá para ver detalles';

$clickAction = '/#/driver';

// data: lo que App.jsx mapea a IncomingRequestCard via data.type='ride_request'.
// Mantenemos camelCase consistente con lo que ya espera el handler en App.jsx
// (pickupAddress, dropoffAddress, etc).
$dataPayload = [
    'type'           => 'ride_request',
    'ride_id'        => (string) $rideId,
    'service_type'   => $serviceType,
    'vehicle_type'   => $vehicleType,
    'pickupAddress'  => $pickupAddr,
    'dropoffAddress' => $dropoffAddr,
    'pickup_lat'     => (string) $pickupLat,
    'pickup_lng'     => (string) $pickupLng,
    'price'          => $priceUsd !== null ? (string) $priceUsd : '',
    'click_action'   => $clickAction,
];

// ═══ Enviar pushes ══════════════════════════════════════════════════════
$sent = 0;
$skipped = 0;
$errors = [];

foreach ($nearby as $driver) {
    $token = (string) ($driver['fcm_token'] ?? '');
    if ($token === '') { $skipped++; continue; }

    // Personalizamos el body con la distancia exacta para cada driver.
    $bodyForDriver = $body !== ''
        ? $body . ' · a ' . number_format($driver['distance_km'], 1, '.', '') . ' km'
        : 'A ' . number_format($driver['distance_km'], 1, '.', '') . ' km';

    $fcmPayload = [
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
        $sent++;
        continue;
    }

    // Token muerto → limpiar para que el proximo registro lo reemplace.
    if ($fcmStatus === 404 || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
        bl_http_post(
            $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode((string) $driver['id']),
            (string) json_encode(['fcm_token' => null]),
            [
                'apikey: ' . $supaKey,
                'Authorization: Bearer ' . $supaKey,
                'Content-Type: application/json',
                'Prefer: return=minimal',
            ],
            10
        );
    }

    $errors[] = [
        'driver_id'  => (string) ($driver['id'] ?? ''),
        'fcm_status' => $fcmStatus,
        'message'    => substr((string) $fcmBody, 0, 200),
    ];
}

srp_send(200, [
    'ok'       => true,
    'ride_id'  => (string) $rideId,
    'sent'     => $sent,
    'skipped'  => $skipped,
    'total'    => count($drivers),
    'in_radius'=> count($nearby),
    'errors'   => $errors,
]);

// ─── helpers ──────────────────────────────────────────────────────────
function srp_haversine_km(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $R = 6371.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2
       + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return 2 * $R * asin(min(1.0, sqrt($a)));
}
