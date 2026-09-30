<?php
declare(strict_types=1);
// Test-only PHP built-in-server router. Production contains no mock switches.
if (PHP_SAPI !== 'cli-server' || !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) { http_response_code(403); exit; }
$case = (string) ($_SERVER['HTTP_X_TEST_CASE'] ?? 'success');
$requestId = (string) ($_SERVER['HTTP_X_TEST_ID'] ?? 'default');
$_SERVER['REMOTE_ADDR'] = '192.0.2.' . (1 + hexdec(substr(hash('sha256', $requestId), 0, 2)) % 250);
function fixture_identity(): string {
    $identity = $_SERVER['HTTP_X_TEST_USER'] ?? $GLOBALS['requestId'];
    return substr(hash('sha256', $identity), 0, 8) . '-0000-4000-8000-000000000001';
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
        return [200, json_encode(['id' => fixture_identity()])];
    }
    if (str_starts_with($url, 'https://synthetic.supabase.test/rest/v1/payment_reports?')) {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $state = sys_get_temp_dir() . '/validated-' . hash('sha256', (string) ($query['reference_last6'] ?? ''));
        return [200, is_file($state) || $GLOBALS['case'] === 'payment-duplicate' ? '[{"id":42}]' : '[]'];
    }
    if (str_starts_with($url, 'https://synthetic.supabase.test/rest/v1/profiles?') && str_contains($url, 'select=vehicle_model')) return [200, '[{"vehicle_model":"standard"}]'];
    if (str_starts_with($url, 'https://synthetic.supabase.test/rest/v1/membership_plans?')) return [200, '[{"amount_usd":10,"amount_bs":1000}]'];
    if ($url === 'https://ve.dolarapi.com/v1/dolares/oficial') return [200, '{"promedio":100}'];
    if (str_starts_with($url, 'https://synthetic.supabase.test/rest/v1/rides?')) {
        if ($GLOBALS['case'] === 'push-missing-ride') return [200, '[]'];
        return [200, json_encode([['id' => 42, 'driver_id' => $GLOBALS['case'] === 'push-wrong-driver' ? 'someone-else' : fixture_identity(), 'user_id' => 'synthetic-passenger', 'status' => $GLOBALS['case'] === 'push-wrong-state' ? 'requested' : 'completed', 'service_type' => 'ride']])];
    }
    if (str_starts_with($url, 'https://synthetic.supabase.test/rest/v1/profiles?') && str_contains($url, 'fcm_token=not.is.null')) {
        return [200, $GLOBALS['case'] === 'push-no-token' ? '[]' : '[{"id":"synthetic-passenger","fcm_token":"synthetic-device"}]'];
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
    if (!$verifyTls && !str_starts_with($url, 'https://bank.synthetic.invalid/')) throw new RuntimeException('tls_disabled');
    if ($url === 'https://bank.synthetic.invalid/token') {
        if ($GLOBALS['case'] === 'bank-failure') return [503, '{}'];
        return [200, '{"access_token":"synthetic-bank-token"}'];
    }
    if ($url === 'https://bank.synthetic.invalid/transactions') {
        if ($GLOBALS['case'] === 'bank-timeout') throw new RuntimeException('simulated_timeout');
        if ($GLOBALS['case'] === 'bank-malformed') return [200, 'not-json'];
        $amount = $GLOBALS['case'] === 'payment-insufficient' ? 1 : 1000;
        return [200, json_encode(['httpStatus' => ['statusCode' => '200'], 'dataResponse' => ['transactionDetail' => $GLOBALS['case'] === 'payment-not-found' ? [] : [['trnType' => 'CR', 'amount' => $amount, 'trnDate' => '2026-09-30']]]])];
    }
    if ($url === 'https://synthetic.supabase.test/rest/v1/rpc/register_membership_payment') {
        if (!in_array('Authorization: Bearer synthetic-service', $headers, true)) throw new RuntimeException('wrong_service_key');
        if ($GLOBALS['case'] === 'activation-failure') return [503, '{}'];
        if ($GLOBALS['case'] === 'payment-race') return [409, '{"message":"duplicate key"}'];
        $state = sys_get_temp_dir() . '/validated-' . hash('sha256', 'eq.' . (string) $data['p_reference_last6']);
        file_put_contents($state, 'validated', LOCK_EX);
        return [200, '{"membership_id":"synthetic-membership","report_id":42,"expires_at":"2026-10-30T00:00:00Z"}'];
    }
    if ($url === 'https://oauth2.googleapis.com/token') return [200, '{"access_token":"synthetic-fcm-token","expires_in":3600}'];
    if ($url === 'https://fcm.googleapis.com/v1/projects/synthetic-firebase/messages:send') {
        if (($data['message']['token'] ?? '') !== 'synthetic-device') throw new RuntimeException('unexpected_recipient');
        if ($GLOBALS['case'] === 'push-provider-failure') return [503, '{"error":"simulated_unavailable"}'];
        if ($GLOBALS['case'] === 'push-unregistered') return [404, '{"error":"UNREGISTERED"}'];
        return [200, '{"name":"synthetic-message"}'];
    }
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
function bl_http_patch(string $url, string $body, array $headers, int $timeout = 30, bool $verifyTls = true): array {
    fixture_log('PATCH', $url, json_decode($body, true) ?: []);
    if (!$verifyTls || $url !== 'https://synthetic.supabase.test/rest/v1/profiles?id=eq.synthetic-passenger' || json_decode($body, true) !== ['fcm_token' => null]) throw new RuntimeException('unexpected_test_patch');
    return [204, ''];
}
$path = parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/ready') { echo 'ready'; return; }
if (!in_array($path, ['/api/ride-quote.php', '/api/tracking-evidence.php', '/api/banesco-validate.php', '/api/send-ride-status-push.php'], true)) { http_response_code(404); return; }
require (string) getenv('HIGO_TEST_PUBLIC_PATH') . $path;
