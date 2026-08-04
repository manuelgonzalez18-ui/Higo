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

[$callerId, $callerJwt] = da_require_admin($cfg, 'manage_drivers', true);
$input = da_json_input();
$code = strtoupper(trim((string) ($input['application_code'] ?? '')));
$paymentQrUrl = trim((string) ($input['payment_qr_url'] ?? ''));
if (!preg_match('/^HD-\d{8}-[A-F0-9]{8}$/', $code)) {
    da_send(422, ['ok' => false, 'error' => 'invalid_application_code']);
}

[$claimStatus, $claimBody] = bl_http_post(
    $cfg['_supabase_url'] . '/rest/v1/rpc/admin_claim_driver_application_conversion',
    (string) json_encode(['p_application_code' => $code]),
    [
        'apikey: ' . $cfg['_supabase_anon'],
        'Authorization: Bearer ' . $callerJwt,
        'Content-Type: application/json',
        'Accept: application/json',
    ]
);
$application = json_decode($claimBody, true);
if ($claimStatus < 200 || $claimStatus >= 300 || !is_array($application)) {
    $detail = is_array($application)
        ? (string) ($application['message'] ?? $application['error'] ?? 'conversion_claim_failed')
        : substr($claimBody, 0, 200);
    $http = str_contains($detail, 'conversion_in_progress') ? 409 : 422;
    da_send($http, ['ok' => false, 'error' => 'conversion_claim_failed', 'detail' => $detail]);
}
if (($application['already_converted'] ?? false) === true) {
    da_send(200, [
        'ok' => true,
        'already_converted' => true,
        'user_id' => (string) ($application['converted_user_id'] ?? ''),
        'application_id' => $code,
    ]);
}

$claimId = (string) ($application['conversion_claim_id'] ?? '');
if (!preg_match('/^[0-9a-f-]{36}$/i', $claimId)) {
    da_send(502, ['ok' => false, 'error' => 'conversion_claim_invalid']);
}

$applicationId = (string) ($application['id'] ?? '');
$profilePhoto = cv_fetch_approved_profile_photo($cfg, $applicationId);
if ($profilePhoto === null) {
    cv_release_claim($cfg, $callerJwt, $code, $claimId);
    da_send(422, ['ok' => false, 'error' => 'approved_profile_photo_required']);
}

$fullName = trim((string) ($application['full_name'] ?? ''));
$email = strtolower(trim((string) ($application['email'] ?? '')));
$phone = trim((string) ($application['phone'] ?? ''));
$vehicleMap = ['moto' => 'moto', 'carro' => 'standard', 'camioneta' => 'van'];
$vehicleType = $vehicleMap[(string) ($application['vehicle_type'] ?? '')] ?? 'standard';
$vehicleBrand = trim((string) ($application['vehicle_brand'] ?? ''));
$vehicleModel = trim((string) ($application['vehicle_model'] ?? ''));
$vehicleColor = trim((string) ($application['vehicle_color'] ?? ''));
$licensePlate = strtoupper(trim((string) ($application['license_plate'] ?? '')));
$password = substr(rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='), 0, 24);

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
    cv_release_claim($cfg, $callerJwt, $code, $claimId);
    $detail = is_array($created)
        ? (string) ($created['message'] ?? $created['msg'] ?? $created['error_description'] ?? 'supabase_error')
        : 'supabase_error';
    $http = ($createStatus === 422 || stripos($detail, 'already') !== false) ? 409 : 502;
    da_send($http, ['ok' => false, 'error' => 'auth_create_failed', 'detail' => $detail]);
}
$userId = (string) $created['id'];

$publishedAvatar = cv_publish_profile_photo($cfg, $profilePhoto, $userId);
if ($publishedAvatar === null) {
    cv_delete_auth_user($cfg, $userId);
    cv_release_claim($cfg, $callerJwt, $code, $claimId);
    da_send(502, ['ok' => false, 'error' => 'profile_photo_publish_failed']);
}
$avatarUrl = $publishedAvatar['url'];
$avatarPath = $publishedAvatar['path'];

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
    $cfg['_supabase_url'] . '/rest/v1/profiles?on_conflict=id',
    (string) $profilePayload,
    da_service_headers($cfg, ['Prefer: resolution=merge-duplicates,return=minimal'])
);
if ($profileStatus < 200 || $profileStatus >= 300) {
    cv_delete_avatar($cfg, $avatarPath);
    cv_delete_auth_user($cfg, $userId);
    cv_release_claim($cfg, $callerJwt, $code, $claimId);
    da_send(502, ['ok' => false, 'error' => 'profile_insert_failed', 'detail' => substr($profileBody, 0, 250)]);
}

