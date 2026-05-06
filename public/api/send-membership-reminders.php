<?php
declare(strict_types=1);

/**
 * api/send-membership-reminders.php — Cron de avisos de vencimiento.
 *
 * Lo invoca un cron de Hostinger cada hora. Hace tres cosas:
 *   1) Lee membresías activas cuyo expires_at cae en una banda de
 *      umbral (7, 3, 1 o 0 días) y aún no recibieron ese recordatorio.
 *   2) Manda FCM v1 al driver si tiene fcm_token guardado.
 *   3) Inserta una fila en membership_reminders. El índice único
 *      (membership_id, days_threshold) impide doble envío incluso si
 *      el cron corre varias veces al día.
 *
 * Auth: header `X-Cron-Secret: <CRON_SECRET>` del config privado.
 *       Si falta o no coincide → 401.
 *
 * Config requerido en /home/<user>/private/higo-banesco.php:
 *   - CRON_SECRET            (string aleatorio largo)
 *   - FIREBASE_PROJECT_ID    (ej. 'higo-app-26a19')
 *   - FIREBASE_SA_PATH       (path absoluto al Service Account JSON)
 *   - SUPABASE_PROJECT_URL   (ya usado por banesco-validate.php)
 *   - SUPABASE_SERVICE_ROLE_KEY  (¡service_role, no anon!)
 *
 * Salida JSON: { ok, processed, sent, skipped, errors[] }
 */

require_once __DIR__ . '/../banesco-core.php';

// ═══ HTTP helpers ═════════════════════════════════════════════════════

function smr_send_json(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function smr_log(string $logPath, string $msg): void {
    if ($logPath === '') return;
    @file_put_contents($logPath, '[' . gmdate('Y-m-d H:i:s') . '] ' . $msg . "\n", FILE_APPEND);
}

// ═══ Config ═══════════════════════════════════════════════════════════

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    smr_send_json(503, ['ok' => false, 'error' => 'CONFIG_MISSING', 'message' => $e->getMessage()]);
}

$cronSecret = (string) ($cfg['CRON_SECRET'] ?? '');
$projectId  = (string) ($cfg['FIREBASE_PROJECT_ID'] ?? '');
$saPath     = (string) ($cfg['FIREBASE_SA_PATH'] ?? '');
$supaUrl    = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaKey    = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
$logPath    = (string) ($cfg['CRON_LOG_PATH'] ?? '');

foreach (['CRON_SECRET','FIREBASE_PROJECT_ID','FIREBASE_SA_PATH','SUPABASE_PROJECT_URL','SUPABASE_SERVICE_ROLE_KEY'] as $k) {
    if (empty($cfg[$k])) {
        smr_send_json(503, ['ok' => false, 'error' => 'CONFIG_INCOMPLETE', 'message' => "Falta $k en config privado."]);
    }
}

// ═══ Auth ═════════════════════════════════════════════════════════════

$incoming = (string) ($_SERVER['HTTP_X_CRON_SECRET']
            ?? $_SERVER['REDIRECT_HTTP_X_CRON_SECRET']
            ?? '');
if (!hash_equals($cronSecret, $incoming)) {
    smr_send_json(401, ['ok' => false, 'error' => 'UNAUTHORIZED']);
}

// Sólo POST/GET con secret. POST es lo que vamos a usar desde curl.
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($method, ['GET', 'POST'], true)) {
    smr_send_json(405, ['ok' => false, 'error' => 'METHOD_NOT_ALLOWED']);
}

// ═══ Service Account → OAuth2 Bearer (FCM HTTP v1) ═════════════════════

/**
 * Firma JWT RS256 con la private key del Service Account y lo intercambia
 * por un Bearer access_token vía https://oauth2.googleapis.com/token.
 * Cachea el token en /tmp por 50 min para no firmar JWT en cada request.
 */
function smr_get_google_access_token(string $saPath, string $logPath): string {
    if (!is_file($saPath)) {
        throw new RuntimeException("Service account JSON no existe en $saPath");
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
        throw new RuntimeException('Service account JSON inválido (faltan client_email/private_key).');
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
              . '.'
              . $b64((string) json_encode($claim,  JSON_UNESCAPED_SLASHES));

    $sig = '';
    $ok = openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    if (!$ok) {
        throw new RuntimeException('openssl_sign falló: ' . openssl_error_string());
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
        throw new RuntimeException("Google token endpoint $status: $body");
    }
    $tokenResp = json_decode($body, true);
    if (!is_array($tokenResp) || empty($tokenResp['access_token'])) {
        throw new RuntimeException('Token Google inválido: ' . substr($body, 0, 200));
    }

    @file_put_contents($cachePath, (string) json_encode([
        'token'   => $tokenResp['access_token'],
        'expires' => $now + (int) ($tokenResp['expires_in'] ?? 3000),
    ]));
    smr_log($logPath, 'OAuth2 token refreshed');
    return (string) $tokenResp['access_token'];
}

// ═══ Supabase REST helpers ═════════════════════════════════════════════

function smr_supa_get(string $url, string $key): array {
    [$status, $body] = bl_http_get(
        $url,
        [
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
            'Accept: application/json',
        ],
        20
    );
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("Supabase GET $status: " . substr($body, 0, 300));
    }
    $data = json_decode($body, true);
    return is_array($data) ? $data : [];
}

function smr_supa_post(string $url, string $key, array $payload, array $extraHeaders = []): array {
    [$status, $body] = bl_http_post(
        $url,
        (string) json_encode($payload, JSON_UNESCAPED_SLASHES),
        array_merge([
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
            'Content-Type: application/json',
            'Prefer: return=representation',
        ], $extraHeaders),
        20
    );
    if ($status < 200 || $status >= 300) {
        return ['__error' => true, '__status' => $status, '__body' => $body];
    }
    $data = json_decode($body, true);
    return is_array($data) ? $data : [];
}

