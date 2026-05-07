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
 * `withinTolerance` se calcula SIEMPRE contra el precio real del plan del
 * conductor (USD * tasa BCV), nunca contra el monto que el driver declaró.
 * Eso evita que alguien declare $1, pague $1, y active una membresía de $10.
 *
 * Respuesta JSON (HTTP 200 incluso para errores Banesco; sólo HTTP no-200
 * en errores de autenticación, validación de payload o internos):
 *   { ok: true,  statusCode, amountReal, amountRequested, expectedBs,
 *     expectedUsd, plan, bcvRate, diff, diffPct, withinTolerance,
 *     trnDate, raw }
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
 * @return array{0:array{id:string,email:?string},1:string} datos del usuario y su token
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
    return [['id' => (string) $u['id'], 'email' => $u['email'] ?? null], $token];
}

// ═══ Supabase REST helpers ════════════════════════════════════════════

/**
 * Llama a la REST de Supabase con el JWT del usuario para que apliquen las
 * RLS. Devuelve [http_code, decoded_body|null].
 *
 * @return array{0:int,1:mixed}
 */
function bv_supabase_get(array $cfg, string $token, string $path): array {
    $url = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/') . $path;
    [$status, $body] = bl_http_get($url, [
        'apikey: ' . (string) ($cfg['SUPABASE_ANON_KEY'] ?? ''),
        'Authorization: Bearer ' . $token,
        'Accept: application/json',
    ]);
    return [$status, json_decode($body, true)];
}

/**
 * Calcula el precio del plan del conductor en bolívares usando tasa BCV.
 * Si la tasa BCV no está disponible, cae en `membership_plans.amount_bs`.
 *
 * @return array{plan:string,amount_usd:?float,amount_bs:?float,bcv_rate:?float,bcv_source:string}
 */
function bv_compute_expected(array $cfg, string $token, string $userId): array {
    // Plan del driver (RLS: drivers ven su propio profile).
    [$st1, $prof] = bv_supabase_get(
        $cfg, $token,
        '/rest/v1/profiles?id=eq.' . urlencode($userId) . '&select=vehicle_model'
    );
    $plan = 'standard';
    if ($st1 === 200 && is_array($prof) && !empty($prof[0]['vehicle_model'])) {
        $vm = (string) $prof[0]['vehicle_model'];
        if (in_array($vm, ['moto', 'standard', 'van'], true)) $plan = $vm;
    }

    // Catálogo del plan (RLS: anon puede leer membership_plans).
    [$st2, $row] = bv_supabase_get(
        $cfg, $token,
        '/rest/v1/membership_plans?plan=eq.' . urlencode($plan) . '&select=amount_usd,amount_bs'
    );
    $amountUsd = null;
    $amountBs  = null;
    if ($st2 === 200 && is_array($row) && isset($row[0])) {
        $amountUsd = is_numeric($row[0]['amount_usd'] ?? null) ? (float) $row[0]['amount_usd'] : null;
        $amountBs  = is_numeric($row[0]['amount_bs']  ?? null) ? (float) $row[0]['amount_bs']  : null;
    }

    // Tasa BCV: leer cache local del endpoint /api/bcv-rate.php.
    $bcvRate   = null;
    $bcvSource = 'plan_amount_bs';
    $cacheFile = '/tmp/higo-bcv-rate.json';
    if (is_file($cacheFile)) {
        $cached = json_decode((string) @file_get_contents($cacheFile), true);
        if (is_array($cached) && is_numeric($cached['rate'] ?? null)) {
            $bcvRate   = (float) $cached['rate'];
            $bcvSource = 'bcv_cache';
        }
    }

    // Si no hay cache, intentar BCV fresco (la latencia extra es aceptable
    // porque va a entrar al cache para próximos requests).
    if ($bcvRate === null) {
        try {
            [$status, $body] = bl_http_get(
                'https://ve.dolarapi.com/v1/dolares/oficial',
                ['Accept: application/json'],
                8
            );
            $data = $status === 200 ? json_decode($body, true) : null;
            if (is_array($data) && is_numeric($data['promedio'] ?? null)) {
                $bcvRate   = (float) $data['promedio'];
                $bcvSource = 'bcv_live';
                @file_put_contents($cacheFile, json_encode([
                    'ok'        => true,
                    'rate'      => $bcvRate,
                    'source'    => 'BCV via dolarapi',
                    'fetchedAt' => $data['fechaActualizacion'] ?? gmdate('c'),
                    'cached'    => false,
                ]));
            }
        } catch (Throwable $e) { /* fallback al amount_bs */ }
    }

    $expectedBs = ($amountUsd !== null && $bcvRate !== null)
        ? round($amountUsd * $bcvRate, 2)
        : $amountBs;

    return [
        'plan'       => $plan,
        'amount_usd' => $amountUsd,
        'amount_bs'  => $expectedBs,
        'bcv_rate'   => $bcvRate,
        'bcv_source' => $bcvSource,
    ];
}

