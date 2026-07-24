<?php
declare(strict_types=1);

require_once __DIR__ . '/_driver_applications.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = da_config();
api_apply_cors($cfg, 'POST, OPTIONS', ['X-Higo-Driver-Secret']);
api_rate_limit('driver-applications-ingest', 30, '/tmp/higo_driver_applications_ingest.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    da_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$expectedSecret = (string) ($cfg['DRIVER_APPLICATION_INGEST_SECRET'] ?? $cfg['HIGO_DRIVER_INGEST_SECRET'] ?? '');
$providedSecret = (string) ($_SERVER['HTTP_X_HIGO_DRIVER_SECRET'] ?? '');
if ($expectedSecret === '') da_send(503, ['ok' => false, 'error' => 'ingest_not_configured']);
if ($providedSecret === '' || !hash_equals($expectedSecret, $providedSecret)) {
    da_send(401, ['ok' => false, 'error' => 'unauthorized']);
}

$input = da_json_input();
$code = strtoupper(trim((string) ($input['application_code'] ?? '')));
$incomingStatus = trim((string) ($input['status'] ?? 'pending_delivery'));
$email = strtolower(trim((string) ($input['email'] ?? '')));
$cedula = strtoupper(trim((string) ($input['cedula'] ?? '')));
$phone = trim((string) ($input['phone'] ?? ''));
$phoneDigits = preg_replace('/\D+/', '', (string) ($input['phone_digits'] ?? $phone)) ?: '';
$vehicleType = trim((string) ($input['vehicle_type'] ?? ''));
$plate = strtoupper(trim((string) ($input['license_plate'] ?? '')));
$yearRaw = $input['vehicle_year'] ?? null;
$year = ($yearRaw === '' || $yearRaw === null) ? null : (int) $yearRaw;

if (!preg_match('/^HD-\d{8}-[A-F0-9]{8}$/', $code)) da_send(422, ['ok' => false, 'error' => 'invalid_application_code']);
if (!in_array($incomingStatus, ['pending_delivery','received','delivery_failed'], true)) da_send(422, ['ok' => false, 'error' => 'invalid_status']);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) da_send(422, ['ok' => false, 'error' => 'invalid_email']);
if (!preg_match('/^[VEJPG]-?\d{5,12}$/', $cedula)) da_send(422, ['ok' => false, 'error' => 'invalid_cedula']);
if (strlen($phoneDigits) < 10 || strlen($phoneDigits) > 15) da_send(422, ['ok' => false, 'error' => 'invalid_phone']);
if (!in_array($vehicleType, ['moto','carro','camioneta'], true)) da_send(422, ['ok' => false, 'error' => 'invalid_vehicle_type']);
if (!preg_match('/^[A-Z0-9-]{3,12}$/', $plate)) da_send(422, ['ok' => false, 'error' => 'invalid_plate']);

$requiredText = [
    'idempotency_hash', 'full_name', 'city', 'vehicle_brand', 'vehicle_model',
    'vehicle_color', 'terms_version', 'privacy_version', 'email_hash', 'license_plate_hash'
];
foreach ($requiredText as $key) {
    if (trim((string) ($input[$key] ?? '')) === '') da_send(422, ['ok' => false, 'error' => 'missing_field', 'detail' => $key]);
}

$idempotencyHash = strtolower(trim((string) $input['idempotency_hash']));
$commonPayload = [
    'full_name' => trim((string) $input['full_name']),
    'cedula' => $cedula,
    'phone' => $phone,
    'phone_digits' => $phoneDigits,
    'email' => $email,
    'email_hash' => strtolower(trim((string) $input['email_hash'])),
    'city' => trim((string) $input['city']),
    'vehicle_type' => $vehicleType,
    'vehicle_brand' => trim((string) $input['vehicle_brand']),
    'vehicle_model' => trim((string) $input['vehicle_model']),
    'vehicle_year' => $year,
    'vehicle_color' => trim((string) $input['vehicle_color']),
    'license_plate' => $plate,
    'license_plate_hash' => strtolower(trim((string) $input['license_plate_hash'])),
    'terms_version' => trim((string) $input['terms_version']),
    'privacy_version' => trim((string) $input['privacy_version']),
    'accept_terms' => (bool) ($input['accept_terms'] ?? false),
    'accept_privacy' => (bool) ($input['accept_privacy'] ?? false),
    'accept_contact' => (bool) ($input['accept_contact'] ?? false),
    'source' => substr(trim((string) ($input['source'] ?? 'higodriver.com')), 0, 80),
    'submitted_ip_hash' => substr(trim((string) ($input['submitted_ip_hash'] ?? '')), 0, 128) ?: null,
    'confirmation_email_sent' => (bool) ($input['confirmation_email_sent'] ?? false),
];