// ═══ Lógica del cron ═══════════════════════════════════════════════════

// Bandas: para cada threshold N días, considerar memberships cuyo
// expires_at cae en (now + N días, now + (N+1) días). Si el cron corre
// cada hora, todas las memberships dentro de esa franja terminan
// matcheando en algún momento del día y obtienen el aviso.
$thresholds = [7, 3, 1, 0];
$processed = 0;
$sent = 0;
$skipped = 0;
$errors = [];

try {
    $accessToken = smr_get_google_access_token($saPath, $logPath);
} catch (Throwable $e) {
    smr_log($logPath, 'OAUTH_FAIL: ' . $e->getMessage());
    smr_send_json(500, ['ok' => false, 'error' => 'OAUTH_FAIL', 'message' => $e->getMessage()]);
}

foreach ($thresholds as $N) {
    $lo = gmdate('c', time() + $N * 86400);
    $hi = gmdate('c', time() + ($N + 1) * 86400);

    // Pedimos las memberships activas que vencen en esa banda y traemos
    // joinea profile (full_name, fcm_token) para construir el push.
    $endpoint = $supaUrl . '/rest/v1/driver_memberships'
        . '?select=' . rawurlencode('id,driver_id,plan,expires_at,profiles!inner(full_name,fcm_token)')
        . '&status=eq.active'
        . '&expires_at=gte.' . rawurlencode($lo)
        . '&expires_at=lt.'  . rawurlencode($hi);

    try {
        $rows = smr_supa_get($endpoint, $supaKey);
    } catch (Throwable $e) {
        $errors[] = ['threshold' => $N, 'stage' => 'fetch', 'message' => $e->getMessage()];
        continue;
    }

    foreach ($rows as $row) {
        $processed++;
        $membershipId = (int) ($row['id'] ?? 0);
        $driverId     = (string) ($row['driver_id'] ?? '');
        $expiresAt    = (string) ($row['expires_at'] ?? '');
        $profile      = is_array($row['profiles'] ?? null) ? $row['profiles'] : [];
        $token        = (string) ($profile['fcm_token'] ?? '');
        $name         = trim((string) ($profile['full_name'] ?? '')) ?: 'Conductor';

        if ($token === '') {
            $skipped++;
            // Insertamos igual el reminder con error_message para no
            // reintentar 24 veces al día. Si después actualiza el token
            // queda sin aviso de ese threshold, lo cual es aceptable.
            smr_supa_post(
                $supaUrl . '/rest/v1/membership_reminders',
                $supaKey,
                [[
                    'driver_id'      => $driverId,
                    'membership_id'  => $membershipId,
                    'days_threshold' => $N,
                    'fcm_status'     => 'no_token',
                    'error_message'  => 'Driver sin fcm_token',
                ]],
                ['Prefer: resolution=ignore-duplicates,return=minimal']
            );
            continue;
        }

        $title = $N === 0
            ? 'Tu membresía Higo vence hoy'
            : ($N === 1
                ? 'Tu membresía vence mañana'
                : "Tu membresía vence en $N días");
        $body = $N === 0
            ? "Renová ahora desde Higo Pay para no perder viajes."
            : "Hola $name, renová desde Higo Pay para seguir activo.";

        $fcmPayload = [
            'message' => [
                'token'        => $token,
                'notification' => ['title' => $title, 'body' => $body],
                'data'         => [
                    'type'           => 'membership_reminder',
                    'days_threshold' => (string) $N,
                    'membership_id'  => (string) $membershipId,
                    'click_action'   => '/#/higo-pay',
                ],
                'webpush' => [
                    'fcm_options' => ['link' => '/#/higo-pay'],
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

        $statusLabel = ($fcmStatus >= 200 && $fcmStatus < 300) ? 'sent' : 'failed';
        $errMsg = $statusLabel === 'failed' ? substr((string) $fcmBody, 0, 500) : null;

        // Si el token ya no es válido (404/UNREGISTERED), lo borramos del
        // profile para que el próximo registro lo reemplace.
        if ($fcmStatus === 404 || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
            smr_supa_post(
                $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($driverId),
                $supaKey,
                ['fcm_token' => null],
                ['Prefer: return=minimal']
            );
        }

        $insertResult = smr_supa_post(
            $supaUrl . '/rest/v1/membership_reminders',
            $supaKey,
            [[
                'driver_id'      => $driverId,
                'membership_id'  => $membershipId,
                'days_threshold' => $N,
                'fcm_status'     => $statusLabel,
                'error_message'  => $errMsg,
            ]],
            ['Prefer: resolution=ignore-duplicates,return=minimal']
        );

        if (isset($insertResult['__error']) && $insertResult['__error']) {
            // Choque con índice único = recordatorio ya existía.
            // Es benigno con resolution=ignore-duplicates pero por si acaso:
            $skipped++;
            continue;
        }

        if ($statusLabel === 'sent') {
            $sent++;
        } else {
            $errors[] = [
                'threshold'     => $N,
                'driver_id'     => $driverId,
                'membership_id' => $membershipId,
                'fcm_status'    => $fcmStatus,
                'message'       => $errMsg,
            ];
        }

        smr_log($logPath, "ts=$expiresAt threshold=$N driver=$driverId status=$fcmStatus label=$statusLabel");
    }
}

smr_send_json(200, [
    'ok'        => true,
    'processed' => $processed,
    'sent'      => $sent,
    'skipped'   => $skipped,
    'errors'    => $errors,
]);
