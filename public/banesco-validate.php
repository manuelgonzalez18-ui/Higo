<?php
declare(strict_types=1);

/**
 * banesco-validate.php — endpoint server-to-server para validar
 * automáticamente un pago móvil contra Banesco.
 *
 * Flujo:
 *   1. Recibe POST JSON desde el SPA con Authorization: Bearer <Supabase JWT>.
 *   2. Verifica firma del JWT con SUPABASE_JWT_SECRET (HS256). Extrae sub.
 *   3. Lee el ride desde Supabase REST con service_role (no exponer al cliente).
 *      Confirma user_id == jwt.sub, status == 'completed', no validado aún.
 *   4. Calcula el monto esperado en Bs: ride.price (USD) * BCV.
 *   5. Auth contra Banesco SSO. Query a /financial-account/transactions.
 *   6. Busca un trnType='CR' con amount dentro de tolerancia. Si match,
 *      llama a la RPC confirm_ride_payment_banesco vía REST.
 *   7. Si no match, llama a log_banesco_validation_failure y devuelve 422.
 *
 * NUNCA expone el token Banesco ni el service_role al cliente. Sólo
 * regresa { ok, outcome, message, ride_id }.
 *
 * Config en /home/<user>/private/higo-banesco.php (mismo archivo que
 * banesco-lookup.php). Variables nuevas requeridas para validate:
 *   - SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY
 *   - BCV_API_URL (default https://ve.dolarapi.com/v1/dolares/oficial)
 *   - AMOUNT_TOLERANCE_PCT (default 2.0)
 *   - BCV_TTL_SECONDS (default 1800)
 */

// ═══ Setup ════════════════════════════════════════════════════════════

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
// El SPA vive en el mismo origin (higoapp.com) → no hace falta CORS.
// Si algún día se separa, agregar Access-Control-Allow-Origin acá.

function bv_json(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function bv_find_config_path(): ?string {
    $env = getenv('HIGO_BANESCO_CONFIG');
    if ($env !== false && $env !== '' && is_file($env)) return $env;
    $candidate = dirname(__DIR__) . '/private/higo-banesco.php';
    if (is_file($candidate)) return $candidate;
    return null;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    bv_json(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$configPath = bv_find_config_path();
if ($configPath === null) {
    bv_json(503, ['ok' => false, 'error' => 'config_missing']);
}
$cfg = require $configPath;
if (!is_array($cfg)) {
    bv_json(503, ['ok' => false, 'error' => 'config_invalid']);
}

$required = ['SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY',
             'BANESCO_SSO_URL', 'BANESCO_TX_URL',
             'BANESCO_CLIENT_ID', 'BANESCO_CLIENT_SECRET', 'BANESCO_ACCOUNT_ID'];
foreach ($required as $k) {
    if (empty($cfg[$k])) {
        bv_json(503, ['ok' => false, 'error' => 'config_incomplete', 'missing' => $k]);
    }
}

$logPath = $cfg['DIAG_LOG_PATH'] ?? (dirname($configPath) . '/higo-banesco-diag.log');
function bv_log(string $path, string $msg): void {
    @file_put_contents($path, '[' . gmdate('Y-m-d H:i:s') . '] ' . $msg . "\n", FILE_APPEND);
}

// ═══ JWT verify (HS256) ═══════════════════════════════════════════════

function bv_b64url_decode(string $s): string {
    $r = strtr($s, '-_', '+/');
    $pad = strlen($r) % 4;
    if ($pad) $r .= str_repeat('=', 4 - $pad);
    $out = base64_decode($r, true);
    return $out === false ? '' : $out;
}

/**
 * @return array{sub:string, exp:int, role:string}
 * @throws RuntimeException si la firma o el exp fallan.
 */
function bv_verify_jwt(string $jwt, string $secret): array {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) throw new RuntimeException('jwt_malformed');
    [$h, $p, $s] = $parts;

    $headerJson = bv_b64url_decode($h);
    $header = json_decode($headerJson, true);
    if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256') {
        throw new RuntimeException('jwt_alg_unsupported');
    }
    $expected = hash_hmac('sha256', $h . '.' . $p, $secret, true);
    $actual   = bv_b64url_decode($s);
    if (!hash_equals($expected, $actual)) {
        throw new RuntimeException('jwt_bad_signature');
    }
    $payload = json_decode(bv_b64url_decode($p), true);
    if (!is_array($payload)) throw new RuntimeException('jwt_bad_payload');

    $now = time();
    if (!empty($payload['exp']) && (int) $payload['exp'] < $now) {
        throw new RuntimeException('jwt_expired');
    }
    if (!empty($payload['nbf']) && (int) $payload['nbf'] > $now + 5) {
        throw new RuntimeException('jwt_not_yet_valid');
    }
    if (empty($payload['sub'])) throw new RuntimeException('jwt_no_sub');

    return [
        'sub'  => (string) $payload['sub'],
        'exp'  => (int)    ($payload['exp'] ?? 0),
        'role' => (string) ($payload['role'] ?? 'authenticated'),
    ];
}

$authHeader = $_SERVER['HTTP_AUTHORIZATION']
    ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/^Bearer\s+(.+)$/i', (string) $authHeader, $m)) {
    bv_json(401, ['ok' => false, 'error' => 'auth_required']);
}
try {
    $jwt = bv_verify_jwt($m[1], (string) $cfg['SUPABASE_JWT_SECRET']);
} catch (Throwable $e) {
    bv_log($logPath, "JWT reject: " . $e->getMessage());
    bv_json(401, ['ok' => false, 'error' => 'auth_invalid']);
}
$userId = $jwt['sub'];