/**
 * Devuelve true si la (bank, ref, date) ya fue validada antes para CUALQUIER
 * conductor. Usa el unique index parcial uq_payment_reports_ref_validated.
 * RLS limita a sólo las filas del propio driver, así que esto detecta sus
 * reusos pero NO los de otros drivers — el INSERT del RPC fallará igual por
 * el unique index, simplemente lo aprovechamos para ahorrar la llamada a
 * Banesco cuando podemos.
 */
function bv_already_validated(array $cfg, string $token, string $bank, string $ref, string $date): bool {
    [$status, $rows] = bv_supabase_get(
        $cfg, $token,
        '/rest/v1/payment_reports'
        . '?bank_origin=eq.' . urlencode($bank)
        . '&reference_last6=eq.' . urlencode($ref)
        . '&trn_date=eq.' . urlencode($date)
        . '&status=eq.validated'
        . '&select=id&limit=1'
    );
    return $status === 200 && is_array($rows) && count($rows) > 0;
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

[$user, $userToken] = bv_authenticate($cfg);

$raw = file_get_contents('php://input') ?: '';
$in  = json_decode($raw, true);
if (!is_array($in)) {
    bv_send_json(400, ['ok' => false, 'errorCode' => 'BAD_JSON', 'errorMessage' => 'Body no es JSON válido.']);
}

$reference = trim((string) ($in['reference'] ?? ''));
$amountRaw = $in['amount'] ?? null;
$date      = trim((string) ($in['date']      ?? date('Y-m-d')));
$bank      = trim((string) ($in['bank']      ?? ''));

$errors = [];
if ($reference === '' || !preg_match('/^\d{1,12}$/', $reference)) {
    $errors[] = 'reference debe ser numérica (1–12 dígitos).';
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
if ($errors) {
    bv_send_json(422, ['ok' => false, 'errorCode' => 'VALIDATION', 'errorMessage' => implode(' ', $errors)]);
}

// phoneNum para Banesco = teléfono RECEPTOR de Higo (no el del conductor emisor).
// La API de Banesco identifica la transacción por: mi cuenta + mi teléfono + ref + banco origen.
$receiverPhone = (string) ($cfg['HIGOPAY_RECEIVER_PHONE'] ?? '04120330315');
$phoneNorm     = bl_normalize_phone($receiverPhone) ?? null;

$amount = (float) $amountRaw;

$logPath = (string) ($cfg['DIAG_LOG_PATH']
    ?? (dirname((string) bl_find_config_path()) . '/higo-banesco-diag.log'));

// Pre-check duplicado: si la misma (banco, ref, fecha) ya fue validada
// por este driver, devolver error sin gastar una llamada a Banesco.
if (bv_already_validated($cfg, $userToken, $bank, $reference, $date)) {
    bv_send_json(409, [
        'ok'           => false,
        'errorCode'    => 'ALREADY_VALIDATED',
        'errorMessage' => 'Esta referencia ya fue registrada como pago válido.',
    ]);
}

// Precio esperado del plan del driver. Si no se puede calcular, abortamos:
// validar contra "lo que el driver declaró" abre un bypass de pago.
$expected = bv_compute_expected($cfg, $userToken, $user['id']);
if (!is_numeric($expected['amount_bs']) || $expected['amount_bs'] <= 0) {
    bv_send_json(503, [
        'ok'           => false,
        'errorCode'    => 'NO_PLAN_PRICE',
        'errorMessage' => 'No se pudo determinar el precio del plan. Reintentá en unos minutos.',
    ]);
}
$expectedBs = (float) $expected['amount_bs'];

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

// Tomamos el primer abono (típicamente único). Comparamos amount real vs
// el precio del plan (no contra lo declarado por el driver). Tolerancia
// asimétrica: aceptamos pagos iguales o mayores; sólo rechazamos cuando
// el pago real queda más de 1% por debajo del precio.
$first    = $credits[0];
$amountRl = isset($first['amount']) && is_numeric($first['amount']) ? (float) $first['amount'] : null;
$diff     = $amountRl !== null ? $amountRl - $expectedBs : null;
$pct      = $amountRl !== null ? ($diff / $expectedBs) * 100.0 : null;
$within   = $amountRl !== null && $amountRl >= $expectedBs * 0.99;

bv_send_json(200, [
    'ok'              => true,
    'statusCode'      => $statusCode,
    'amountReal'      => $amountRl,
    'amountRequested' => $amount,
    'expectedBs'      => $expectedBs,
    'expectedUsd'     => $expected['amount_usd'],
    'plan'            => $expected['plan'],
    'bcvRate'         => $expected['bcv_rate'],
    'bcvSource'       => $expected['bcv_source'],
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
