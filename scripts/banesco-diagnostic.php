<?php
declare(strict_types=1);

/**
 * banesco-diagnostic.php — herramienta CLI standalone para probar el
 * endpoint "Confirmación de Transacciones" de Banesco y ver qué devuelve
 * de verdad antes de comprometer una arquitectura.
 *
 * Aplica los 7 hallazgos reales del código de producción de wifirapidito
 * (ver docs/plan-banesco.md en la branch update-plan-feedback-L2TCt):
 *
 *   1. Auth: grant_type=password (NO client_credentials), con el
 *      client_id en el campo "username", el client_secret en "password",
 *      y un header Authorization: Basic base64(client_id:client_secret)
 *      encima de todo.
 *   2. Transactions: POST con JSON body (NO GET con query params).
 *   3. Payload: { dataRequest: { device:{...}, transaction:{...} } }
 *      — device identifica al consumidor del API, transaction describe
 *      el pago que querés validar.
 *   4. accountId: cuenta Banesco destino (la de Higo), 20 dígitos,
 *      arranca con "0134". Va al config privado, no hardcodeado.
 *   5. phoneNum: formato 58XXXXXXXXXX (12 dígitos). El driver lo da
 *      como 04XXXXXXXXX, hay que convertir en el borde.
 *   6. Respuesta: httpStatus.statusCode === "200" y filtrar
 *      dataResponse.transactionDetail[] por trnType='CR' (créditos).
 *      Códigos conocidos: 70001 = no existe, CRT503 = mantenimiento.
 *   7. SSL verify DESHABILITADO (cert interno de Banesco). Se matchea
 *      la realidad aunque es un downgrade — TODO pinnear el CA real.
 *
 * USO
 * ---
 *   php scripts/banesco-diagnostic.php --help
 *
 *   php scripts/banesco-diagnostic.php \
 *       --config=/home/<user>/private/higo-banesco.php \
 *       --reference=000123456789 \
 *       --amount=420.00 \
 *       --phone=04141234567 \
 *       --date=2026-04-24
 *
 *   php scripts/banesco-diagnostic.php --dry-run ...   # no ejecuta nada
 *   php scripts/banesco-diagnostic.php --verbose ...   # imprime cuerpos
 *
 * CONFIG (archivo PHP que retorna array, o env vars si no hay --config)
 * ---
 *   BANESCO_SSO_URL         URL del token endpoint (Keycloak).
 *   BANESCO_TX_URL          URL de /financial-account/transactions.
 *   BANESCO_CLIENT_ID       credencial (va como username Y en Basic Auth).
 *   BANESCO_CLIENT_SECRET   credencial (va como password Y en Basic Auth).
 *   BANESCO_ACCOUNT_ID      cuenta destino de Higo (20 dígitos, 0134...).
 *   BANESCO_BANK_ID         banco de la cuenta destino (default 0134).
 *
 * SALIDA
 * ---
 *   exit 0 → flujo ok (incluye 70001 "no existe" y CRT503 "mantenimiento",
 *            que son respuestas válidas de Banesco, no errores del diag).
 *   exit 2 → error de uso / config.
 *   exit 3 → auth falló.
 *   exit 4 → respuesta de transactions no parseable.
 *   exit 5 → httpStatus.statusCode desconocido.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Este script solo corre por CLI.\n");
}

// ── Helpers ──────────────────────────────────────────────────────────

function bd_die(string $msg, int $code = 2): void {
    fwrite(STDERR, $msg . "\n");
    exit($code);
}

function bd_arg(array $opts, string $k, ?string $default = null): ?string {
    if (!array_key_exists($k, $opts) || $opts[$k] === false) return $default;
    return is_array($opts[$k]) ? (string) end($opts[$k]) : (string) $opts[$k];
}

function bd_flag(array $opts, string $k): bool {
    return array_key_exists($k, $opts);
}

function bd_print_help(): void {
    $src = (string) file_get_contents(__FILE__);
    $end = strpos($src, '*/');
    if ($end !== false) {
        fwrite(STDOUT, substr($src, 0, $end + 2) . "\n");
    }
}

