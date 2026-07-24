<?php
declare(strict_types=1);

require_once __DIR__ . '/_driver_applications.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = da_config();
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('convert-driver-application', 8, '/tmp/higo_convert_driver_application.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    da_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

[$callerId] = da_require_admin($cfg, 'manage_drivers', true);
$input = da_json_input();
$code = strtoupper(trim((string) ($input['application_code'] ?? '')));
$paymentQrUrl = trim((string) ($input['payment_qr_url'] ?? ''));
$avatarUrl = trim((string) ($input['avatar_url'] ?? ''));
if (!preg_match('/^HD-\d{8}-[A-F0-9]{8}$/', $code)) {
    da_send(422, ['ok' => false, 'error' => 'invalid_application_code']);
}

try {
    $application = da_fetch_application($cfg, $code);
} catch (Throwable $e) {
    da_send(502, ['ok' => false, 'error' => 'application_fetch_failed']);
}
if ($application === null) da_send(404, ['ok' => false, 'error' => 'not_found']);
if (!empty($application['converted_user_id']) || (string) $application['status'] === 'converted') {
    da_send(200, [
        'ok' => true,
        'already_converted' => true,
        'user_id' => (string) ($application['converted_user_id'] ?? ''),
        'application_id' => $code,
    ]);
}
if ((string) $application['status'] !== 'approved') {
    da_send(409, ['ok' => false, 'error' => 'application_not_approved']);
}

$fullName = trim((string) $application['full_name']);
$email = strtolower(trim((string) $application['email']));
$phone = trim((string) $application['phone']);
$vehicleMap = ['moto' => 'moto', 'carro' => 'standard', 'camioneta' => 'van'];
$vehicleType = $vehicleMap[(string) $application['vehicle_type']] ?? 'standard';
$vehicleBrand = trim((string) $application['vehicle_brand']);
$vehicleModel = trim((string) $application['vehicle_model']);
$vehicleColor = trim((string) $application['vehicle_color']);
$licensePlate = strtoupper(trim((string) $application['license_plate']));
$password = substr(rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '='), 0, 18);

$createPayload = json_encode([
    'email' => $email,
    'password' => $password,
    'email_confirm' => true,
    'user_metadata' => [
        'full_name' => $fullName,
        'phone' => $phone,
        'source' => 'driver_application',
        'application_code' => $code,
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
[$createStatus, $createBody] = bl_http_post(
    $cfg['_supabase_url'] . '/auth/v1/admin/users',
    (string) $createPayload,
    [
        'apikey: ' . $cfg['_supabase_service'],
        'Authorization: Bearer ' . $cfg['_supabase_service'],
        'Content-Type: application/json',
        'Accept: application/json',
    ]
);
$created = json_decode($createBody, true);
if ($createStatus < 200 || $createStatus >= 300 || !is_array($created) || empty($created['id'])) {
    $detail = is_array($created)
        ? (string) ($created['message'] ?? $created['msg'] ?? $created['error_description'] ?? 'supabase_error')
        : 'supabase_error';
    $http = ($createStatus === 422 || stripos($detail, 'already') !== false) ? 409 : 502;
    da_send($http, ['ok' => false, 'error' => 'auth_create_failed', 'detail' => $detail]);
}
$userId = (string) $created['id'];

$profilePayload = json_encode([[
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
]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
[$profileStatus, $profileBody] = bl_http_post(
    $cfg['_supabase_url'] . '/rest/v1/profiles',
    (string) $profilePayload,
    da_service_headers($cfg, ['Prefer: return=minimal'])
);
if ($profileStatus < 200 || $profileStatus >= 300) {
    $ch = curl_init($cfg['_supabase_url'] . '/auth/v1/admin/users/' . rawurlencode($userId));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $cfg['_supabase_service'],
            'Authorization: Bearer ' . $cfg['_supabase_service'],
        ],
    ]);
    curl_exec($ch);
    curl_close($ch);
    da_send(502, ['ok' => false, 'error' => 'profile_insert_failed', 'detail' => substr($profileBody, 0, 250)]);
}

$now = gmdate('c');
[$applicationStatus, $applicationBody] = bl_http_patch(
    $cfg['_supabase_url'] . '/rest/v1/driver_applications?id=eq.' . rawurlencode((string) $application['id']),
    json_encode([
        'status' => 'converted',
        'converted_user_id' => $userId,
        'converted_at' => $now,
        'last_status_changed_at' => $now,
        'last_status_changed_by' => $callerId,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    da_service_headers($cfg, ['Prefer: return=minimal'])
);
$linked = $applicationStatus >= 200 && $applicationStatus < 300;
if (!$linked) {
    error_log('[convert-driver-application] application link failed HTTP ' . $applicationStatus . ': ' . substr($applicationBody, 0, 250));
}

$eventPayload = json_encode([[
    'application_id' => (string) $application['id'],
    'actor_type' => 'admin',
    'actor_id' => $callerId,
    'event_type' => 'driver_account_created',
    'from_status' => 'approved',
    'to_status' => 'converted',
    'metadata' => ['user_id' => $userId],
]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$auditPayload = json_encode([[
    'actor_id' => $callerId,
    'action' => 'driver_application.convert',
    'entity_type' => 'driver_application',
    'entity_id' => $code,
    'before_data' => ['status' => 'approved'],
    'after_data' => ['status' => 'converted', 'user_id' => $userId],
    'reason' => 'Solicitud aprobada convertida a cuenta Higo Driver',
    'metadata' => ['source' => 'admin_driver_applications'],
]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
try {
    bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/driver_application_events',
        (string) $eventPayload,
        da_service_headers($cfg, ['Prefer: return=minimal'])
    );
    bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/admin_audit_log',
        (string) $auditPayload,
        da_service_headers($cfg, ['Prefer: return=minimal'])
    );
} catch (Throwable $e) {
    error_log('[convert-driver-application] audit failed: ' . $e->getMessage());
}

$safeName = htmlspecialchars($fullName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$safeEmail = htmlspecialchars($email, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$safePassword = htmlspecialchars($password, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$playStoreUrl = 'https://play.google.com/store/apps/details?id=com.higoapp.ve';
$subject = 'Bienvenido a Higo Driver - ' . $fullName;
$html = da_email_shell($subject,
    '<p>¡Hola ' . $safeName . '!</p>'
    . '<p>Tu solicitud <strong>' . htmlspecialchars($code, ENT_QUOTES, 'UTF-8') . '</strong> fue aprobada y tu cuenta Higo Driver ya está creada.</p>'
    . '<p><strong>Correo:</strong> ' . $safeEmail . '<br><strong>Contraseña temporal:</strong> <span style="font-family:monospace;font-size:17px;">' . $safePassword . '</span></p>'
    . '<p><a href="' . $playStoreUrl . '" style="display:inline-block;padding:13px 20px;background:#315ef4;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">Descargar Higo en Google Play</a></p>'
    . '<p>Al iniciar sesión podrás consultar Higo Pay. Tu cuenta permanecerá suspendida hasta registrar una membresía vigente.</p>'
    . '<p style="color:#b45309;"><strong>Seguridad:</strong> cambia la contraseña temporal después de ingresar.</p>'
);
$emailSent = da_send_email($email, $subject, $html);

da_send(200, [
    'ok' => true,
    'application_id' => $code,
    'user_id' => $userId,
    'email_sent' => $emailSent,
    'application_linked' => $linked,
    'membership_required' => true,
]);
