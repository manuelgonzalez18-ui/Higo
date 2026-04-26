<?php
declare(strict_types=1);

/**
 * banesco-lookup.php — UI web para consultar el endpoint de
 * Confirmación de Transacciones de Banesco y ver la respuesta cruda.
 *
 * Diagnóstico. NO es producción. Se despliega a higoapp.com/ junto al
 * SPA y queda detrás de HTTP Basic Auth.
 *
 * Seguridad:
 *   - HTTP Basic Auth. Password viene de DIAG_PASSWORD en
 *     /home/<user>/private/higo-banesco.php. Si DIAG_PASSWORD está vacío
 *     o no existe, la herramienta está deshabilitada (503).
 *   - SSO_URL, TX_URL, CLIENT_ID, CLIENT_SECRET, ACCOUNT_ID vienen del
 *     mismo config privado. NUNCA se imprimen en el HTML ni se logean.
 *   - Cada consulta se loguea a /home/<user>/private/higo-banesco-diag.log
 *     con el mismo formato que usa wifirapidito.
 *   - SSL verify deshabilitado contra Banesco (cert interno).
 */

// ═══ Config + auth ═══════════════════════════════════════════════════

require_once __DIR__ . '/banesco-core.php';

function bl_fail(int $status, string $msg): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $msg . "\n";
    exit;
}

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    bl_fail(503, $e->getMessage());
}
$configPath = bl_find_config_path();

$diagPass = (string) ($cfg['DIAG_PASSWORD'] ?? '');
if ($diagPass === '') {
    bl_fail(
        503,
        "Herramienta deshabilitada. Seteá DIAG_PASSWORD en /private/higo-banesco.php"
      . " para habilitarla."
    );
}

$user = (string) ($_SERVER['PHP_AUTH_USER'] ?? '');
$pass = (string) ($_SERVER['PHP_AUTH_PW']   ?? '');
if (!hash_equals($diagPass, $pass)) {
    header('WWW-Authenticate: Basic realm="Banesco Lookup"');
    bl_fail(401, "Autenticación requerida.");
}

// ═══ Handler ═════════════════════════════════════════════════════════

$logPath = $cfg['DIAG_LOG_PATH'] ?? (dirname((string) $configPath) . '/higo-banesco-diag.log');

$errors      = [];
$sentPayload = null;
$httpCode    = null;
$rawResp     = null;
$parsed      = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $reference = trim((string) ($_POST['reference'] ?? ''));
    $amountRaw = trim((string) ($_POST['amount']    ?? ''));
    $phoneRaw  = trim((string) ($_POST['phone']     ?? ''));
    $date      = trim((string) ($_POST['date']      ?? ''));
    $bank      = trim((string) ($_POST['bank']      ?? '0102'));

    if ($reference === '')                      $errors[] = 'Reference es requerido.';
    if ($amountRaw === '' || !is_numeric($amountRaw) || (float) $amountRaw <= 0) {
        $errors[] = 'Amount debe ser un número > 0.';
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        $errors[] = 'Date debe ser YYYY-MM-DD.';
    }
    if (!preg_match('/^\d{4}$/', $bank)) {
        $errors[] = 'Bank ID debe ser 4 dígitos.';
    }

    $phoneNorm = bl_normalize_phone($phoneRaw);
    if ($phoneNorm === false) {
        $errors[] = 'Phone inválido. Esperado 04XXXXXXXXX, 58XXXXXXXXXX o vacío (sólo si bank=0134).';
    }
    if ($phoneNorm === null && $bank !== '0134') {
        // No es error bloqueante; Banesco va a devolver 70001 pero a veces
        // igual queremos hacerlo para ver el shape. Warn only.
    }

    if (!$errors) {
        try {
            $token = bl_banesco_auth($cfg);
            $tx = [
                'referenceNumber' => $reference,
                'accountId'       => (string) ($cfg['BANESCO_ACCOUNT_ID'] ?? ''),
                'amount'          => (float) $amountRaw,
                'startDt'         => $date,
                'phoneNum'        => $phoneNorm,
                'bankId'          => $bank,
            ];
            [$sentPayload, $httpCode, $rawResp] = bl_banesco_query($cfg, $tx, $token);
            bl_log_request($logPath, $sentPayload);
            bl_log_response($logPath, $httpCode, $rawResp);
            $parsed = json_decode($rawResp, true);
        } catch (Throwable $e) {
            $errors[] = 'Error llamando a Banesco: ' . $e->getMessage();
            bl_log($logPath, "=== EXCEPTION ===\n" . $e->getMessage() . "\n----------------------------------------");
        }
    }
}