[$completeStatus, $completeBody] = bl_http_post(
    $cfg['_supabase_url'] . '/rest/v1/rpc/admin_complete_driver_application_conversion',
    (string) json_encode([
        'p_application_code' => $code,
        'p_claim_id' => $claimId,
        'p_user_id' => $userId,
    ]),
    [
        'apikey: ' . $cfg['_supabase_anon'],
        'Authorization: Bearer ' . $callerJwt,
        'Content-Type: application/json',
        'Accept: application/json',
    ]
);
$completed = json_decode($completeBody, true);
if ($completeStatus < 200 || $completeStatus >= 300 || !is_array($completed)) {
    cv_delete_profile($cfg, $userId);
    cv_delete_avatar($cfg, $avatarPath);
    cv_delete_auth_user($cfg, $userId);
    cv_release_claim($cfg, $callerJwt, $code, $claimId);
    da_send(502, ['ok' => false, 'error' => 'conversion_finalize_failed', 'detail' => substr($completeBody, 0, 250)]);
}

$activationLink = cv_generate_recovery_link($cfg, $email);
$emailSent = false;
if ($activationLink !== '') {
    $safeName = htmlspecialchars($fullName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $playStoreUrl = 'https://play.google.com/store/apps/details?id=com.higoapp.ve';
    $subject = 'Bienvenido a Higo Driver - ' . $fullName;
    $html = da_email_shell($subject,
        '<p>¡Hola ' . $safeName . '!</p>'
        . '<p>Tu solicitud <strong>' . htmlspecialchars($code, ENT_QUOTES, 'UTF-8') . '</strong> fue aprobada y tu cuenta Higo Driver ya está creada.</p>'
        . '<p><a href="' . htmlspecialchars($activationLink, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:13px 20px;background:#315ef4;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">Crear mi contraseña</a></p>'
        . '<p>Este enlace es personal. No lo compartas.</p>'
        . '<p><a href="' . $playStoreUrl . '" style="display:inline-block;padding:13px 20px;background:#0f172a;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">Descargar Higo en Google Play</a></p>'
        . '<p>Tu cuenta permanecerá suspendida hasta registrar una membresía vigente en Higo Pay.</p>'
    );
    $emailSent = da_send_email($email, $subject, $html);
}

da_send(200, [
    'ok' => true,
    'application_id' => $code,
    'user_id' => $userId,
    'email_sent' => $emailSent,
    'activation_link_generated' => $activationLink !== '',
    'application_linked' => true,
    'avatar_url' => $avatarUrl,
    'membership_required' => true,
]);

function cv_fetch_approved_profile_photo(array $cfg, string $applicationId): ?array {
    if (!preg_match('/^[0-9a-f-]{36}$/i', $applicationId)) return null;
    $url = $cfg['_supabase_url'] . '/rest/v1/driver_application_documents?application_id=eq.'
        . rawurlencode($applicationId)
        . '&document_type=eq.profile_photo&review_status=eq.approved'
        . '&select=storage_path,mime_type&order=created_at.desc&limit=1';
    [$status, $body] = bl_http_get($url, da_service_headers($cfg));
    $rows = json_decode($body, true);
    if ($status < 200 || $status >= 300 || !is_array($rows) || empty($rows[0]['storage_path'])) return null;
    return $rows[0];
}

/** @return array{url:string,path:string}|null */
function cv_publish_profile_photo(array $cfg, array $photo, string $userId): ?array {
    $sourcePath = trim((string) ($photo['storage_path'] ?? ''));
    $mime = trim((string) ($photo['mime_type'] ?? ''));
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if ($sourcePath === '' || !isset($extensions[$mime])) return null;

    $encodedSource = cv_encode_storage_path($sourcePath);
    [$downloadStatus, $binary] = bl_http_get(
        $cfg['_supabase_url'] . '/storage/v1/object/driver-applications/' . $encodedSource,
        [
            'apikey: ' . $cfg['_supabase_service'],
            'Authorization: Bearer ' . $cfg['_supabase_service'],
            'Accept: ' . $mime,
        ]
    );
    if ($downloadStatus < 200 || $downloadStatus >= 300 || $binary === '') {
        error_log('[convert-driver-application] profile photo download failed: ' . $downloadStatus);
        return null;
    }

    $targetPath = $userId . '/profile.' . $extensions[$mime];
    [$uploadStatus, $uploadBody] = bl_http_post(
        $cfg['_supabase_url'] . '/storage/v1/object/driver-avatars/' . cv_encode_storage_path($targetPath),
        $binary,
        [
            'apikey: ' . $cfg['_supabase_service'],
            'Authorization: Bearer ' . $cfg['_supabase_service'],
            'Content-Type: ' . $mime,
            'x-upsert: true',
        ],
        45
    );
    if ($uploadStatus < 200 || $uploadStatus >= 300) {
        error_log('[convert-driver-application] profile photo publish failed: ' . $uploadStatus . ':' . substr($uploadBody, 0, 120));
        return null;
    }

    return [
        'path' => $targetPath,
        'url' => $cfg['_supabase_url'] . '/storage/v1/object/public/driver-avatars/' . cv_encode_storage_path($targetPath),
    ];
}

function cv_encode_storage_path(string $path): string {
    return implode('/', array_map('rawurlencode', explode('/', $path)));
}

function cv_delete_avatar(array $cfg, string $path): void {
    if ($path === '') return;
    $ch = curl_init($cfg['_supabase_url'] . '/storage/v1/object/driver-avatars/' . cv_encode_storage_path($path));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $cfg['_supabase_service'],
            'Authorization: Bearer ' . $cfg['_supabase_service'],
        ],
    ]);
    curl_exec($ch);
    curl_close($ch);
}

