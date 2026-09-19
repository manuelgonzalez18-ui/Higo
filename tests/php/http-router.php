<?php
declare(strict_types=1);
// Test-only PHP built-in-server router. Production contains no mock switches.
$case = (string) ($_SERVER['HTTP_X_TEST_CASE'] ?? 'success');
$requestId = (string) ($_SERVER['HTTP_X_TEST_ID'] ?? 'default');
$_SERVER['REMOTE_ADDR'] = '192.0.2.' . (1 + hexdec(substr(hash('sha256', $requestId), 0, 2)) % 250);
function bl_load_config(): array {
    return [
        'SUPABASE_PROJECT_URL' => 'https://synthetic.supabase.test',
        'SUPABASE_ANON_KEY' => 'synthetic-anon',
        'SUPABASE_SERVICE_ROLE_KEY' => 'synthetic-service',
        'GOOGLE_ROUTES_SERVER_KEY' => 'synthetic-google',
        'HIGO_PUBLIC_API_BASE_URL' => 'https://evidence.higo.test',
    ];
}
function fixture_log(string $method, string $url, array $data = []): void {
    $entry = ['case' => $GLOBALS['case'], 'id' => $GLOBALS['requestId'], 'method' => $method, 'url' => $url, 'data' => $data];
    file_put_contents((string) getenv('HIGO_TEST_HTTP_LOG'), json_encode($entry) . "\n", FILE_APPEND | LOCK_EX);
}
function bl_http_get(string $url, array $headers, int $timeout = 15, bool $verifyTls = true): array {
    fixture_log('GET', $url);
    if (!$verifyTls) throw new RuntimeException('tls_disabled');
    if ($url === 'https://synthetic.supabase.test/auth/v1/user') {
        if ($GLOBALS['case'] === 'invalid-session') return [401, '{"error":"expired"}'];
        $identity = $_SERVER['HTTP_X_TEST_USER'] ?? $GLOBALS['requestId'];
        $uuid = substr(hash('sha256', $identity), 0, 8) . '-0000-4000-8000-000000000001';
        return [200, json_encode(['id' => $uuid])];
    }
    if ($url === 'https://synthetic.supabase.test/storage/v1/object/authenticated/delivery-pods/42/delivery/00000000-0000-4000-8000-000000000042.png') {
        if ($GLOBALS['case'] === 'bad-image') return [200, '<svg onload="alert(1)"></svg>'];
        return [200, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNj8AAAAASUVORK5CYII=')];
    }
    throw new RuntimeException('unexpected_test_get:' . $url);
}
function bl_http_post(string $url, string $body, array $headers, int $timeout = 30, bool $verifyTls = true): array {
    $data = json_decode($body, true);
    fixture_log('POST', $url, is_array($data) ? $data : []);
    if (!$verifyTls) throw new RuntimeException('tls_disabled');
    if ($url === 'https://routes.googleapis.com/directions/v2:computeRoutes') {
        if ($GLOBALS['case'] === 'provider-failure') return [503, '{}'];
        if ($GLOBALS['case'] === 'provider-malformed') return [200, '{"routes":[{"distanceMeters":4500,"duration":"NaNs"}]}'];
        if ($GLOBALS['case'] === 'provider-empty') return [200, '{"routes":[]}'];
        return [200, '{"routes":[{"distanceMeters":4500,"duration":"780s"}]}'];
    }
    if ($url === 'https://synthetic.supabase.test/rest/v1/rpc/higo_store_route_quote') {
        if (!in_array('Authorization: Bearer synthetic-service', $headers, true)) throw new RuntimeException('wrong_service_key');
        if ($GLOBALS['case'] === 'store-failure') return [503, '{}'];
        return [200, '{"quoteId":"00000000-0000-4000-8000-000000000002","finalPrice":7.5,"expiresAt":"2026-09-17T01:05:00Z"}'];
    }
    if ($url === 'https://synthetic.supabase.test/rest/v1/rpc/get_public_tracking') {
        if ($GLOBALS['case'] === 'tracking-failure') return [503, '{}'];
        // These states reflect the real RPC contract: revoked/expired links yield no row.
        if (in_array($GLOBALS['case'], ['revoked', 'expired', 'completion-expired'], true)) return [200, '[]'];
        $path = $GLOBALS['case'] === 'unsafe-path' ? '../other-private-bucket/secret.png' : '42/delivery/00000000-0000-4000-8000-000000000042.png';
        return [200, json_encode([['status' => $GLOBALS['case'] === 'not-completed' ? 'in_progress' : 'completed', 'delivery_pod_url' => $path]])];
    }
    throw new RuntimeException('unexpected_test_post:' . $url);
}
$path = parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/ready') { echo 'ready'; return; }
if (!in_array($path, ['/api/ride-quote.php', '/api/tracking-evidence.php'], true)) { http_response_code(404); return; }
require (string) getenv('HIGO_TEST_PUBLIC_PATH') . $path;