// ═══ Payload ══════════════════════════════════════════════════════════

$raw = file_get_contents('php://input') ?: '';
$in  = json_decode($raw, true);
if (!is_array($in)) bv_json(400, ['ok' => false, 'error' => 'bad_json']);

$rideId    = trim((string) ($in['ride_id']   ?? ''));
$reference = trim((string) ($in['reference'] ?? ''));
$phone     = trim((string) ($in['phone']     ?? ''));
$bank      = trim((string) ($in['bank_id']   ?? '0102'));
$date      = trim((string) ($in['date']      ?? gmdate('Y-m-d')));

if ($rideId === '' || !preg_match('/^[0-9a-f-]{36}$/i', $rideId)) {
    bv_json(400, ['ok' => false, 'error' => 'bad_ride_id']);
}
if ($reference === '' || !preg_match('/^\d{4,20}$/', $reference)) {
    bv_json(400, ['ok' => false, 'error' => 'bad_reference']);
}
if (!preg_match('/^\d{4}$/', $bank)) {
    bv_json(400, ['ok' => false, 'error' => 'bad_bank_id']);
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    bv_json(400, ['ok' => false, 'error' => 'bad_date']);
}

function bv_normalize_phone(string $raw): ?string {
    $d = preg_replace('/\D+/', '', $raw) ?? '';
    if ($d === '') return null;
    if (strlen($d) === 10 && str_starts_with($d, '4'))  return '58' . $d;
    if (strlen($d) === 11 && str_starts_with($d, '0'))  return '58' . substr($d, 1);
    if (strlen($d) === 12 && str_starts_with($d, '58')) return $d;
    return null;
}
$phoneNorm = $phone === '' ? null : bv_normalize_phone($phone);
if ($phone !== '' && $phoneNorm === null) {
    bv_json(400, ['ok' => false, 'error' => 'bad_phone']);
}
if ($phoneNorm === null && $bank !== '0134') {
    // Banesco rechaza con 70001 si falta phone en interbank.
    bv_json(400, ['ok' => false, 'error' => 'phone_required_interbank']);
}

// ═══ HTTP helpers ═════════════════════════════════════════════════════

/**
 * @return array{0:int,1:string}
 */