// ═══ Render ══════════════════════════════════════════════════════════

function bl_h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function bl_fmt_json($v): string {
    if (is_string($v)) {
        $dec = json_decode($v, true);
        if ($dec !== null) $v = $dec;
    }
    return (string) json_encode(
        $v,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE
    );
}

$banks = [
    '0102' => '0102 · Banco de Venezuela',
    '0104' => '0104 · Venezolano de Crédito',
    '0105' => '0105 · Mercantil',
    '0108' => '0108 · Provincial',
    '0114' => '0114 · Bancaribe',
    '0128' => '0128 · Banco Caroní',
    '0134' => '0134 · Banesco (mismo banco)',
    '0138' => '0138 · Plaza',
    '0151' => '0151 · BFC',
    '0156' => '0156 · 100% Banco',
    '0163' => '0163 · Tesoro',
    '0169' => '0169 · Mi Banco',
    '0171' => '0171 · Activo',
    '0172' => '0172 · Bancamiga',
    '0174' => '0174 · Banplus',
    '0175' => '0175 · Bicentenario',
    '0191' => '0191 · BNC',
];

$selRef   = (string) ($_POST['reference'] ?? '');
$selAmt   = (string) ($_POST['amount']    ?? '');
$selPhone = (string) ($_POST['phone']     ?? '');
$selDate  = (string) ($_POST['date']      ?? date('Y-m-d'));
$selBank  = (string) ($_POST['bank']      ?? '0102');

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Banesco · Confirmación de Transacciones</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 820px; margin: 1.5rem auto; padding: 0 1rem;
      background: #0f1115; color: #e8e8e8; line-height: 1.5;
    }
    h1 { margin: 0 0 .25rem; font-size: 1.35rem; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 .5rem; }
    p.muted, .muted { color: #8a8f98; font-size: .875rem; }
    code { background: #1a1d24; padding: 1px 6px; border-radius: 3px; }

    form { display: grid; gap: .75rem; background: #1a1d24; padding: 1rem;
           border-radius: 8px; margin-top: 1rem; }
    label { display: grid; gap: .25rem; font-size: .875rem; }
    input, select, button {
      padding: .55rem .7rem; border-radius: 5px; border: 1px solid #2a2f3a;
      background: #0f1115; color: #eee; font: inherit;
    }
    input:focus, select:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
    button {
      background: #2563eb; border-color: #2563eb; color: #fff;
      font-weight: 600; cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }

    .card { background: #1a1d24; padding: 1rem; border-radius: 8px; margin-top: 1rem; }
    .errors { border-left: 3px solid #ef4444; padding-left: .75rem; color: #fca5a5; }
    .ok   { color: #4ade80; }
    .bad  { color: #f87171; }
    .warn { color: #fbbf24; }
    pre { overflow-x: auto; background: #0a0d12; padding: .75rem; border-radius: 5px;
          font-size: .82rem; margin: .4rem 0 0; white-space: pre-wrap; word-break: break-all; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 3px;
             font-size: .75rem; font-weight: 600; background: #2a2f3a; }
    .kv { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem;
          font-size: .9rem; }
    .kv div:nth-child(odd) { color: #8a8f98; }
  </style>
</head>
<body>

<h1>Banesco · Confirmación de Transacciones</h1>
<p class="muted">
  RIF <code><?= bl_h((string) ($cfg['BANESCO_RIF'] ?? 'J402638850')) ?></code> ·
  cuenta <code><?= bl_h((string) ($cfg['BANESCO_ACCOUNT_ID'] ?? '')) ?></code> ·
  log → <code><?= bl_h($logPath) ?></code>
</p>

<?php if ($errors): ?>
  <div class="card errors">
    <strong>Errores:</strong>
    <?php foreach ($errors as $e): ?><div>· <?= bl_h($e) ?></div><?php endforeach; ?>
  </div>
<?php endif; ?>

<form method="post" autocomplete="off">
  <label>Reference number
    <input name="reference" maxlength="20" required value="<?= bl_h($selRef) ?>"
           placeholder="ej 376765 o 000690300373">
  </label>
  <div class="row">
    <label>Amount (Bs)
      <input type="number" step="0.01" min="0.01" name="amount" required
             value="<?= bl_h($selAmt) ?>" placeholder="9677.39">
    </label>
    <label>Date del pago
      <input type="date" name="date" required value="<?= bl_h($selDate) ?>">
    </label>
  </div>
  <div class="row">
    <label>Phone del pagador (opcional si bank=0134)
      <input name="phone" value="<?= bl_h($selPhone) ?>"
             placeholder="04120330315 · dejar vacío para interbank">
    </label>
    <label>Bank ID (banco origen)
      <select name="bank">
        <?php foreach ($banks as $code => $label):
              $sel = $code === $selBank ? ' selected' : ''; ?>
          <option value="<?= bl_h($code) ?>"<?= $sel ?>><?= bl_h($label) ?></option>
        <?php endforeach; ?>
      </select>
    </label>
  </div>
  <button type="submit">Consultar Banesco</button>
</form>

<?php if ($sentPayload !== null): ?>
  <h2>Request enviado</h2>
  <div class="card">
    <pre><?= bl_h(bl_fmt_json($sentPayload)) ?></pre>
  </div>
<?php endif; ?>

<?php if ($httpCode !== null): ?>
  <h2>Respuesta cruda · HTTP <?= (int) $httpCode ?></h2>
  <div class="card">
    <pre><?= bl_h(bl_fmt_json($rawResp)) ?></pre>
  </div>
<?php endif; ?>

<?php
if ($parsed !== null && is_array($parsed)):
    $hStatus = $parsed['httpStatus']['statusCode'] ?? null;
    $hDesc   = $parsed['httpStatus']['statusDesc']
             ?? $parsed['httpStatus']['message']
             ?? '';
    $details = $parsed['dataResponse']['transactionDetail'] ?? [];
    if (!is_array($details)) $details = [];
    $credits = array_values(array_filter(
        $details,
        static fn($t) => is_array($t) && (($t['trnType'] ?? '') === 'CR')
    ));
    $reqAmount = isset($sentPayload['dataRequest']['transaction']['amount'])
        ? (float) $sentPayload['dataRequest']['transaction']['amount']
        : null;
?>
  <h2>Análisis</h2>
  <div class="card">
    <div class="kv">
      <div>httpStatus.statusCode</div><div><code><?= bl_h((string) $hStatus) ?></code></div>
      <?php if ($hDesc !== ''): ?>
        <div>httpStatus.statusDesc</div><div><?= bl_h($hDesc) ?></div>
      <?php endif; ?>
      <div>trnType='CR' count</div><div><?= count($credits) ?></div>
    </div>

    <?php if ($hStatus === '200' && $credits): ?>
      <p class="ok" style="margin-top: .75rem;">
        ✓ Banesco confirmó <?= count($credits) ?> abono(s).
      </p>
      <?php foreach ($credits as $i => $t):
          $ra = $t['amount'] ?? null;
          $diff = null; $pct = null; $verdict = null;
          if ($reqAmount !== null && is_numeric($ra)) {
              $diff = (float) $ra - $reqAmount;
              $pct  = $reqAmount > 0 ? ($diff / $reqAmount) * 100.0 : 0.0;
              $verdict = abs($pct) <= 1.0 ? ['ok', 'dentro de ±1%']
                        : (abs($pct) <= 5.0 ? ['warn', 'dentro de ±5%']
                        : ['bad', 'FUERA de tolerancia']);
          }
          $acc = trim((string) ($t['accountId'] ?? ''));
          $isPhoneLike = str_starts_with($acc, '5841') || str_starts_with($acc, '5842')
                       || str_starts_with($acc, '5844') || str_starts_with($acc, '5826');
          $variant = $isPhoneLike ? 'A · pago móvil' : 'B · transf. interna';
      ?>
        <div class="card" style="background: #0f1115; margin-top: .75rem;">
          <div class="kv">
            <div>#</div><div><?= $i + 1 ?> <span class="badge"><?= bl_h($variant) ?></span></div>
            <div>referenceNumber</div><div><code><?= bl_h((string) ($t['referenceNumber'] ?? '')) ?></code></div>
            <div>accountId</div><div><code><?= bl_h($acc) ?></code></div>
            <div>sourceBankId / destBankId</div>
            <div><code><?= bl_h((string) ($t['sourceBankId'] ?? '')) ?></code>
                 →
                 <code><?= bl_h((string) ($t['destBankId'] ?? '')) ?></code></div>
            <div>trnDate / trnTime</div>
            <div><?= bl_h((string) ($t['trnDate'] ?? '')) ?>
                 <?= bl_h((string) ($t['trnTime'] ?? '')) ?></div>
            <div>concept</div><div><?= bl_h(trim((string) ($t['concept'] ?? ''))) ?></div>
            <div>amount real</div>
            <div><?= bl_h((string) ($ra ?? '?')) ?> Bs
              <?php if ($verdict !== null && $diff !== null && $pct !== null): ?>
                · request=<?= number_format($reqAmount ?? 0, 2, '.', '') ?>
                · diff=<?= ($diff >= 0 ? '+' : '') . number_format($diff, 2, '.', '') ?>
                (<?= ($pct >= 0 ? '+' : '') . number_format($pct, 2, '.', '') ?>%)
                · <span class="<?= $verdict[0] ?>"><?= bl_h($verdict[1]) ?></span>
              <?php endif; ?>
            </div>
          </div>
        </div>
      <?php endforeach; ?>
    <?php elseif ($hStatus === '70001'): ?>
      <p class="warn" style="margin-top: .75rem;">
        · 70001: Banesco no encontró la transacción con esos datos.
        Probar otra fecha, otro bankId, o revisar la referencia.
      </p>
    <?php elseif ($hStatus === 'VRN04' || $hStatus === 'CRT503'): ?>
      <p class="warn" style="margin-top: .75rem;">
        · Banesco en horario de mantenimiento (típico 02:00–06:00). Reintentar luego.
      </p>
    <?php elseif ($hStatus === '400' || (is_string($hStatus) && str_starts_with($hStatus, 'VDE'))): ?>
      <p class="bad" style="margin-top: .75rem;">
        · Error de validación del payload (<?= bl_h((string) $hStatus) ?>).
        Revisar formato de phoneNum (12 dígitos 58...) o campos obligatorios.
      </p>
    <?php else: ?>
      <p class="bad" style="margin-top: .75rem;">
        · statusCode inesperado: <code><?= bl_h((string) $hStatus) ?></code>.
      </p>
    <?php endif; ?>

    <p class="muted" style="margin-top: .75rem;">
      Nota: Banesco <strong>no valida el amount</strong>. Puede responder 200 con
      un monto distinto al consultado. La comparación de arriba se hace client-side.
    </p>
  </div>
<?php endif; ?>

<p class="muted" style="margin-top: 2rem;">
  Higo · diagnóstico Banesco · v1
</p>

</body>
</html>
