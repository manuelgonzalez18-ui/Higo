<?php
declare(strict_types=1);

/**
 * api/banesco-validate.php — Endpoint JSON consumido por el SPA Higo Pay.
 *
 * Recibe POST application/json con la referencia/teléfono/monto que el
 * conductor declaró, autentica al usuario contra Supabase (Bearer JWT),
 * consulta Banesco con las credenciales privadas del servidor, y devuelve
 * una respuesta normalizada apta para mostrar/persistir en el frontend.
 *
 * El frontend NUNCA ve credenciales de Banesco. La verificación del JWT
 * se hace contra GET <SUPABASE_URL>/auth/v1/user con el ANON_KEY como
 * apikey, que es la forma documentada y no requiere validar firma JWT
 * localmente (Supabase ya lo hace por nosotros).
 *
 * Respuesta JSON (HTTP 200 incluso para errores Banesco; sólo HTTP no-200
 * en errores de autenticación, validación de payload o internos):
 *   { ok: true,  statusCode, amountReal, amountRequested, diff, diffPct,
 *     withinTolerance, trnDate, raw }
 *   { ok: false, errorCode, errorMessage, statusCode, raw }
 */

require_once __DIR__ . '/../banesco-core.php';

// ═══ Helpers HTTP ═════════════════════════════════════════════════════

function bv_send_json(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo (string) json_encode(
        $body,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION
    );
    exit;
}

function bv_apply_cors(array $cfg): void {
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $allowed = (array) ($cfg['HIGOPAY_ALLOWED_ORIGINS'] ?? []);
    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Max-Age: 600');
    }
}

// ═══ Auth Supabase ════════════════════════════════════════════════════

/**
 * @return array{id:string,email:?string} datos del usuario autenticado
 */
function bv_authenticate(array $cfg): array {
    $hdr = (string) ($_SERVER['HTTP_AUTHORIZATION']
                  ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
                  ?? '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $hdr, $m)) {
        bv_send_json(401, ['ok' => false, 'errorCode' => 'NO_AUTH', 'errorMessage' => 'Falta Authorization Bearer.']);
    }
    $token = trim($m[1]);

    $supaUrl = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
    $anonKey = (string) ($cfg['SUPABASE_ANON_KEY'] ?? '');
    if ($supaUrl === '' || $anonKey === '') {
        bv_send_json(503, ['ok' => false, 'errorCode' => 'CONFIG', 'errorMessage' => 'Supabase no configurado en server.']);
    }

    try {
        [$status, $body] = bl_http_get(
            $supaUrl . '/auth/v1/user',
            [
                'apikey: ' . $anonKey,
                'Authorization: Bearer ' . $token,
                'Accept: application/json',
            ]
        );
    } catch (Throwable $e) {
        bv_send_json(502, ['ok' => false, 'errorCode' => 'AUTH_UPSTREAM', 'errorMessage' => 'Supabase no respondió.']);
    }
    if ($status !== 200) {
        bv_send_json(401, ['ok' => false, 'errorCode' => 'BAD_TOKEN', 'errorMessage' => 'Token Supabase inválido o expirado.']);
    }
    $u = json_decode($body, true);
    if (!is_array($u) || empty($u['id'])) {
        bv_send_json(401, ['ok' => false, 'errorCode' => 'BAD_TOKEN', 'errorMessage' => 'Respuesta Supabase sin user.id.']);
    }
    return ['id' => (string) $u['id'], 'email' => $u['email'] ?? null];
}

// ═══ Mapping respuestas Banesco ═══════════════════════════════════════

function bv_friendly_error(string $code): string {
    return match ($code) {
        '70001'  => 'Banesco no encontró esta transacción. Verificá referencia, fecha y banco.',
        'VRN04', 'CRT503' => 'Banesco está en mantenimiento (típico 02:00–06:00). Reintentá más tarde.',
        '400'    => 'Datos inválidos enviados a Banesco.',
        default  => str_starts_with($code, 'VDE')
                    ? 'Error de validación del payload (' . $code . ').'
                    : 'Banesco respondió con código ' . $code . '.',
    };
}

// ═══ Main ═════════════════════════════════════════════════════════════

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    bv_send_json(503, ['ok' => false, 'errorCode' => 'CONFIG', 'errorMessage' => $e->getMessage()]);
}

bv_apply_cors($cfg);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    bv_send_json(405, ['ok' => false, 'errorCode' => 'METHOD', 'errorMessage' => 'Use POST.']);
}

$user = bv_authenticate($cfg);

$raw = file_get_contents('php://input') ?: '';
$in  = json_decode($raw, true);
if (!is_array($in)) {
    bv_send_json(400, ['ok' => false, 'errorCode' => 'BAD_JSON', 'errorMessage' => 'Body no es JSON válido.']);
}

