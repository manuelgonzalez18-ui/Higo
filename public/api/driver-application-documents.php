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

[$claimStatus, $claimBody] = bl_http_post(
    $cfg['_supabase_url'] . '/rest/v1/rpc/higo_claim_driver_application_upload_token',
    (string) json_encode(['p_token_hash' => $tokenHash]),
    da_service_headers($cfg)
);
$application = json_decode($claimBody, true);
if ($claimStatus < 200 || $claimStatus >= 300 || !is_array($application) || empty($application['upload_claim_id'])) {
    da_send(401, ['ok' => false, 'error' => 'invalid_or_expired_token']);
}

$claimId = (string) $application['upload_claim_id'];
$applicationId = (string) ($application['id'] ?? '');
$applicationCode = (string) ($application['application_code'] ?? '');
if ($applicationId === '' || $applicationCode === '') {
    dd_release_claim($cfg, $tokenHash, $claimId);
    da_send(502, ['ok' => false, 'error' => 'application_claim_invalid']);
}

$uploaded = [];
try {
    foreach ($prepared as $file) {
        $objectPath = $applicationCode . '/' . $file['document_type'] . '/' . bin2hex(random_bytes(16)) . '.' . $file['extension'];
        $binary = file_get_contents($file['tmp']);
        if ($binary === false) throw new RuntimeException('file_read_failed:' . $file['field']);

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
            throw new RuntimeException('storage_upload_failed:' . $file['field'] . ':' . $storageStatus . ':' . substr($storageBody, 0, 120));
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
            dd_delete_storage_object($cfg, $objectPath);
            throw new RuntimeException('document_metadata_failed:' . $documentStatus . ':' . substr($documentBody, 0, 120));
        }
        $uploaded[] = [
            'id' => (string) $documentRows[0]['id'],
            'storage_path' => $objectPath,
            'record' => $documentRows[0],
        ];
    }

    [$completeStatus, $completeBody] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/rpc/higo_complete_driver_application_upload',
        (string) json_encode([
            'p_token_hash' => $tokenHash,
            'p_claim_id' => $claimId,
            'p_documents_count' => count($uploaded),
        ]),
        da_service_headers($cfg)
    );
    $completed = json_decode($completeBody, true);
    if ($completeStatus < 200 || $completeStatus >= 300 || !is_array($completed)) {
        throw new RuntimeException('upload_finalize_failed:' . $completeStatus . ':' . substr($completeBody, 0, 160));
    }
} catch (Throwable $e) {
    error_log('[driver-application-documents] ' . $e->getMessage());
    dd_cleanup_uploads($cfg, $uploaded);
    dd_release_claim($cfg, $tokenHash, $claimId);
    da_send(502, ['ok' => false, 'error' => 'document_upload_not_completed']);
}

$subject = 'Documentos recibidos Higo Driver - ' . $applicationCode;
$name = htmlspecialchars((string) ($application['full_name'] ?? 'Conductor'), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$html = da_email_shell($subject,
    '<p>Hola ' . $name . ',</p><p>Recibimos los documentos de tu solicitud <strong>'
    . htmlspecialchars($applicationCode, ENT_QUOTES, 'UTF-8')
    . '</strong>. El equipo Higo los revisará y te notificará el resultado.</p>'
);
$emailSent = da_send_email((string) ($application['email'] ?? ''), $subject, $html);

da_send(200, [
    'ok' => true,
    'application_id' => $applicationCode,
    'status' => 'documents_submitted',
    'documents_received' => count($uploaded),
    'confirmation_email_sent' => $emailSent,
]);

function dd_release_claim(array $cfg, string $tokenHash, string $claimId): void {
    try {
        bl_http_post(
            $cfg['_supabase_url'] . '/rest/v1/rpc/higo_release_driver_application_upload_token',
            (string) json_encode(['p_token_hash' => $tokenHash, 'p_claim_id' => $claimId]),
            da_service_headers($cfg)
        );
    } catch (Throwable $e) {
        error_log('[driver-application-documents] release claim failed: ' . $e->getMessage());
    }
}

function dd_cleanup_uploads(array $cfg, array $uploaded): void {
    foreach (array_reverse($uploaded) as $item) {
        $id = (string) ($item['id'] ?? '');
        $path = (string) ($item['storage_path'] ?? '');
        if ($id !== '') dd_delete_document_record($cfg, $id);
        if ($path !== '') dd_delete_storage_object($cfg, $path);
    }
}

function dd_delete_document_record(array $cfg, string $id): void {
    $ch = curl_init($cfg['_supabase_url'] . '/rest/v1/driver_application_documents?id=eq.' . rawurlencode($id));
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

function dd_delete_storage_object(array $cfg, string $path): void {
    $ch = curl_init($cfg['_supabase_url'] . '/storage/v1/object/driver-applications/' . $path);
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
