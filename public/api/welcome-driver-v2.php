<?php
declare(strict_types=1);

/**
 * Creates a Higo Driver account from the administrative panel.
 *
 * Security invariants:
 * - caller must have a valid Supabase JWT;
 * - admin_get_context() must authorize manage_drivers;
 * - MFA is enforced when the administrative policy requires it;
 * - the new driver starts suspended until a real membership is recorded;
 * - the service-role key never reaches the browser;
 * - the action is written to admin_audit_log.
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

function wd2_send(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    wd2_send(503, ['ok' => false, 'error' => 'config_missing']);
}

api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('welcome-driver-v2', 5, '/tmp/higo_ratelimit.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    wd2_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$supaUrl = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$anonKey = (string) ($cfg['SUPABASE_ANON_KEY'] ?? '');
$serviceKey = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
if ($supaUrl === '' || $anonKey === '' || $serviceKey === '') {
    wd2_send(503, ['ok' => false, 'error' => 'config_incomplete']);
}

$authHeader = (string) ($_SERVER['HTTP_AUTHORIZATION']
    ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
    ?? '');
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
    wd2_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = trim($matches[1]);

// Resolve and validate the caller through Supabase Auth.
[$userStatus, $userBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    [
        'apikey: ' . $anonKey,
        'Authorization: Bearer ' . $callerJwt,
        'Accept: application/json',
    ]
);
$caller = json_decode($userBody, true);
$callerId = is_array($caller) ? (string) ($caller['id'] ?? '') : '';
if ($userStatus !== 200 || $callerId === '') {
    wd2_send(401, ['ok' => false, 'error' => 'invalid_token']);
}

// Authorize with the same role/permission/MFA context used by the new panel.
[$contextStatus, $contextBody] = bl_http_post(
    $supaUrl . '/rest/v1/rpc/admin_get_context',
    '{}',
    [
        'apikey: ' . $anonKey,
        'Authorization: Bearer ' . $callerJwt,
        'Content-Type: application/json',
        'Accept: application/json',
    ]
);
$context = json_decode($contextBody, true);
if ($contextStatus < 200 || $contextStatus >= 300 || !is_array($context)) {
    wd2_send(403, ['ok' => false, 'error' => 'admin_context_unavailable']);
}
if (!($context['authorized'] ?? false)
    || !(($context['permissions']['manage_drivers'] ?? false))) {
    wd2_send(403, ['ok' => false, 'error' => 'admin_permission_denied']);
}
if (($context['require_mfa'] ?? false) && (($context['aal'] ?? 'aal1') !== 'aal2')) {
    wd2_send(403, ['ok' => false, 'error' => 'admin_mfa_required']);
}

$contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
$isMultipart = stripos($contentType, 'multipart/form-data') !== false;
if ($isMultipart) {
    $input = $_POST;
} else {
    $raw = file_get_contents('php://input') ?: '';
    $input = json_decode($raw, true);
    if (!is_array($input)) {
        wd2_send(400, ['ok' => false, 'error' => 'bad_request']);
    }
}

$fullName = trim((string) ($input['full_name'] ?? ''));
$email = strtolower(trim((string) ($input['email'] ?? '')));
$password = (string) ($input['password'] ?? '');
$phone = trim((string) ($input['phone'] ?? ''));
$vehicleType = trim((string) ($input['vehicle_type'] ?? 'standard'));
$vehicleBrand = trim((string) ($input['vehicle_brand'] ?? ''));
$vehicleModel = trim((string) ($input['vehicle_model'] ?? ''));
$vehicleColor = trim((string) ($input['vehicle_color'] ?? ''));
$licensePlate = strtoupper(trim((string) ($input['license_plate'] ?? '')));
$paymentQrUrl = trim((string) ($input['payment_qr_url'] ?? ''));

if ($fullName === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    wd2_send(422, ['ok' => false, 'error' => 'invalid_name_or_email']);
}
if (!in_array($vehicleType, ['moto', 'standard', 'van'], true)) {
    wd2_send(422, ['ok' => false, 'error' => 'invalid_vehicle_type']);
}
if ($password === '') {
    $password = substr(rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '='), 0, 16);
} elseif (strlen($password) < 8) {
    wd2_send(422, ['ok' => false, 'error' => 'weak_password']);
}

// Create the Supabase Auth user.
$createPayload = json_encode([
    'email' => $email,
    'password' => $password,
    'email_confirm' => true,
    'user_metadata' => [
        'full_name' => $fullName,
        'phone' => $phone,
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

[$createStatus, $createBody] = bl_http_post(
    $supaUrl . '/auth/v1/admin/users',
    (string) $createPayload,
    [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
        'Accept: application/json',
    ]
);
$created = json_decode($createBody, true);
if ($createStatus < 200 || $createStatus >= 300 || !is_array($created) || empty($created['id'])) {
    $detail = is_array($created)
        ? (string) ($created['message'] ?? $created['msg'] ?? $created['error_description'] ?? 'supabase_error')
        : 'supabase_error';
    $status = ($createStatus === 422 || stripos($detail, 'already') !== false) ? 409 : 502;
    wd2_send($status, ['ok' => false, 'error' => 'auth_create_failed', 'detail' => $detail]);
}
$userId = (string) $created['id'];

$avatarUrl = trim((string) ($input['avatar_url'] ?? ''));
$avatarUploaded = false;
$avatarDetail = 'no_avatar';

// Multipart avatar upload, compressed by the client and validated again here.
if ($isMultipart
    && !empty($_FILES['avatar_file'])
    && ($_FILES['avatar_file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
    $tmp = (string) ($_FILES['avatar_file']['tmp_name'] ?? '');
    $size = (int) ($_FILES['avatar_file']['size'] ?? 0);
    $mime = $tmp !== '' ? (string) (@mime_content_type($tmp) ?: '') : '';
    $allowedMime = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    if (!is_uploaded_file($tmp)) {
        $avatarDetail = 'invalid_upload';
    } elseif ($size <= 0 || $size > 8 * 1024 * 1024) {
        $avatarDetail = 'invalid_size';
    } elseif (!isset($allowedMime[$mime])) {
        $avatarDetail = 'invalid_mime';
    } else {
        $binary = (string) file_get_contents($tmp);
        $objectPath = $userId . '/avatar.' . $allowedMime[$mime];
        $ch = curl_init($supaUrl . '/storage/v1/object/avatars/' . $objectPath);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_POSTFIELDS => $binary,
            CURLOPT_HTTPHEADER => [
                'apikey: ' . $serviceKey,
                'Authorization: Bearer ' . $serviceKey,
                'Content-Type: ' . $mime,
                'x-upsert: true',
            ],
        ]);
        $uploadBody = (string) curl_exec($ch);
        $uploadStatus = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $uploadError = curl_error($ch);
        curl_close($ch);

        if ($uploadStatus >= 200 && $uploadStatus < 300) {
            $avatarUrl = $supaUrl . '/storage/v1/object/public/avatars/' . $objectPath;
            $avatarUploaded = true;
            $avatarDetail = 'uploaded';
        } else {
            $avatarDetail = 'storage_' . $uploadStatus . ' ' . ($uploadError ?: substr($uploadBody, 0, 120));
        }
    }
}

// New drivers cannot operate until a membership is recorded.
$profilePayload = json_encode([
    'id' => $userId,
    'full_name' => $fullName,
    'email' => $email,
    'phone' => $phone,
    'role' => 'driver',
    'status' => 'offline',
    'vehicle_type' => $vehicleType,
    'vehicle_brand' => $vehicleBrand,
    'vehicle_model' => $vehicleModel,
    'vehicle_color' => $vehicleColor,
    'license_plate' => $licensePlate,
    'avatar_url' => $avatarUrl,
    'payment_qr_url' => $paymentQrUrl,
    'subscription_status' => 'suspended',
    'last_payment_date' => null,
    'suspended_at' => gmdate('c'),
    'suspension_reason' => 'pending_membership',
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

[$profileStatus, $profileBody] = bl_http_post(
    $supaUrl . '/rest/v1/profiles',
    (string) $profilePayload,
    [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
        'Prefer: return=minimal',
    ]
);

if ($profileStatus < 200 || $profileStatus >= 300) {
    // Best-effort rollback to avoid an orphaned Auth account.
    $ch = curl_init($supaUrl . '/auth/v1/admin/users/' . rawurlencode($userId));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $serviceKey,
            'Authorization: Bearer ' . $serviceKey,
        ],
    ]);
    curl_exec($ch);
    curl_close($ch);
    wd2_send(502, ['ok' => false, 'error' => 'profile_insert_failed', 'detail' => substr($profileBody, 0, 250)]);
}

// Audit is best-effort; account creation must not be rolled back for logging.
$auditPayload = json_encode([
    'actor_id' => $callerId,
    'action' => 'driver.create',
    'entity_type' => 'profile',
    'entity_id' => $userId,
    'after_data' => [
        'full_name' => $fullName,
        'email' => $email,
        'vehicle_type' => $vehicleType,
        'subscription_status' => 'suspended',
    ],
    'reason' => 'Alta administrativa pendiente de membresía',
    'metadata' => ['source' => 'welcome-driver-v2'],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
try {
    bl_http_post(
        $supaUrl . '/rest/v1/admin_audit_log',
        (string) $auditPayload,
        [
            'apikey: ' . $serviceKey,
            'Authorization: Bearer ' . $serviceKey,
            'Content-Type: application/json',
            'Prefer: return=minimal',
        ]
    );
} catch (Throwable $e) {
    error_log('[welcome-driver-v2] audit failed: ' . $e->getMessage());
}

// Send credentials to the driver's own verified destination.
$safeName = htmlspecialchars($fullName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$safeEmail = htmlspecialchars($email, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$safePassword = htmlspecialchars($password, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$playStoreUrl = 'https://play.google.com/store/apps/details?id=com.higoapp.ve';
$subject = '=?UTF-8?B?' . base64_encode('Bienvenido a Higo App — ' . $fullName) . '?=';
$html = '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px">'
    . '<div style="max-width:600px;margin:auto;background:white;padding:28px;border-radius:16px">'
    . '<h1>¡Bienvenido a Higo, ' . $safeName . '!</h1>'
    . '<p>Tu cuenta de Higo Driver fue creada. Para recibir viajes primero debes tener una membresía vigente.</p>'
    . '<p><strong>Correo:</strong> ' . $safeEmail . '<br><strong>Contraseña temporal:</strong> ' . $safePassword . '</p>'
    . '<p><a href="' . $playStoreUrl . '">Descargar Higo App</a></p>'
    . '<p>Al iniciar sesión podrás revisar tu membresía en Higo Pay.</p>'
    . '<p>Soporte: admin@higoapp.com</p>'
    . '</div></body></html>';
$headers = "From: noreply@higoapp.com\r\n"
    . "Reply-To: admin@higoapp.com\r\n"
    . "MIME-Version: 1.0\r\n"
    . "Content-Type: text/html; charset=UTF-8\r\n";
$emailSent = @mail($email, $subject, $html, $headers);

wd2_send(200, [
    'ok' => true,
    'user_id' => $userId,
    'email_sent' => (bool) $emailSent,
    'avatar_uploaded' => $avatarUploaded,
    'avatar_detail' => $avatarDetail,
    'membership_required' => true,
]);
