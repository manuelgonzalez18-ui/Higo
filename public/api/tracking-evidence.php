<?php
declare(strict_types=1);
require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_ride_quote.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
try {
    $cfg = bl_load_config();
    api_apply_cors($cfg, 'GET, OPTIONS');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') { header('Allow: GET, OPTIONS'); http_response_code(405); exit; }
    api_rate_limit('tracking-evidence', 30);
    $token = is_string($_GET['token'] ?? null) ? $_GET['token'] : '';
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $token)) { http_response_code(404); echo '{"error":"tracking_unavailable"}'; exit; }
    $base = higo_backend_origin($cfg, 'SUPABASE_PROJECT_URL');
    $serviceKey = higo_private_key($cfg, 'SUPABASE_SERVICE_ROLE_KEY');
    $headers = ['apikey: ' . $serviceKey, 'Authorization: Bearer ' . $serviceKey, 'Content-Type: application/json'];
    [$status, $body] = bl_http_post($base . '/rest/v1/rpc/get_public_tracking', json_encode(['p_token' => $token]), $headers, 8);
    $tracking = json_decode($body, true);
    if ($status !== 200 || !is_array($tracking)) throw new RuntimeException('tracking_provider_unavailable');
    $row = is_array($tracking) ? ($tracking[0] ?? null) : null;
    if (!is_array($row) || ($row['status'] ?? '') !== 'completed' || empty($row['delivery_pod_url'])) { http_response_code(404); echo '{"error":"tracking_unavailable"}'; exit; }
    // The RPC enforces expiry, revocation and the 24h completion limit on EVERY
    // image request. No reusable Storage signed URL escapes this endpoint.
    $path = (string) $row['delivery_pod_url'];
    if (strpos($path, '..') !== false || !preg_match('#^[0-9]+/delivery(?:/[0-9a-f-]{36})?\.(jpg|png|webp)$#iD', $path)) throw new RuntimeException('invalid_evidence');
    if (($_GET['content'] ?? '') !== '1') {
        $publicBase = higo_backend_origin($cfg, 'HIGO_PUBLIC_API_BASE_URL');
        echo json_encode(['url' => $publicBase . '/api/tracking-evidence.php?token=' . rawurlencode($token) . '&content=1']);
        exit;
    }
    [$status, $body] = bl_http_get($base . '/storage/v1/object/authenticated/delivery-pods/' . implode('/', array_map('rawurlencode', explode('/', $path))), $headers, 8);
    if ($status !== 200 || strlen($body) > 10 * 1024 * 1024 || $body === '') throw new RuntimeException('evidence_unavailable');
    $image = @getimagesizefromstring($body);
    if (!is_array($image) || !in_array($image['mime'] ?? '', ['image/jpeg', 'image/png', 'image/webp'], true)) throw new RuntimeException('invalid_evidence_content');
    header('Content-Type: ' . $image['mime']);
    header('Content-Disposition: inline; filename="delivery-evidence.' . pathinfo($path, PATHINFO_EXTENSION) . '"');
    header('Content-Security-Policy: default-src \'none\'');
    header('Content-Length: ' . strlen($body));
    echo $body;
} catch (Throwable $error) {
    http_response_code(503); echo '{"error":"tracking_unavailable"}';
}
