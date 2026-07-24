<?php
declare(strict_types=1);

require_once __DIR__ . '/_driver_applications.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = da_config();
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('driver-application-documents', 10, '/tmp/higo_driver_application_documents.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    da_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$token = trim((string) ($_POST['token'] ?? ''));
if (!preg_match('/^[A-Za-z0-9_-]{40,64}$/', $token)) {
    da_send(401, ['ok' => false, 'error' => 'invalid_or_expired_token']);
}
$tokenHash = hash('sha256', $token);

[$tokenStatus, $tokenBody] = bl_http_get(
    $cfg['_supabase_url'] . '/rest/v1/driver_application_upload_tokens?token_hash=eq.' . rawurlencode($tokenHash) . '&select=*',
    da_service_headers($cfg)
);
$tokenRows = json_decode($tokenBody, true);
$tokenRow = is_array($tokenRows) && isset($tokenRows[0]) && is_array($tokenRows[0]) ? $tokenRows[0] : null;
if ($tokenStatus < 200 || $tokenStatus >= 300 || $tokenRow === null) {
    da_send(401, ['ok' => false, 'error' => 'invalid_or_expired_token']);
}
if (!empty($tokenRow['used_at']) || strtotime((string) ($tokenRow['expires_at'] ?? '')) < time()) {
    da_send(401, ['ok' => false, 'error' => 'invalid_or_expired_token']);
}

$applicationId = (string) ($tokenRow['application_id'] ?? '');
[$appStatus, $appBody] = bl_http_get(
    $cfg['_supabase_url'] . '/rest/v1/driver_applications?id=eq.' . rawurlencode($applicationId) . '&select=*',
    da_service_headers($cfg)
);
$appRows = json_decode($appBody, true);
$application = is_array($appRows) && isset($appRows[0]) && is_array($appRows[0]) ? $appRows[0] : null;
if ($appStatus < 200 || $appStatus >= 300 || $application === null) {
    da_send(404, ['ok' => false, 'error' => 'application_not_found']);
}
if (!in_array((string) $application['status'], ['documents_requested','correction_requested'], true)) {
    da_send(409, ['ok' => false, 'error' => 'documents_not_expected']);
}

$allowedFields = [
    'identity' => 'identity',
    'driver_license' => 'driver_license',
    'vehicle_registration' => 'vehicle_registration',
    'rcv' => 'rcv',
    'vehicle_photo' => 'vehicle_photo',
    'health_certificate' => 'health_certificate',
    'payment_details' => 'payment_details',
    'other' => 'other',
];
$allowedMime = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'application/pdf' => 'pdf',
];
$totalSize = 0;
$prepared = [];
$finfo = new finfo(FILEINFO_MIME_TYPE);

foreach ($allowedFields as $field => $documentType) {
    if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) continue;
    $file = $_FILES[$field];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
        da_send(422, ['ok' => false, 'error' => 'upload_failed', 'detail' => $field]);
    }
    $tmp = (string) ($file['tmp_name'] ?? '');
    $size = (int) ($file['size'] ?? 0);
    if (!is_uploaded_file($tmp) || $size <= 0 || $size > 8388608) {
        da_send(422, ['ok' => false, 'error' => 'invalid_file_size', 'detail' => $field]);
    }
    $mime = (string) $finfo->file($tmp);
    if (!isset($allowedMime[$mime])) {
        da_send(422, ['ok' => false, 'error' => 'invalid_file_type', 'detail' => $field]);
    }
    $totalSize += $size;
    if ($totalSize > 31457280) da_send(422, ['ok' => false, 'error' => 'total_upload_too_large']);
    $prepared[] = [
        'field' => $field,
        'document_type' => $documentType,
        'tmp' => $tmp,
        'size' => $size,
        'mime' => $mime,
        'extension' => $allowedMime[$mime],
        'name' => substr(basename((string) ($file['name'] ?? $field)), 0, 180),
    ];
}

if (!$prepared) da_send(422, ['ok' => false, 'error' => 'no_documents']);

