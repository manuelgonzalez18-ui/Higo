<?php
declare(strict_types=1);

require_once __DIR__ . '/_driver_applications.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = da_config();
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('driver-application-admin', 40, '/tmp/higo_driver_application_admin.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    da_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

[$callerId, $callerJwt] = da_require_admin($cfg, 'manage_drivers', true);
$input = da_json_input();
$action = trim((string) ($input['action'] ?? ''));
$code = strtoupper(trim((string) ($input['application_code'] ?? '')));
if (!preg_match('/^HD-\d{8}-[A-F0-9]{8}$/', $code)) {
    da_send(422, ['ok' => false, 'error' => 'invalid_application_code']);
}

try {
    $application = da_fetch_application($cfg, $code);
} catch (Throwable $e) {
    da_send(502, ['ok' => false, 'error' => 'application_fetch_failed']);
}
if ($application === null) da_send(404, ['ok' => false, 'error' => 'not_found']);

if ($action === 'review_document') {
    $documentId = trim((string) ($input['document_id'] ?? ''));
    $reviewStatus = trim((string) ($input['review_status'] ?? ''));
    $notes = trim((string) ($input['notes'] ?? ''));
    if (!preg_match('/^[0-9a-f-]{36}$/i', $documentId) || !in_array($reviewStatus, ['approved','rejected'], true)) {
        da_send(422, ['ok' => false, 'error' => 'invalid_document_review']);
    }
    if ($reviewStatus === 'rejected' && $notes === '') {
        da_send(422, ['ok' => false, 'error' => 'document_rejection_reason_required']);
    }

    $rpcBody = json_encode([
        'p_document_id' => $documentId,
        'p_review_status' => $reviewStatus,
        'p_notes' => $notes === '' ? null : $notes,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    [$status, $body] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/rpc/admin_review_driver_application_document',
        (string) $rpcBody,
        [
            'apikey: ' . $cfg['_supabase_anon'],
            'Authorization: Bearer ' . $callerJwt,
            'Content-Type: application/json',
            'Accept: application/json',
        ]
    );
    $result = json_decode($body, true);
    if ($status < 200 || $status >= 300 || !is_array($result)) {
        da_send(422, ['ok' => false, 'error' => 'document_review_failed', 'detail' => substr($body, 0, 250)]);
    }

    $updatedApplication = null;
    $emailSent = null;
    if ($reviewStatus === 'rejected' && (string) ($application['status'] ?? '') === 'documents_submitted') {
        $statusBody = json_encode([
            'p_application_code' => $code,
            'p_status' => 'correction_requested',
            'p_reason' => $notes,
            'p_metadata' => [
                'source' => 'document_review',
                'document_id' => $documentId,
            ],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        [$statusCode, $statusResponse] = bl_http_post(
            $cfg['_supabase_url'] . '/rest/v1/rpc/admin_set_driver_application_status',
            (string) $statusBody,
            [
                'apikey: ' . $cfg['_supabase_anon'],
                'Authorization: Bearer ' . $callerJwt,
                'Content-Type: application/json',
                'Accept: application/json',
            ]
        );
        $updatedApplication = json_decode($statusResponse, true);
        if ($statusCode < 200 || $statusCode >= 300 || !is_array($updatedApplication)) {
            da_send(409, [
                'ok' => false,
                'error' => 'document_reviewed_status_update_failed',
                'document_reviewed' => true,
                'detail' => substr($statusResponse, 0, 250),
            ]);
        }
        [$subject, $html] = da_application_email_for_status($application, 'correction_requested', $notes);
        $emailSent = $subject === '' ? false : da_send_email((string) $application['email'], $subject, $html);
    }

    da_send(200, [
        'ok' => true,
        'document' => $result,
        'application' => $updatedApplication,
        'email_sent' => $emailSent,
    ]);
}

if ($action === 'request_documents') {
    $rawToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $tokenHash = hash('sha256', $rawToken);
    $expiresAt = gmdate('c', time() + 7 * 86400);
    $tokenBody = json_encode([[
        'application_id' => (string) $application['id'],
        'token_hash' => $tokenHash,
        'expires_at' => $expiresAt,
        'created_by' => $callerId,
    ]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    [$tokenStatus, $tokenResponse] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/driver_application_upload_tokens',
        (string) $tokenBody,
        da_service_headers($cfg, ['Prefer: return=representation'])
    );
    if ($tokenStatus < 200 || $tokenStatus >= 300) {
        da_send(502, ['ok' => false, 'error' => 'upload_token_failed', 'detail' => substr($tokenResponse, 0, 200)]);
    }

    $status = 'documents_requested';
    $reason = trim((string) ($input['reason'] ?? ''));
    $metadata = ['source' => 'admin_panel', 'upload_expires_at' => $expiresAt];
    $rpcBody = json_encode([
        'p_application_code' => $code,
        'p_status' => $status,
        'p_reason' => $reason === '' ? null : $reason,
        'p_metadata' => $metadata,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    [$rpcStatus, $rpcResponse] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/rpc/admin_set_driver_application_status',
        (string) $rpcBody,
        [
            'apikey: ' . $cfg['_supabase_anon'],
            'Authorization: Bearer ' . $callerJwt,
            'Content-Type: application/json',
            'Accept: application/json',
        ]
    );
    $updated = json_decode($rpcResponse, true);
    if ($rpcStatus < 200 || $rpcStatus >= 300 || !is_array($updated)) {
        da_send(422, ['ok' => false, 'error' => 'status_update_failed', 'detail' => substr($rpcResponse, 0, 250)]);
    }

    $name = htmlspecialchars((string) $application['full_name'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $uploadUrl = 'https://higodriver.com/documents/?token=' . rawurlencode($rawToken);
    $bodyHtml = '<p>Hola ' . $name . ',</p>'
        . '<p>Continuaremos la verificación de tu solicitud <strong>' . htmlspecialchars($code, ENT_QUOTES, 'UTF-8') . '</strong>.</p>'
        . '<p>Usa el siguiente enlace seguro, válido por 7 días, para cargar los requisitos solicitados:</p>'
        . '<p><a href="' . htmlspecialchars($uploadUrl, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:13px 20px;background:#315ef4;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">Cargar documentos de forma segura</a></p>'
        . ($reason !== '' ? '<p><strong>Observación:</strong> ' . htmlspecialchars($reason, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>' : '')
        . '<p style="color:#64748b;font-size:13px;">No compartas este enlace. Higo nunca solicitará tus documentos por formularios distintos a higodriver.com.</p>';
    $subject = 'Carga segura de documentos Higo Driver - ' . $code;
    $emailSent = da_send_email((string) $application['email'], $subject, da_email_shell($subject, $bodyHtml));

    da_send(200, [
        'ok' => true,
        'application' => $updated,
        'email_sent' => $emailSent,
        'expires_at' => $expiresAt,
    ]);
}

if ($action === 'set_status') {
    $status = trim((string) ($input['status'] ?? ''));
    $reason = trim((string) ($input['reason'] ?? ''));
    $allowed = ['under_review','correction_requested','approved','waitlist','rejected'];
    if (!in_array($status, $allowed, true)) {
        da_send(422, ['ok' => false, 'error' => 'invalid_status']);
    }
    $rpcBody = json_encode([
        'p_application_code' => $code,
        'p_status' => $status,
        'p_reason' => $reason === '' ? null : $reason,
        'p_metadata' => ['source' => 'admin_panel'],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    [$rpcStatus, $rpcResponse] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/rpc/admin_set_driver_application_status',
        (string) $rpcBody,
        [
            'apikey: ' . $cfg['_supabase_anon'],
            'Authorization: Bearer ' . $callerJwt,
            'Content-Type: application/json',
            'Accept: application/json',
        ]
    );
    $updated = json_decode($rpcResponse, true);
    if ($rpcStatus < 200 || $rpcStatus >= 300 || !is_array($updated)) {
        da_send(422, ['ok' => false, 'error' => 'status_update_failed', 'detail' => substr($rpcResponse, 0, 250)]);
    }

    [$subject, $html] = da_application_email_for_status($application, $status, $reason);
    $emailSent = $subject === '' ? false : da_send_email((string) $application['email'], $subject, $html);
    da_send(200, ['ok' => true, 'application' => $updated, 'email_sent' => $emailSent]);
}

da_send(422, ['ok' => false, 'error' => 'invalid_action']);
