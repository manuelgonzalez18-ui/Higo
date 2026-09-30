<?php
declare(strict_types=1);
require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_ride_quote.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    $cfg = bl_load_config();
    api_apply_cors($cfg);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { header('Allow: POST, OPTIONS'); http_response_code(405); echo '{"error":"method_not_allowed"}'; exit; }
    api_rate_limit('ride-quote', 30);
    $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (!preg_match('/^Bearer\s+([^\s\x00-\x1f]+)$/iD', $header, $matches)) { http_response_code(401); echo '{"error":"authentication_required"}'; exit; }
    [$status, $body] = bl_http_get(higo_backend_origin($cfg, 'SUPABASE_PROJECT_URL') . '/auth/v1/user', [
        'apikey: ' . higo_private_key($cfg, 'SUPABASE_ANON_KEY'), 'Authorization: Bearer ' . $matches[1],
    ], 5);
    $user = json_decode($body, true);
    if ($status !== 200 || !is_array($user) || !is_string($user['id'] ?? null) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $user['id'])) { http_response_code(401); echo '{"error":"invalid_session"}'; exit; }
    api_rate_limit('ride-quote-user', 10, null, $user['id']);
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if (strlen($raw ?: '') > 16384) throw new InvalidArgumentException('request_too_large');
    $input = json_decode($raw ?: '', true);
    if (!is_array($input) || !str_starts_with(ltrim($raw ?: ''), '{')) throw new InvalidArgumentException('invalid_json');
    $shape = json_decode($raw ?: '');
    if (property_exists($shape, 'stops') && !is_array($shape->stops)) throw new InvalidArgumentException('invalid_stops');
    $post = static function (string $url, array $data, array $headers): array {
        $timeout = str_starts_with($url, 'https://routes.googleapis.com/') ? 12 : 8;
        [$status, $body] = bl_http_post($url, json_encode($data), array_merge(['Content-Type: application/json'], $headers), $timeout);
        return [$status, json_decode($body, true)];
    };
    echo json_encode(higo_route_quote($input, $user['id'], $cfg, $post));
} catch (InvalidArgumentException $error) {
    http_response_code(422); echo json_encode(['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('[ride-quote] ' . get_class($error));
    http_response_code(503); echo '{"error":"quote_unavailable","message":"No se pudo calcular la ruta. Reintenta en unos minutos."}';
}
