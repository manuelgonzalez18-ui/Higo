<?php
declare(strict_types=1);

require_once __DIR__ . '/_driver_applications.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = da_config();
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('driver-application-status', 20, '/tmp/higo_driver_application_status.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    da_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
$input = stripos($contentType, 'application/json') !== false ? da_json_input() : $_POST;
$code = strtoupper(trim((string) ($input['application_id'] ?? $input['application_code'] ?? '')));
$email = strtolower(trim((string) ($input['email'] ?? '')));
if (!preg_match('/^HD-\d{8}-[A-F0-9]{8}$/', $code) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    da_send(404, ['ok' => false, 'error' => 'not_found']);
}

$payload = json_encode([
    'p_application_code' => $code,
    'p_email' => $email,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
[$status, $body] = bl_http_post(
    $cfg['_supabase_url'] . '/rest/v1/rpc/higo_public_driver_application_status',
    (string) $payload,
    [
        'apikey: ' . $cfg['_supabase_anon'],
        'Authorization: Bearer ' . $cfg['_supabase_anon'],
        'Content-Type: application/json',
        'Accept: application/json',
    ]
);
$data = json_decode($body, true);
if ($status < 200 || $status >= 300 || !is_array($data) || empty($data['application_id'])) {
    da_send(404, ['ok' => false, 'error' => 'not_found']);
}

da_send(200, ['ok' => true] + $data);