$uploaded = [];
$applicationCode = (string) $application['application_code'];
foreach ($prepared as $file) {
    $objectPath = $applicationCode . '/' . $file['document_type'] . '/' . bin2hex(random_bytes(16)) . '.' . $file['extension'];
    $binary = file_get_contents($file['tmp']);
    if ($binary === false) da_send(500, ['ok' => false, 'error' => 'file_read_failed']);

    [$storageStatus, $storageBody] = bl_http_post(
        $cfg['_supabase_url'] . '/storage/v1/object/driver-applications/' . $objectPath,
        $binary,
        [
            'apikey: ' . $cfg['_supabase_service'],
            'Authorization: Bearer ' . $cfg['_supabase_service'],
            'Content-Type: ' . $file['mime'],
            'x-upsert: false',
        ],
        45
    );
    if ($storageStatus < 200 || $storageStatus >= 300) {
        error_log('[driver-application-documents] storage HTTP ' . $storageStatus . ': ' . substr($storageBody, 0, 250));
        da_send(502, ['ok' => false, 'error' => 'storage_upload_failed', 'detail' => $file['field']]);
    }

    $documentPayload = json_encode([[
        'application_id' => $applicationId,
        'document_type' => $file['document_type'],
        'file_name' => $file['name'],
        'mime_type' => $file['mime'],
        'size_bytes' => $file['size'],
        'storage_path' => $objectPath,
    ]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    [$documentStatus, $documentBody] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/driver_application_documents',
        (string) $documentPayload,
        da_service_headers($cfg, ['Prefer: return=representation'])
    );
    $documentRows = json_decode($documentBody, true);
    if ($documentStatus < 200 || $documentStatus >= 300 || !is_array($documentRows) || empty($documentRows[0]['id'])) {
        error_log('[driver-application-documents] metadata HTTP ' . $documentStatus . ': ' . substr($documentBody, 0, 250));
        da_send(502, ['ok' => false, 'error' => 'document_metadata_failed']);
    }
    $uploaded[] = $documentRows[0];
}

$now = gmdate('c');
bl_http_patch(
    $cfg['_supabase_url'] . '/rest/v1/driver_application_upload_tokens?id=eq.' . rawurlencode((string) $tokenRow['id']),
    json_encode(['used_at' => $now, 'last_used_at' => $now]),
    da_service_headers($cfg, ['Prefer: return=minimal'])
);
bl_http_patch(
    $cfg['_supabase_url'] . '/rest/v1/driver_applications?id=eq.' . rawurlencode($applicationId),
    json_encode([
        'status' => 'documents_submitted',
        'status_reason' => null,
        'last_status_changed_at' => $now,
        'last_status_changed_by' => null,
    ]),
    da_service_headers($cfg, ['Prefer: return=minimal'])
);

$eventPayload = json_encode([[
    'application_id' => $applicationId,
    'actor_type' => 'applicant',
    'event_type' => 'documents_submitted',
    'from_status' => (string) $application['status'],
    'to_status' => 'documents_submitted',
    'metadata' => ['documents_count' => count($uploaded)],
]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
bl_http_post(
    $cfg['_supabase_url'] . '/rest/v1/driver_application_events',
    (string) $eventPayload,
    da_service_headers($cfg, ['Prefer: return=minimal'])
);

$subject = 'Documentos recibidos Higo Driver - ' . $applicationCode;
$name = htmlspecialchars((string) $application['full_name'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$html = da_email_shell($subject,
    '<p>Hola ' . $name . ',</p><p>Recibimos los documentos de tu solicitud <strong>'
    . htmlspecialchars($applicationCode, ENT_QUOTES, 'UTF-8')
    . '</strong>. El equipo Higo los revisará y te notificará el resultado.</p>'
);
$emailSent = da_send_email((string) $application['email'], $subject, $html);

da_send(200, [
    'ok' => true,
    'application_id' => $applicationCode,
    'status' => 'documents_submitted',
    'documents_received' => count($uploaded),
    'confirmation_email_sent' => $emailSent,
]);