function bv_http(string $url, string $method, ?string $body, array $headers, int $timeout = 30): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp   = curl_exec($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException('curl: ' . $err);
    return [$status, (string) $resp];
}

function bv_supabase_headers(array $cfg, string $contentType = 'application/json'): array {
    $key = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
    return [
        'apikey: ' . $key,
        'Authorization: Bearer ' . $key,
        'Content-Type: '  . $contentType,
        'Accept: application/json',
    ];
}

// ═══ Supabase: ride lookup + RPCs ═════════════════════════════════════

$baseUrl = rtrim((string) $cfg['SUPABASE_URL'], '/');

function bv_get_ride(array $cfg, string $baseUrl, string $rideId): ?array {
    $url = $baseUrl . '/rest/v1/rides?id=eq.' . urlencode($rideId)
         . '&select=id,user_id,status,price,payment_validated_at,payment_confirmed_by_driver,payment_confirmed_at';
    [$st, $body] = bv_http($url, 'GET', null, array_merge(bv_supabase_headers($cfg), [
        'Prefer: count=none',
    ]));
    if ($st !== 200) return null;
    $rows = json_decode($body, true);
    if (!is_array($rows) || empty($rows[0])) return null;
    return $rows[0];
}

function bv_call_rpc(array $cfg, string $baseUrl, string $fn, array $args) {
    $url = $baseUrl . '/rest/v1/rpc/' . rawurlencode($fn);
    $body = (string) json_encode($args, JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    [$st, $resp] = bv_http($url, 'POST', $body, bv_supabase_headers($cfg));
    if ($st < 200 || $st >= 300) {
        throw new RuntimeException("rpc {$fn} failed: HTTP {$st} " . substr($resp, 0, 300));
    }
    return json_decode($resp, true);
}

$ride = bv_get_ride($cfg, $baseUrl, $rideId);
if ($ride === null) bv_json(404, ['ok' => false, 'error' => 'ride_not_found']);
if (($ride['user_id'] ?? null) !== $userId) {
    bv_json(403, ['ok' => false, 'error' => 'ride_not_yours']);
}
if (($ride['status'] ?? null) !== 'completed') {
    bv_json(409, ['ok' => false, 'error' => 'ride_not_completed']);
}
if (!empty($ride['payment_validated_at'])) {
    bv_json(200, ['ok' => true, 'outcome' => 'already_validated', 'ride_id' => $rideId]);
}

$priceUsd = (float) ($ride['price'] ?? 0);
if ($priceUsd <= 0) bv_json(409, ['ok' => false, 'error' => 'ride_no_price']);

// Rate-limit: máx 5 intentos en 10 min para este (user, ride).
try {
    $recent = (int) bv_call_rpc($cfg, $baseUrl, 'count_recent_validation_attempts', [
        'p_ride_id'    => $rideId,
        'p_user_id'    => $userId,
        'p_window_min' => 10,
    ]);
    if ($recent >= 5) {
        bv_json(429, ['ok' => false, 'error' => 'too_many_attempts']);
    }
} catch (Throwable $e) {
    // No-blocking: si falla el contador, dejamos pasar pero logueamos.
    bv_log($logPath, 'rate_limit lookup failed: ' . $e->getMessage());
}

// ═══ BCV rate (con cache simple en disco) ═════════════════════════════

$bcvUrl  = (string) ($cfg['BCV_API_URL'] ?? 'https://ve.dolarapi.com/v1/dolares/oficial');
$bcvTtl  = (int)    ($cfg['BCV_TTL_SECONDS'] ?? 1800);
$tolPct  = (float)  ($cfg['AMOUNT_TOLERANCE_PCT'] ?? 2.0);
$cacheFile = sys_get_temp_dir() . '/higo_bcv_rate.json';

function bv_fetch_bcv(string $url, string $cacheFile, int $ttl): ?float {
    if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
        $cached = json_decode((string) @file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['rate'])) return (float) $cached['rate'];
    }
    try {
        [$st, $body] = bv_http($url, 'GET', null, ['Accept: application/json'], 8);
    } catch (Throwable $e) {
        return null;
    }
    if ($st !== 200) return null;
    $data = json_decode($body, true);
    // dolarapi.com devuelve {promedio: 36.5, ...}. Aceptamos varias formas.
    $rate = null;
    if (is_array($data)) {
        foreach (['promedio','rate','price','venta','value'] as $k) {
            if (isset($data[$k]) && is_numeric($data[$k])) { $rate = (float) $data[$k]; break; }
        }
    }
    if ($rate === null || $rate <= 0) return null;
    @file_put_contents($cacheFile, json_encode(['rate' => $rate, 'at' => time()]));
    return $rate;
}

