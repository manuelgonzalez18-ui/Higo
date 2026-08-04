<?php
declare(strict_types=1);

/**
 * Banesco validation for the unified driver membership catalogue.
 *
 * The browser submits a plan UUID, but the server independently verifies:
 * - authenticated user is the same driver being activated;
 * - plan is active and matches profiles.vehicle_type;
 * - expected amount is plan USD price converted with the official rate;
 * - the bank transaction is a real credit and has not been reused;
 * - membership activation happens only through a service-role RPC.
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

function bv2_send(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function bv2_service_get(array $cfg, string $path): array {
    $base = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
    $key = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
    [$status, $body] = bl_http_get($base . $path, [
        'apikey: ' . $key,
        'Authorization: Bearer ' . $key,
        'Accept: application/json',
    ]);
    return [$status, json_decode($body, true)];
}

function bv2_service_rpc(array $cfg, string $name, array $params): array {
    $base = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
    $key = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
    [$status, $body] = bl_http_post(
        $base . '/rest/v1/rpc/' . rawurlencode($name),
        (string) json_encode($params, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        [
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
            'Content-Type: application/json',
            'Accept: application/json',
        ]
    );
    return [$status, json_decode($body, true)];
}

function bv2_authenticate(array $cfg): array {
    $header = (string) ($_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        bv2_send(401, ['ok' => false, 'errorCode' => 'NO_AUTH', 'errorMessage' => 'Sesión requerida.']);
    }

    $token = trim($matches[1]);
    $base = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
    $anon = (string) ($cfg['SUPABASE_ANON_KEY'] ?? '');
    [$status, $body] = bl_http_get($base . '/auth/v1/user', [
        'apikey: ' . $anon,
        'Authorization: Bearer ' . $token,
        'Accept: application/json',
    ]);
    $user = json_decode($body, true);
    if ($status !== 200 || !is_array($user) || empty($user['id'])) {
        bv2_send(401, ['ok' => false, 'errorCode' => 'BAD_TOKEN', 'errorMessage' => 'Tu sesión expiró.']);
    }
    return [$user, $token];
}

function bv2_vehicle_type(string $value): string {
    $value = strtolower(trim($value));
    if (in_array($value, ['moto', 'motorcycle', 'motocicleta'], true)) return 'moto';
    if (in_array($value, ['van', 'camioneta', 'pickup'], true)) return 'van';
    return 'standard';
}

function bv2_load_plan(array $cfg, string $driverId, string $requestedPlanId): array {
    [$profileStatus, $profiles] = bv2_service_get(
        $cfg,
        '/rest/v1/profiles?id=eq.' . rawurlencode($driverId)
        . '&select=id,role,vehicle_type,vehicle_model,archived_at'
    );
    $profile = $profileStatus === 200 && is_array($profiles) ? ($profiles[0] ?? null) : null;
    if (!is_array($profile) || ($profile['role'] ?? '') !== 'driver' || !empty($profile['archived_at'])) {
        bv2_send(403, ['ok' => false, 'errorCode' => 'DRIVER_REQUIRED', 'errorMessage' => 'Perfil de conductor inválido.']);
    }
    $driverType = bv2_vehicle_type((string) ($profile['vehicle_type'] ?: ($profile['vehicle_model'] ?? 'standard')));

    if ($requestedPlanId !== '') {
        [$planStatus, $plans] = bv2_service_get(
            $cfg,
            '/rest/v1/driver_membership_plans?id=eq.' . rawurlencode($requestedPlanId)
            . '&active=eq.true&select=id,code,name,vehicle_type,period,duration_days,amount,currency'
        );
    } else {
        // Backward compatibility for an older APK: default to the monthly plan
        // for the canonical vehicle type instead of trusting vehicle_model.
        [$planStatus, $plans] = bv2_service_get(
            $cfg,
            '/rest/v1/driver_membership_plans?vehicle_type=eq.' . rawurlencode($driverType)
            . '&period=eq.monthly&active=eq.true&select=id,code,name,vehicle_type,period,duration_days,amount,currency&limit=1'
        );
    }

    $plan = $planStatus === 200 && is_array($plans) ? ($plans[0] ?? null) : null;
    if (!is_array($plan) || empty($plan['id'])) {
        bv2_send(422, ['ok' => false, 'errorCode' => 'PLAN_NOT_FOUND', 'errorMessage' => 'El plan seleccionado no está disponible.']);
    }
    if (bv2_vehicle_type((string) ($plan['vehicle_type'] ?? '')) !== $driverType) {
        bv2_send(422, ['ok' => false, 'errorCode' => 'PLAN_MISMATCH', 'errorMessage' => 'El plan no corresponde al vehículo registrado.']);
    }
    if (($plan['currency'] ?? 'USD') !== 'USD' || !is_numeric($plan['amount'] ?? null) || (float) $plan['amount'] <= 0) {
        bv2_send(503, ['ok' => false, 'errorCode' => 'PLAN_PRICE', 'errorMessage' => 'El precio del plan no está configurado.']);
    }

    return [$profile, $plan];
}

function bv2_bcv_rate(array $cfg): array {
    $cacheFile = '/tmp/higo-bcv-rate.json';
    if (is_file($cacheFile)) {
        $cached = json_decode((string) @file_get_contents($cacheFile), true);
        $rate = is_array($cached) && is_numeric($cached['rate'] ?? null)
            ? (float) $cached['rate'] : null;
        $fetchedAt = is_array($cached) ? strtotime((string) ($cached['fetchedAt'] ?? '')) : false;
        if ($rate && $fetchedAt && $fetchedAt > time() - 6 * 3600) {
            return [$rate, 'bcv_cache'];
        }
    }

    try {
        [$status, $body] = bl_http_get(
            'https://ve.dolarapi.com/v1/dolares/oficial',
            ['Accept: application/json'],
            8
        );
        $data = $status === 200 ? json_decode($body, true) : null;
        if (is_array($data) && is_numeric($data['promedio'] ?? null)) {
            $rate = (float) $data['promedio'];
            @file_put_contents($cacheFile, json_encode([
                'ok' => true,
                'rate' => $rate,
                'source' => 'BCV via dolarapi',
                'fetchedAt' => $data['fechaActualizacion'] ?? gmdate('c'),
            ]));
            return [$rate, 'bcv_live'];
        }
    } catch (Throwable $e) {
        error_log('[banesco-v2] BCV lookup failed: ' . $e->getMessage());
    }

    bv2_send(503, ['ok' => false, 'errorCode' => 'BCV_UNAVAILABLE', 'errorMessage' => 'No se pudo obtener la tasa oficial. Reintentá en unos minutos.']);
}

function bv2_friendly_banesco_error(string $code): string {
    switch ($code) {
        case '70001':
            return 'Banesco no encontró esta transacción. Verificá referencia, fecha y banco.';
        case 'VRN04':
        case 'CRT503':
            return 'Banesco está en mantenimiento. Reintentá más tarde.';
        case '400':
            return 'Los datos enviados a Banesco no son válidos.';
        default:
            return $code !== ''
                ? 'Banesco respondió con código ' . $code . '.'
                : 'Banesco no reportó un abono.';
    }
}

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    bv2_send(503, ['ok' => false, 'errorCode' => 'CONFIG', 'errorMessage' => 'Servicio temporalmente no disponible.']);
}

api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('banesco-validate-v2', 10, '/tmp/higo_ratelimit.log');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    bv2_send(405, ['ok' => false, 'errorCode' => 'METHOD', 'errorMessage' => 'Use POST.']);
}

[$user] = bv2_authenticate($cfg);
$driverId = (string) $user['id'];
$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input)) {
    bv2_send(400, ['ok' => false, 'errorCode' => 'BAD_JSON', 'errorMessage' => 'Solicitud inválida.']);
}

$planId = trim((string) ($input['plan_id'] ?? ''));
$paymentType = trim((string) ($input['payment_type'] ?? 'pm_banesco'));
$referenceRaw = (string) ($input['reference'] ?? '');
$referenceDigits = preg_replace('/\D+/', '', $referenceRaw);
$reference = is_string($referenceDigits) ? substr($referenceDigits, -6) : '';
$amountReported = $input['amount'] ?? null;
$phoneRaw = trim((string) ($input['phone'] ?? ''));
$date = trim((string) ($input['date'] ?? date('Y-m-d')));
$bank = trim((string) ($input['bank'] ?? ''));

$errors = [];
if ($planId !== '' && !preg_match('/^[0-9a-fA-F-]{36}$/', $planId)) $errors[] = 'plan_id inválido.';
if (!preg_match('/^\d{6}$/', $reference)) $errors[] = 'La referencia debe contener los últimos 6 dígitos.';
if (!is_numeric($amountReported) || (float) $amountReported <= 0) $errors[] = 'Monto inválido.';
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $errors[] = 'Fecha inválida.';
if (!preg_match('/^\d{4}$/', $bank)) $errors[] = 'Banco inválido.';
$phone = bl_normalize_phone($phoneRaw);
if ($phone === false) $errors[] = 'Teléfono emisor inválido.';
if ($errors) {
    bv2_send(422, ['ok' => false, 'errorCode' => 'VALIDATION', 'errorMessage' => implode(' ', $errors)]);
}

[, $plan] = bv2_load_plan($cfg, $driverId, $planId);
[$bcvRate, $bcvSource] = bv2_bcv_rate($cfg);
$expectedUsd = (float) $plan['amount'];
$expectedBs = round($expectedUsd * $bcvRate, 2);
$amount = (float) $amountReported;

// Global duplicate pre-check with the service role. The RPC unique constraint
// remains the final race-safe protection.
[$dupStatus, $duplicates] = bv2_service_get(
    $cfg,
    '/rest/v1/payment_reports?bank_origin=eq.' . rawurlencode($bank)
    . '&reference_last6=eq.' . rawurlencode($reference)
    . '&trn_date=eq.' . rawurlencode($date)
    . '&status=eq.validated&select=id&limit=1'
);
if ($dupStatus === 200 && is_array($duplicates) && count($duplicates) > 0) {
    bv2_send(409, ['ok' => false, 'errorCode' => 'ALREADY_VALIDATED', 'errorMessage' => 'Esta referencia ya fue usada.']);
}

$logPath = (string) ($cfg['DIAG_LOG_PATH']
    ?? (dirname((string) bl_find_config_path()) . '/higo-banesco-diag.log'));

try {
    $banescoToken = bl_banesco_auth($cfg);
    $query = [
        'referenceNumber' => $reference,
        'accountId' => (string) ($cfg['BANESCO_ACCOUNT_ID'] ?? ''),
        'amount' => $amount,
        'startDt' => $date,
        'phoneNum' => $phone,
        'bankId' => $bank,
    ];
    [$payload, $httpCode, $body] = bl_banesco_query($cfg, $query, $banescoToken);
    bl_log($logPath, 'v2 driver=' . $driverId . ' plan=' . $plan['id'] . ' bank=' . $bank . ' ref=' . $reference);
    bl_log_request($logPath, $payload);
    bl_log_response($logPath, $httpCode, $body);
} catch (Throwable $e) {
    bl_log($logPath, '=== V2 EXCEPTION === ' . $e->getMessage());
    bv2_send(502, ['ok' => false, 'errorCode' => 'UPSTREAM', 'errorMessage' => 'Banesco no respondió. Reintentá.']);
}

$parsed = json_decode($body, true);
if (!is_array($parsed)) {
    bv2_send(502, ['ok' => false, 'errorCode' => 'BAD_RESPONSE', 'errorMessage' => 'Banesco devolvió una respuesta inválida.']);
}
$statusCode = (string) ($parsed['httpStatus']['statusCode'] ?? '');
$details = $parsed['dataResponse']['transactionDetail'] ?? [];
$credits = is_array($details)
    ? array_values(array_filter($details, static fn($row) => is_array($row) && (($row['trnType'] ?? '') === 'CR')))
    : [];

if ($statusCode !== '200' || !$credits) {
    bv2_send(200, [
        'ok' => false,
        'errorCode' => $statusCode ?: 'NO_CREDIT',
        'errorMessage' => bv2_friendly_banesco_error($statusCode),
        'statusCode' => $statusCode,
    ]);
}

$transaction = $credits[0];
$amountReal = is_numeric($transaction['amount'] ?? null) ? (float) $transaction['amount'] : null;
$transactionDate = (string) ($transaction['trnDate'] ?? $date);
$diff = $amountReal !== null ? $amountReal - $expectedBs : null;
$diffPct = $diff !== null && $expectedBs > 0 ? ($diff / $expectedBs) * 100 : null;
$withinTolerance = $amountReal !== null && $amountReal >= $expectedBs * 0.99;

$response = [
    'ok' => true,
    'statusCode' => $statusCode,
    'amountReal' => $amountReal,
    'amountRequested' => $amount,
    'expectedBs' => $expectedBs,
    'expectedUsd' => $expectedUsd,
    'planId' => $plan['id'],
    'planCode' => $plan['code'],
    'planName' => $plan['name'],
    'period' => $plan['period'],
    'durationDays' => (int) $plan['duration_days'],
    'bcvRate' => $bcvRate,
    'bcvSource' => $bcvSource,
    'diff' => $diff,
    'diffPct' => $diffPct,
    'withinTolerance' => $withinTolerance,
    'trnDate' => $transactionDate,
    'trnTime' => (string) ($transaction['trnTime'] ?? ''),
    'referenceNumber' => (string) ($transaction['referenceNumber'] ?? $reference),
];

if (!$withinTolerance) {
    bv2_send(200, $response);
}

[$rpcStatus, $rpcBody] = bv2_service_rpc($cfg, 'register_membership_payment_v2', [
    'p_driver_id' => $driverId,
    'p_plan_id' => $plan['id'],
    'p_payment_type' => $paymentType,
    'p_bank_origin' => $bank,
    'p_reference' => $reference,
    'p_sender_phone' => $phone,
    'p_amount_reported' => $amount,
    'p_amount_real' => $amountReal,
    'p_trn_date' => $transactionDate,
    'p_banesco_status' => $statusCode,
    'p_raw_response' => $parsed,
]);

$rpcMessage = is_array($rpcBody) ? (string) ($rpcBody['message'] ?? '') : '';
if ($rpcStatus === 409
    || stripos($rpcMessage, 'duplicate') !== false
    || stripos($rpcMessage, 'already_used') !== false) {
    bv2_send(409, ['ok' => false, 'errorCode' => 'ALREADY_VALIDATED', 'errorMessage' => 'Esta referencia ya fue usada.']);
}
if ($rpcStatus < 200 || $rpcStatus >= 300 || !is_array($rpcBody)) {
    bl_log($logPath, '=== V2 ACTIVATION FAILED === status=' . $rpcStatus . ' body=' . substr(json_encode($rpcBody), 0, 300));
    bv2_send(502, [
        'ok' => false,
        'errorCode' => 'ACTIVATION_FAILED',
        'errorMessage' => 'El pago fue confirmado, pero la membresía no pudo activarse. Contactá soporte con la referencia.',
    ]);
}

$response['membershipId'] = $rpcBody['membership_id'] ?? null;
$response['reportId'] = $rpcBody['report_id'] ?? null;
$response['expiresAt'] = $rpcBody['expires_at'] ?? null;
bv2_send(200, $response);