$reference = trim((string) ($in['reference'] ?? ''));
$amountRaw = $in['amount'] ?? null;
$phoneRaw  = trim((string) ($in['phone']     ?? ''));
$date      = trim((string) ($in['date']      ?? date('Y-m-d')));
$bank      = trim((string) ($in['bank']      ?? ''));

$errors = [];
if ($reference === '' || !preg_match('/^\d{1,20}$/', $reference)) {
    $errors[] = 'reference debe ser numérica (1–20 dígitos).';
}
if (!is_numeric($amountRaw) || (float) $amountRaw <= 0) {
    $errors[] = 'amount debe ser un número > 0.';
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    $errors[] = 'date debe ser YYYY-MM-DD.';
}
if (!preg_match('/^\d{4}$/', $bank)) {
    $errors[] = 'bank debe ser código de 4 dígitos (0102, 0134, etc.).';
}
$phoneNorm = bl_normalize_phone($phoneRaw);
if ($phoneNorm === false) {
    $errors[] = 'phone inválido. Formatos: 04XXXXXXXXX, 58XXXXXXXXXX, o vacío si bank=0134.';
}
if ($errors) {
    bv_send_json(422, ['ok' => false, 'errorCode' => 'VALIDATION', 'errorMessage' => implode(' ', $errors)]);
}

$amount = (float) $amountRaw;

$logPath = (string) ($cfg['DIAG_LOG_PATH']
    ?? (dirname((string) bl_find_config_path()) . '/higo-banesco-diag.log'));

try {
    $token = bl_banesco_auth($cfg);
    $tx = [
        'referenceNumber' => $reference,
        'accountId'       => (string) ($cfg['BANESCO_ACCOUNT_ID'] ?? ''),
        'amount'          => $amount,
        'startDt'         => $date,
        'phoneNum'        => $phoneNorm,
        'bankId'          => $bank,
    ];
    [$payload, $httpCode, $body] = bl_banesco_query($cfg, $tx, $token);
    bl_log($logPath, 'driver=' . $user['id'] . ' bank=' . $bank . ' ref=' . $reference);
    bl_log_request($logPath, $payload);
    bl_log_response($logPath, $httpCode, $body);
} catch (Throwable $e) {
    bl_log($logPath, '=== EXCEPTION === ' . $e->getMessage());
    bv_send_json(502, ['ok' => false, 'errorCode' => 'UPSTREAM', 'errorMessage' => 'Banesco no respondió: ' . $e->getMessage()]);
}

$parsed = json_decode($body, true);
if (!is_array($parsed)) {
    bv_send_json(502, ['ok' => false, 'errorCode' => 'BAD_RESPONSE', 'errorMessage' => 'Banesco devolvió payload no-JSON.', 'raw' => $body]);
}

$statusCode = (string) ($parsed['httpStatus']['statusCode'] ?? '');
$details = $parsed['dataResponse']['transactionDetail'] ?? [];
if (!is_array($details)) $details = [];
$credits = array_values(array_filter(
    $details,
    static fn($t) => is_array($t) && (($t['trnType'] ?? '') === 'CR')
));

if ($statusCode !== '200' || !$credits) {
    bv_send_json(200, [
        'ok'           => false,
        'errorCode'    => $statusCode !== '' ? $statusCode : 'NO_CREDIT',
        'errorMessage' => $statusCode !== '' ? bv_friendly_error($statusCode) : 'Banesco no reportó abono.',
        'statusCode'   => $statusCode,
        'raw'          => $parsed,
    ]);
}

// Tomamos el primer abono (típicamente único). Comparamos amount real vs declarado.
$first    = $credits[0];
$amountRl = isset($first['amount']) && is_numeric($first['amount']) ? (float) $first['amount'] : null;
$diff     = $amountRl !== null ? $amountRl - $amount : null;
$pct      = ($amountRl !== null && $amount > 0) ? ($diff / $amount) * 100.0 : null;
$within   = $pct !== null && abs($pct) <= 1.0;

bv_send_json(200, [
    'ok'              => true,
    'statusCode'      => $statusCode,
    'amountReal'      => $amountRl,
    'amountRequested' => $amount,
    'diff'            => $diff,
    'diffPct'         => $pct,
    'withinTolerance' => $within,
    'trnDate'         => (string) ($first['trnDate'] ?? $date),
    'trnTime'         => (string) ($first['trnTime'] ?? ''),
    'referenceNumber' => (string) ($first['referenceNumber'] ?? $reference),
    'sourceBankId'    => (string) ($first['sourceBankId'] ?? ''),
    'destBankId'      => (string) ($first['destBankId'] ?? ''),
    'concept'         => trim((string) ($first['concept'] ?? '')),
    'raw'             => $parsed,
]);