$bcv = bv_fetch_bcv($bcvUrl, $cacheFile, $bcvTtl);
if ($bcv === null) {
    bv_json(503, ['ok' => false, 'error' => 'bcv_unavailable']);
}
$expectedBs = round($priceUsd * $bcv, 2);

// ═══ Banesco SSO + query ══════════════════════════════════════════════

function bv_banesco_auth(array $cfg): string {
    $body = http_build_query([
        'grant_type' => 'password',
        'username'   => (string) $cfg['BANESCO_CLIENT_ID'],
        'password'   => (string) $cfg['BANESCO_CLIENT_SECRET'],
    ]);
    $basic = 'Basic ' . base64_encode(
        $cfg['BANESCO_CLIENT_ID'] . ':' . $cfg['BANESCO_CLIENT_SECRET']
    );
    $ch = curl_init((string) $cfg['BANESCO_SSO_URL']);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
            'Authorization: ' . $basic,
        ],
    ]);
    $resp   = curl_exec($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException('sso_curl: ' . $err);
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("sso_http_{$status}");
    }
    $data = json_decode((string) $resp, true);
    if (!is_array($data) || empty($data['access_token'])) {
        throw new RuntimeException('sso_no_token');
    }
    return (string) $data['access_token'];
}

/**
 * @return array{0:array,1:int,2:string}  payload enviado, http code, body crudo
 */
function bv_banesco_query(array $cfg, array $tx, string $token): array {
    $payload = [
        'dataRequest' => [
            'device' => [
                'description' => 'Higo Auto Validate',
                'ipAddress'   => $_SERVER['SERVER_ADDR'] ?? '127.0.0.1',
                'type'        => 'Web',
            ],
            'transaction' => $tx,
        ],
    ];
    $body = (string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    $ch = curl_init((string) $cfg['BANESCO_TX_URL']);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $token,
        ],
    ]);
    $resp   = curl_exec($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException('tx_curl: ' . $err);
    return [$payload, $status, (string) $resp];
}

$tx = [
    'referenceNumber' => $reference,
    'accountId'       => (string) $cfg['BANESCO_ACCOUNT_ID'],
    'amount'          => $expectedBs,
    'startDt'         => $date,
    'phoneNum'        => $phoneNorm,
    'bankId'          => $bank,
];

try {
    $token = bv_banesco_auth($cfg);
    [$sent, $httpCode, $rawResp] = bv_banesco_query($cfg, $tx, $token);
} catch (Throwable $e) {
    bv_log($logPath, 'banesco_error: ' . $e->getMessage());
    try {
        bv_call_rpc($cfg, $baseUrl, 'log_banesco_validation_failure', [
            'p_ride_id'        => $rideId,
            'p_user_id'        => $userId,
            'p_reference'      => $reference,
            'p_phone'          => $phoneNorm,
            'p_bank_id'        => $bank,
            'p_expected_bs'    => $expectedBs,
            'p_bcv_rate'       => $bcv,
            'p_banesco_status' => null,
            'p_outcome'        => 'banesco_error',
            'p_request'        => $tx,
            'p_response'       => null,
            'p_error_message'  => $e->getMessage(),
        ]);
    } catch (Throwable $_) { /* swallow */ }
    bv_json(502, ['ok' => false, 'error' => 'banesco_unavailable']);
}

