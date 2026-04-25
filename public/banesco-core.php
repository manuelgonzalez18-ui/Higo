<?php
declare(strict_types=1);

/**
 * banesco-core.php — Funciones compartidas para hablar con la API
 * de Confirmación de Transacciones de Banesco.
 *
 * Lo consumen:
 *   - banesco-lookup.php       (UI diagnóstico, HTTP Basic Auth)
 *   - api/banesco-validate.php (endpoint JSON para el SPA, JWT Supabase)
 *
 * Las funciones conservan el prefijo bl_ por compatibilidad con
 * el código original de banesco-lookup.php.
 */

if (defined('HIGO_BANESCO_CORE_LOADED')) return;
define('HIGO_BANESCO_CORE_LOADED', true);

// ═══ Config ══════════════════════════════════════════════════════════

function bl_find_config_path(): ?string {
    $env = getenv('HIGO_BANESCO_CONFIG');
    if ($env !== false && $env !== '' && is_file($env)) return $env;
    $candidate = dirname(__DIR__) . '/private/higo-banesco.php';
    if (is_file($candidate)) return $candidate;
    return null;
}

/**
 * Carga el config privado o lanza RuntimeException.
 */
function bl_load_config(): array {
    $path = bl_find_config_path();
    if ($path === null) {
        throw new RuntimeException(
            'Config no encontrado. Debe existir /home/<user>/private/higo-banesco.php'
        );
    }
    $cfg = require $path;
    if (!is_array($cfg)) {
        throw new RuntimeException('Config inválido: el require no retornó array.');
    }
    return $cfg;
}

// ═══ Logging ═════════════════════════════════════════════════════════

function bl_log(string $path, string $msg): void {
    @file_put_contents(
        $path,
        '[' . gmdate('Y-m-d H:i:s') . '] ' . $msg . "\n",
        FILE_APPEND
    );
}

function bl_log_request(string $path, array $payload): void {
    $json = (string) json_encode(
        $payload,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
    );
    bl_log($path, "=== REQUEST SENT ===\n" . $json . "\n----------------------------------------");
}

function bl_log_response(string $path, int $httpCode, $body): void {
    $dump = [
        'httpCode' => $httpCode,
        'body'     => is_string($body) ? (json_decode($body, true) ?? $body) : $body,
    ];
    $json = (string) json_encode(
        $dump,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
    );
    bl_log($path, "=== RESPONSE RECEIVED ===\n" . $json . "\n----------------------------------------");
}

// ═══ Helpers ═════════════════════════════════════════════════════════

/**
 * Normaliza un teléfono venezolano al formato 58XXXXXXXXXX.
 *  - Devuelve null si la entrada está vacía o explícitamente "none"/"null".
 *  - Devuelve false si el formato no se reconoce.
 *  - Devuelve string normalizada en caso exitoso.
 *
 * @return string|null|false
 */
function bl_normalize_phone(string $raw) {
    $t = strtolower(trim($raw));
    if ($t === '' || $t === 'none' || $t === 'null') return null;
    $d = preg_replace('/\D+/', '', $raw) ?? '';
    if (strlen($d) === 10 && str_starts_with($d, '4'))  return '58' . $d;
    if (strlen($d) === 11 && str_starts_with($d, '0'))  return '58' . substr($d, 1);
    if (strlen($d) === 12 && str_starts_with($d, '58')) return $d;
    return false;
}

/**
 * @return array{0:int,1:string} [http status, body]
 */
function bl_http_post(string $url, string $body, array $headers, int $timeout = 30): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false, // cert interno Banesco
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $resp   = curl_exec($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException("cURL: {$err}");
    }
    return [$status, (string) $resp];
}

/**
 * @return array{0:int,1:string}
 */
function bl_http_get(string $url, array $headers, int $timeout = 15): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $resp   = curl_exec($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException("cURL: {$err}");
    }
    return [$status, (string) $resp];
}

// ═══ Banesco ═════════════════════════════════════════════════════════

/**
 * Devuelve access_token de Banesco vía SSO password grant.
 */
function bl_banesco_auth(array $cfg): string {
    $body = http_build_query([
        'grant_type' => 'password',
        'username'   => (string) $cfg['BANESCO_CLIENT_ID'],
        'password'   => (string) $cfg['BANESCO_CLIENT_SECRET'],
    ]);
    $basic = 'Basic ' . base64_encode(
        $cfg['BANESCO_CLIENT_ID'] . ':' . $cfg['BANESCO_CLIENT_SECRET']
    );
    [$status, $resp] = bl_http_post(
        (string) $cfg['BANESCO_SSO_URL'],
        $body,
        [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
            'Authorization: ' . $basic,
        ]
    );
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("SSO HTTP {$status}: " . substr($resp, 0, 300));
    }
    $data = json_decode($resp, true);
    if (!is_array($data) || empty($data['access_token'])) {
        throw new RuntimeException('SSO sin access_token en respuesta.');
    }
    return (string) $data['access_token'];
}

/**
 * Consulta una transacción en Banesco.
 *
 * @return array{0:array,1:int,2:string} [payload enviado, http code, body crudo]
 */
function bl_banesco_query(array $cfg, array $tx, string $token): array {
    $payload = [
        'dataRequest' => [
            'device' => [
                'description' => 'Higo Lookup Portal',
                'ipAddress'   => $_SERVER['SERVER_ADDR'] ?? '127.0.0.1',
                'type'        => 'Web',
            ],
            'transaction' => $tx,
        ],
    ];
    $body = (string) json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
    );
    [$status, $resp] = bl_http_post(
        (string) $cfg['BANESCO_TX_URL'],
        $body,
        [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $token,
        ]
    );
    return [$payload, $status, $resp];
}