try {
    $existing = da_fetch_application($cfg, $code);
} catch (Throwable $e) {
    error_log('[driver-applications-ingest] lookup failed: ' . $e->getMessage());
    da_send(502, ['ok' => false, 'error' => 'application_lookup_failed']);
}

$created = $existing === null;
$effectiveStatus = $incomingStatus;

if ($existing !== null) {
    if (!hash_equals((string) ($existing['idempotency_hash'] ?? ''), $idempotencyHash)) {
        da_send(409, ['ok' => false, 'error' => 'application_code_conflict']);
    }

    $currentStatus = (string) ($existing['status'] ?? 'pending_delivery');
    $advancedStatuses = [
        'under_review', 'documents_requested', 'documents_submitted', 'correction_requested',
        'approved', 'converted', 'waitlist', 'rejected'
    ];

    if (in_array($currentStatus, $advancedStatuses, true)) {
        $effectiveStatus = $currentStatus;
    } elseif ($currentStatus === 'received') {
        $effectiveStatus = 'received';
    } elseif ($currentStatus === 'delivery_failed') {
        $effectiveStatus = $incomingStatus === 'received' ? 'received' : 'delivery_failed';
    } elseif ($currentStatus === 'pending_delivery') {
        $effectiveStatus = $incomingStatus;
    } else {
        $effectiveStatus = $currentStatus;
    }

    $patchPayload = $commonPayload + [
        'status' => $effectiveStatus,
        'last_status_changed_at' => $effectiveStatus !== $currentStatus ? gmdate('c') : (string) ($existing['last_status_changed_at'] ?? gmdate('c')),
    ];
    [$writeStatus, $writeBody] = bl_http_patch(
        $cfg['_supabase_url'] . '/rest/v1/driver_applications?id=eq.' . rawurlencode((string) $existing['id']),
        (string) json_encode($patchPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        da_service_headers($cfg, ['Prefer: return=representation'])
    );
} else {
    $insertPayload = $commonPayload + [
        'application_code' => $code,
        'idempotency_hash' => $idempotencyHash,
        'status' => $effectiveStatus,
        'last_status_changed_at' => gmdate('c'),
    ];
    [$writeStatus, $writeBody] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/driver_applications',
        (string) json_encode([$insertPayload], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        da_service_headers($cfg, ['Prefer: return=representation'])
    );
}

$rows = json_decode($writeBody, true);
if ($writeStatus < 200 || $writeStatus >= 300 || !is_array($rows) || empty($rows[0]['id'])) {
    error_log('[driver-applications-ingest] write failed HTTP ' . $writeStatus . ': ' . substr($writeBody, 0, 400));
    da_send(502, ['ok' => false, 'error' => 'application_sync_failed']);
}

$event = json_encode([[
    'application_id' => (string) $rows[0]['id'],
    'actor_type' => 'system',
    'event_type' => 'portal_sync',
    'to_status' => $effectiveStatus,
    'metadata' => [
        'source' => 'higodriver.com',
        'incoming_status' => $incomingStatus,
        'effective_status' => $effectiveStatus,
        'created' => $created,
    ],
]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
try {
    bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/driver_application_events',
        (string) $event,
        da_service_headers($cfg, ['Prefer: return=minimal'])
    );
} catch (Throwable $e) {
    error_log('[driver-applications-ingest] event failed: ' . $e->getMessage());
}

da_send(200, [
    'ok' => true,
    'application_id' => $code,
    'status' => $effectiveStatus,
    'created' => $created,
]);