bv_log($logPath, "validate ride={$rideId} ref={$reference} http={$httpCode}");

$parsed = json_decode($rawResp, true);
$banescoStatus = is_array($parsed) ? (string) ($parsed['httpStatus']['statusCode'] ?? '') : '';
$details = is_array($parsed) ? ($parsed['dataResponse']['transactionDetail'] ?? []) : [];
if (!is_array($details)) $details = [];

// Buscar el primer crédito que matchee la tolerancia.
$match = null;
$matchDiffPct = null;
foreach ($details as $t) {
    if (!is_array($t)) continue;
    if (($t['trnType'] ?? '') !== 'CR') continue;
    $amt = isset($t['amount']) && is_numeric($t['amount']) ? (float) $t['amount'] : null;
    if ($amt === null || $expectedBs <= 0) continue;
    $pct = abs(($amt - $expectedBs) / $expectedBs) * 100.0;
    if ($pct <= $tolPct) {
        $match = $t;
        $matchDiffPct = $pct;
        break;
    }
}

// Sanitizar la respuesta antes de loguearla — descartar headers internos de Banesco.
$responseForLog = is_array($parsed) ? $parsed : ['raw' => substr($rawResp, 0, 4000)];

if ($match !== null) {
    try {
        $updated = bv_call_rpc($cfg, $baseUrl, 'confirm_ride_payment_banesco', [
            'p_ride_id'        => $rideId,
            'p_user_id'        => $userId,
            'p_reference'      => $reference,
            'p_phone'          => $phoneNorm,
            'p_bank_id'        => $bank,
            'p_expected_bs'    => $expectedBs,
            'p_bcv_rate'       => $bcv,
            'p_matched_amount' => (float) $match['amount'],
            'p_diff_pct'       => $matchDiffPct,
            'p_banesco_status' => $banescoStatus,
            'p_request'        => $tx,
            'p_response'       => $match,
        ]);
    } catch (Throwable $e) {
        bv_log($logPath, 'rpc_confirm_failed: ' . $e->getMessage());
        bv_json(500, ['ok' => false, 'error' => 'rpc_failed']);
    }
    bv_json(200, [
        'ok'             => true,
        'outcome'        => 'matched',
        'ride_id'        => $rideId,
        'expected_bs'    => $expectedBs,
        'matched_amount' => (float) $match['amount'],
        'diff_pct'       => $matchDiffPct,
        'bcv_rate'       => $bcv,
    ]);
}

// No match: clasificar y loguear.
$creditAmounts = [];
foreach ($details as $t) {
    if (is_array($t) && ($t['trnType'] ?? '') === 'CR' && isset($t['amount'])) {
        $creditAmounts[] = (float) $t['amount'];
    }
}
$outcome = empty($creditAmounts)
    ? ($banescoStatus === '200' ? 'no_credit' : ($banescoStatus === '70001' ? 'no_credit' : 'banesco_error'))
    : 'amount_mismatch';

try {
    bv_call_rpc($cfg, $baseUrl, 'log_banesco_validation_failure', [
        'p_ride_id'        => $rideId,
        'p_user_id'        => $userId,
        'p_reference'      => $reference,
        'p_phone'          => $phoneNorm,
        'p_bank_id'        => $bank,
        'p_expected_bs'    => $expectedBs,
        'p_bcv_rate'       => $bcv,
        'p_banesco_status' => $banescoStatus,
        'p_outcome'        => $outcome,
        'p_request'        => $tx,
        'p_response'       => $responseForLog,
        'p_error_message'  => null,
    ]);
} catch (Throwable $e) {
    bv_log($logPath, 'rpc_log_fail: ' . $e->getMessage());
}

bv_json(422, [
    'ok'             => false,
    'outcome'        => $outcome,
    'banesco_status' => $banescoStatus,
    'expected_bs'    => $expectedBs,
    'bcv_rate'       => $bcv,
    'credits_found'  => count($creditAmounts),
]);