/**
 * Normaliza un teléfono VE a 12 dígitos 58XXXXXXXXXX (formato Banesco).
 *   04141234567    -> 584141234567
 *   584141234567   -> 584141234567
 *   +58 414 123 45 67 -> 584141234567
 * Retorna null si no encaja.
 */
function bd_normalize_phone(string $raw): ?string {
    $digits = preg_replace('/\D+/', '', $raw) ?? '';
    if (strlen($digits) === 10 && str_starts_with($digits, '4')) {
        return '58' . $digits;
    }
    if (strlen($digits) === 11 && str_starts_with($digits, '0')) {
        return '58' . substr($digits, 1);
    }
    if (strlen($digits) === 12 && str_starts_with($digits, '58')) {
        return $digits;
    }
    return null;
}

/**
 * cURL wrapper. Retorna [int status, string body, string response_headers].
 * SSL verify OFF por hallazgo #7 (cert interno de Banesco).
 */
function bd_http(string $url, string $method, ?string $body, array $headers, bool $verbose): array {
    $ch = curl_init($url);
    $opts = [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_HEADER         => true,
        CURLOPT_FOLLOWLOCATION => false,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = $body;
    }
    curl_setopt_array($ch, $opts);
    if ($verbose) {
        curl_setopt($ch, CURLOPT_VERBOSE, true);
        curl_setopt($ch, CURLOPT_STDERR, fopen('php://stderr', 'w'));
    }
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException("cURL error: {$err}");
    }
    $status  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hdrSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $rawStr = (string) $raw;
    return [
        $status,
        (string) substr($rawStr, $hdrSize),
        (string) substr($rawStr, 0, $hdrSize),
    ];
}

function bd_indent(string $s, string $prefix = '  '): string {
    return $prefix . str_replace("\n", "\n{$prefix}", rtrim($s, "\n"));
}

// ── Main ─────────────────────────────────────────────────────────────

$opts = getopt('', [
    'config:', 'reference:', 'amount:', 'phone:', 'date:',
    'account:', 'bank:', 'dry-run', 'verbose', 'help',
]);

if (bd_flag($opts, 'help') || empty($opts)) {
    bd_print_help();
    exit(0);
}

$verbose = bd_flag($opts, 'verbose');
$dryRun  = bd_flag($opts, 'dry-run');

// Config: archivo o env.
$cfg = [];
$configPath = bd_arg($opts, 'config');
if ($configPath !== null) {
    if (!is_file($configPath)) {
        bd_die("Config no encontrado: {$configPath}");
    }
    /** @psalm-suppress UnresolvableInclude */
    $cfg = require $configPath;
    if (!is_array($cfg)) {
        bd_die("El config ({$configPath}) debe retornar un array.");
    }
} else {
    $cfg = [
        'BANESCO_SSO_URL'       => getenv('BANESCO_SSO_URL')       ?: '',
        'BANESCO_CLIENT_ID'     => getenv('BANESCO_CLIENT_ID')     ?: '',
        'BANESCO_CLIENT_SECRET' => getenv('BANESCO_CLIENT_SECRET') ?: '',
        'BANESCO_TX_URL'        => getenv('BANESCO_TX_URL')        ?: '',
        'BANESCO_ACCOUNT_ID'    => getenv('BANESCO_ACCOUNT_ID')    ?: '',
        'BANESCO_BANK_ID'       => getenv('BANESCO_BANK_ID')       ?: '0134',
    ];
}

foreach (['BANESCO_SSO_URL', 'BANESCO_CLIENT_ID', 'BANESCO_CLIENT_SECRET',
          'BANESCO_TX_URL', 'BANESCO_ACCOUNT_ID'] as $k) {
    if (empty($cfg[$k])) {
        bd_die("Falta config requerido: {$k}  (pasá --config=/path o exportá la env var).");
    }
}