function cv_release_claim(array $cfg, string $callerJwt, string $code, string $claimId): void {
    try {
        bl_http_post(
            $cfg['_supabase_url'] . '/rest/v1/rpc/admin_release_driver_application_conversion',
            (string) json_encode(['p_application_code' => $code, 'p_claim_id' => $claimId]),
            [
                'apikey: ' . $cfg['_supabase_anon'],
                'Authorization: Bearer ' . $callerJwt,
                'Content-Type: application/json',
                'Accept: application/json',
            ]
        );
    } catch (Throwable $e) {
        error_log('[convert-driver-application] release claim failed: ' . $e->getMessage());
    }
}

function cv_delete_profile(array $cfg, string $userId): void {
    $ch = curl_init($cfg['_supabase_url'] . '/rest/v1/profiles?id=eq.' . rawurlencode($userId));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => da_service_headers($cfg, ['Prefer: return=minimal']),
    ]);
    curl_exec($ch);
    curl_close($ch);
}

function cv_delete_auth_user(array $cfg, string $userId): void {
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
}

function cv_generate_recovery_link(array $cfg, string $email): string {
    try {
        [$status, $body] = bl_http_post(
            $cfg['_supabase_url'] . '/auth/v1/admin/generate_link',
            (string) json_encode([
                'type' => 'recovery',
                'email' => $email,
                'redirect_to' => 'https://higoapp.com/#/reset-password',
            ], JSON_UNESCAPED_SLASHES),
            [
                'apikey: ' . $cfg['_supabase_service'],
                'Authorization: Bearer ' . $cfg['_supabase_service'],
                'Content-Type: application/json',
                'Accept: application/json',
            ]
        );
        $data = json_decode($body, true);
        if ($status < 200 || $status >= 300 || !is_array($data)) return '';
        return (string) ($data['properties']['action_link'] ?? $data['action_link'] ?? '');
    } catch (Throwable $e) {
        error_log('[convert-driver-application] activation link failed: ' . $e->getMessage());
        return '';
    }
}