// Parámetros de la transacción a validar.
$reference = bd_arg($opts, 'reference');
$amountRaw = bd_arg($opts, 'amount');
$phoneRaw  = bd_arg($opts, 'phone');
$date      = bd_arg($opts, 'date', gmdate('Y-m-d'));
$account   = bd_arg($opts, 'account', (string) $cfg['BANESCO_ACCOUNT_ID']);
$bank      = bd_arg($opts, 'bank',    (string) ($cfg['BANESCO_BANK_ID'] ?? '0134'));

if ($reference === null || $reference === '') bd_die("Falta --reference=<num>");
if ($amountRaw === null || $amountRaw === '') bd_die("Falta --amount=<bs>");
if ($phoneRaw === null || $phoneRaw === '')   bd_die("Falta --phone=<04...|58...>");

$amount = (float) $amountRaw;
if ($amount <= 0) bd_die("--amount debe ser > 0 (recibí: {$amountRaw})");

$phoneNum = bd_normalize_phone($phoneRaw);
if ($phoneNum === null) {
    bd_die("--phone no reconocido: {$phoneRaw}  (esperado 04XXXXXXXXX o 58XXXXXXXXXX)");
}

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date)) {
    bd_die("--date debe ser YYYY-MM-DD (recibí: {$date})");
}

if (!preg_match('/^\d{20}$/', (string) $account)) {
    fwrite(STDERR, "Aviso: accountId no tiene 20 dígitos ({$account}). Continuo igual.\n");
}

printf(
    "[diag] reference=%s  amount=%.2f  phone=%s (orig=%s)  date=%s\n"
  . "       account=%s  bank=%s\n",
    $reference, $amount, $phoneNum, $phoneRaw, $date, $account, $bank
);
if ($dryRun) echo "[diag] DRY-RUN: no se harán requests reales.\n";

// ── Paso 1/2: Autenticación ──────────────────────────────────────────

echo "\n[1/2] POST {$cfg['BANESCO_SSO_URL']}\n";
echo "      grant_type=password + Authorization: Basic base64(cid:csec)\n";

$authBody = http_build_query([
    'grant_type' => 'password',
    'username'   => $cfg['BANESCO_CLIENT_ID'],
    'password'   => $cfg['BANESCO_CLIENT_SECRET'],
]);
$basic = 'Basic ' . base64_encode(
    $cfg['BANESCO_CLIENT_ID'] . ':' . $cfg['BANESCO_CLIENT_SECRET']
);

if ($verbose) {
    $redacted = str_replace(
        [$cfg['BANESCO_CLIENT_ID'], $cfg['BANESCO_CLIENT_SECRET']],
        ['<CLIENT_ID>', '<CLIENT_SECRET>'],
        $authBody
    );
    echo "      body: {$redacted}\n";
    echo "      header: Authorization: Basic <redacted>\n";
}

$token = '';
if ($dryRun) {
    $token = '<DRY_RUN_TOKEN>';
    echo "      (dry-run) skip\n";
} else {
    try {
        [$aStatus, $aBody] = bd_http(
            (string) $cfg['BANESCO_SSO_URL'],
            'POST',
            $authBody,
            [
                'Content-Type: application/x-www-form-urlencoded',
                'Authorization: ' . $basic,
                'Accept: application/json',
            ],
            $verbose
        );
    } catch (Throwable $e) {
        bd_die("Auth: " . $e->getMessage(), 3);
    }

    echo "      <<< HTTP {$aStatus}  body=" . strlen($aBody) . " bytes\n";
    if ($verbose) {
        echo bd_indent($aBody, '          ') . "\n";
    }
    if ($aStatus < 200 || $aStatus >= 300) {
        fwrite(STDERR, bd_indent($aBody, '      ') . "\n");
        bd_die("Auth falló con HTTP {$aStatus}.", 3);
    }
    $aData = json_decode($aBody, true);
    if (!is_array($aData) || empty($aData['access_token'])) {
        fwrite(STDERR, bd_indent($aBody, '      ') . "\n");
        bd_die("Auth ok pero response no trae access_token.", 3);
    }
    $token = (string) $aData['access_token'];
    $ttl   = (int) ($aData['expires_in'] ?? 0);
    echo "      token ok  (expires_in={$ttl}s  token_len=" . strlen($token) . ")\n";
}

// ── Paso 2/2: Consulta de transacción ───────────────────────────────

echo "\n[2/2] POST {$cfg['BANESCO_TX_URL']}\n";

$localIp = @gethostbyname(@gethostname() ?: 'localhost');
if ($localIp === false || !is_string($localIp) || $localIp === '') $localIp = '127.0.0.1';

$payload = [
    'dataRequest' => [
        'device' => [
            'description' => 'HigoDiagnostic/1.0 (CLI)',
            'ipAddress'   => $localIp,
            'type'        => 'Web',
        ],
        'transaction' => [
            'referenceNumber' => $reference,
            'accountId'       => (string) $account,
            'amount'          => $amount,
            'startDt'         => (string) $date,
            'phoneNum'        => $phoneNum,
            'bankId'          => (string) $bank,
        ],
    ],
];
$jsonBody = json_encode(
    $payload,
    JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION
);
if ($jsonBody === false) bd_die("No pude serializar el payload a JSON.");

echo "      >>> body:\n" . bd_indent($jsonBody, '          ') . "\n";

if ($dryRun) {
    echo "      (dry-run) skip\n";
    exit(0);
}

try {
    [$tStatus, $tBody] = bd_http(
        (string) $cfg['BANESCO_TX_URL'],
        'POST',
        $jsonBody,
        [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ],
        $verbose
    );
} catch (Throwable $e) {
    bd_die("Transactions: " . $e->getMessage(), 4);
}

echo "      <<< HTTP {$tStatus}  body=" . strlen($tBody) . " bytes\n";
// Siempre imprimo el body (es lo que queremos ver), verbose o no.
echo bd_indent($tBody, '          ') . "\n";

// ── Interpretación ───────────────────────────────────────────────────

echo "\n[analisis]\n";
$resp = json_decode($tBody, true);
if (!is_array($resp)) {
    echo "  respuesta no es JSON válido.\n";
    exit(4);
}

$hStatus  = $resp['httpStatus']['statusCode'] ?? null;
$hMessage = $resp['httpStatus']['message']    ?? '';
printf("  httpStatus.statusCode = %s\n", var_export($hStatus, true));
if ($hMessage !== '') {
    printf("  httpStatus.message    = %s\n", $hMessage);
}

if ($hStatus === '70001') {
    echo "  → Banesco dice: transacción NO existe (ref/monto/phone/fecha no matchean).\n";
    echo "    Respuesta válida, no es error del diagnóstico.\n";
    exit(0);
}
if ($hStatus === 'CRT503') {
    echo "  → API de Banesco en MANTENIMIENTO. Reintentar luego.\n";
    exit(0);
}
if ($hStatus !== '200') {
    echo "  → statusCode desconocido. Ver body completo arriba.\n";
    exit(5);
}

$details = $resp['dataResponse']['transactionDetail'] ?? null;
if (!is_array($details)) {
    echo "  dataResponse.transactionDetail no es array — shape inesperado.\n";
    exit(5);
}

$credits = array_values(array_filter(
    $details,
    static fn($t) => is_array($t) && (($t['trnType'] ?? '') === 'CR')
));
printf("  transactionDetail total   = %d\n", count($details));
printf("  trnType='CR' (abonos)     = %d\n", count($credits));

foreach ($credits as $i => $t) {
    $ref = $t['referenceNumber'] ?? $t['reference'] ?? '?';
    $amt = $t['amount']          ?? '?';
    $dt  = $t['date']
        ?? $t['paidAt']
        ?? $t['startDt']
        ?? '?';
    printf("    #%d  ref=%s  amount=%s  date=%s\n", $i + 1, $ref, $amt, $dt);
}

if (count($credits) === 0) {
    echo "  → httpStatus=200 pero no hay créditos. Pago no confirmado con esos datos.\n";
} else {
    echo "  → OK: Banesco confirmó " . count($credits) . " abono(s).\n";
}
exit(0);
