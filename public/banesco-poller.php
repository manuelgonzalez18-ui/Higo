<?php
/**
 * banesco-poller.php
 *
 * Script invocado por el cron de Hostinger cada 2 min:
 *     *\/2 * * * * /usr/bin/php -f /home/<user>/public_html/banesco-poller.php \
 *                  >> /home/<user>/private/higo-banesco.log 2>&1
 *
 * Orquesta:
 *   1. Carga /private/higo-banesco.php (secretos, NO commit).
 *   2. Lee last_cursor de banesco_poll_state.
 *   3. Pide access token a Banesco (OAuth2 client_credentials).
 *   4. Consulta transacciones en (last_cursor - overlap, now).
 *   5. Normaliza cada tx, invoca RPC register_membership_from_payment.
 *   6. Escribe nuevo last_cursor + last_run_result en la DB.
 *
 * Requisitos de seguridad:
 *   - Solo ejecutable por CLI (PHP_SAPI check).
 *   - Bloqueado adicionalmente a nivel .htaccess.
 *   - flock() para evitar runs concurrentes.
 */

declare(strict_types=1);

// ── Defensa en profundidad: este script NUNCA debe correr por HTTP ──
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("forbidden\n");
}

// ── Cargar secretos (están fuera del repo y de public_html) ──
$privatePath = '/home/' . trim(shell_exec('whoami') ?? '') . '/private/higo-banesco.php';
if (!is_file($privatePath)) {
    // Fallback: misma ruta relativa a partir de este script
    $privatePath = dirname(__DIR__, 2) . '/private/higo-banesco.php';
}
if (!is_file($privatePath)) {
    fwrite(STDERR, "[FATAL] No encuentro /private/higo-banesco.php\n");
    exit(1);
}
/** @var array<string,mixed> $config */
$config = require $privatePath;

$logPath = $config['LOG_PATH'] ?? '/tmp/higo-banesco.log';
$lockPath = ($config['LOCK_PATH'] ?? dirname($logPath) . '/banesco-poller.lock');

// ── Lock de concurrencia ──
$lockFp = @fopen($lockPath, 'c');
if (!$lockFp || !flock($lockFp, LOCK_EX | LOCK_NB)) {
    polling_log($logPath, 'run SKIPPED: previous run still active');
    exit(0);
}

// ── Cargar libs ──
require_once __DIR__ . '/banesco-lib/SupabaseClient.php';
require_once __DIR__ . '/banesco-lib/BcvRateClient.php';
require_once __DIR__ . '/banesco-lib/BanescoAuthClient.php';
require_once __DIR__ . '/banesco-lib/BanescoTransactionsClient.php';
require_once __DIR__ . '/banesco-lib/BanescoPayloadNormalizer.php';

$started = microtime(true);
$summary = [
    'started_at'     => gmdate('c'),
    'fetched'        => 0,
    'created'        => 0,
    'duplicate'      => 0,
    'unmatched'      => 0,
    'amount_mismatch'=> 0,
    'normalize_error'=> 0,
    'errors'         => [],
];

try {
    $supa = new SupabaseClient(
        (string) $config['SUPABASE_URL'],
        (string) $config['SUPABASE_SERVICE_ROLE_KEY']
    );

    // 1) Leer estado del poller
    $stateRes = $supa->select('banesco_poll_state?id=eq.1&select=last_cursor');
    if ($stateRes['status'] !== 200 || empty($stateRes['body'])) {
        throw new RuntimeException('No se pudo leer banesco_poll_state');
    }
    $lastCursor = new DateTimeImmutable((string) $stateRes['body'][0]['last_cursor'], new DateTimeZone('UTC'));
    $overlapMin = (int) ($config['POLL_OVERLAP_MIN'] ?? 5);
    $fromDt     = $lastCursor->modify("-{$overlapMin} minutes");
    $toDt       = new DateTimeImmutable('now', new DateTimeZone('UTC'));

    polling_log($logPath, sprintf(
        'run START from=%s to=%s (overlap=%d min)',
        $fromDt->format('c'), $toDt->format('c'), $overlapMin
    ));

    // 2) Obtener tasa BCV (fail-fast si BCV está caído)
    $bcv = new BcvRateClient(
        (string) $config['BCV_RATE_API_URL'],
        $supa,
        $config['BCV_RATE_JSON_PATH'] ?? null,
        (int) ($config['BCV_RATE_TTL_SEC'] ?? 600),
        $logPath
    );
    $rate = $bcv->getRate();
    polling_log($logPath, "BCV rate = {$rate} Bs/USD");

    // 3) Token + fetch transacciones
    $auth = new BanescoAuthClient(
        (string) $config['BANESCO_SSO_URL'],
        (string) $config['BANESCO_CLIENT_ID'],
        (string) $config['BANESCO_CLIENT_SECRET'],
        (string) ($config['BANESCO_TOKEN_CACHE_PATH'] ?? dirname($logPath) . '/banesco-token.json'),
        15,
        $logPath
    );
    $txClient = new BanescoTransactionsClient(
        (string) $config['BANESCO_TX_URL'],
        $auth,
        (string) $config['BANESCO_RIF'],
        (int) ($config['BANESCO_TIMEOUT_SEC'] ?? 30),
        (int) ($config['BANESCO_RETRIES'] ?? 2),
        $logPath
    );
    $transactions = $txClient->fetchRange($fromDt, $toDt);
    $summary['fetched'] = count($transactions);

    // 4) Procesar cada transacción
    $tolerance = (float) ($config['BCV_RATE_TOLERANCE_PCT'] ?? 1.0);
    $maxPaidAt = $lastCursor;

    foreach ($transactions as $tx) {
        $norm = BanescoPayloadNormalizer::normalize($tx);
        if ($norm === null) {
            $summary['normalize_error']++;
            polling_log($logPath, 'normalize FAILED for tx: ' . substr(json_encode($tx), 0, 200));
            // Persistir para inspección
            try {
                $supa->upsert(
                    'banesco_unmatched_payments',
                    [[
                        'reference'   => 'NORM_ERR_' . bin2hex(random_bytes(6)),
                        'raw_payload' => $tx,
                        'status'      => 'normalize_error',
                    ]],
                    'reference'
                );
            } catch (Throwable $e) {
                $summary['errors'][] = 'persist normalize_error: ' . $e->getMessage();
            }
            continue;
        }

        try {
            $res = $supa->rpc('register_membership_from_payment', [
                'p_phone'         => $norm['payer_phone'],
                'p_amount_bs'     => $norm['amount_bs'],
                'p_reference'     => $norm['reference'],
                'p_paid_at'       => $norm['paid_at'],
                'p_channel'       => $norm['channel'],
                'p_bcv_rate'      => $rate,
                'p_tolerance_pct' => $tolerance,
                'p_raw_payload'   => $norm['raw'],
            ]);

            $status = $res['body']['status'] ?? 'unknown';
            if (isset($summary[$status])) {
                $summary[$status]++;
            } else {
                $summary['errors'][] = "unexpected status {$status} for ref {$norm['reference']}";
            }

            polling_log($logPath, sprintf(
                'tx ref=%s channel=%s amount=%s → %s',
                $norm['reference'], $norm['channel'], $norm['amount_bs'], $status
            ));

            // Avanzar cursor al paid_at más reciente procesado exitosamente
            $paidAt = new DateTimeImmutable($norm['paid_at']);
            if ($paidAt > $maxPaidAt) {
                $maxPaidAt = $paidAt;
            }
        } catch (Throwable $e) {
            $summary['errors'][] = 'rpc: ' . $e->getMessage();
            polling_log($logPath, 'rpc ERROR for ref ' . $norm['reference'] . ': ' . $e->getMessage());
        }
    }

    // 5) Actualizar cursor solo si no hubo errores fatales
    //    Si alguna tx explotó, dejamos last_cursor como estaba para reintentar
    //    la ventana completa en el próximo run.
    if (empty($summary['errors'])) {
        $supa->update(
            'banesco_poll_state',
            'id=eq.1',
            [
                'last_cursor'     => $maxPaidAt->format('c'),
                'last_run_at'     => gmdate('c'),
                'last_run_result' => $summary,
            ]
        );
    } else {
        $supa->update(
            'banesco_poll_state',
            'id=eq.1',
            [
                'last_run_at'     => gmdate('c'),
                'last_run_result' => $summary,
            ]
        );
    }

    $elapsed = round(microtime(true) - $started, 2);
    polling_log($logPath, sprintf(
        'run END in %ss · fetched=%d created=%d dup=%d unmatched=%d mismatch=%d normErr=%d err=%d',
        $elapsed,
        $summary['fetched'], $summary['created'], $summary['duplicate'],
        $summary['unmatched'], $summary['amount_mismatch'],
        $summary['normalize_error'], count($summary['errors'])
    ));
} catch (Throwable $e) {
    polling_log($logPath, '[FATAL] ' . $e->getMessage());
    // Registrar el error en banesco_poll_state para que sea visible desde admin
    try {
        if (isset($supa)) {
            $supa->update(
                'banesco_poll_state',
                'id=eq.1',
                [
                    'last_run_at'     => gmdate('c'),
                    'last_run_result' => array_merge($summary, ['fatal' => $e->getMessage()]),
                ]
            );
        }
    } catch (Throwable $_) {
        // swallow; ya logueamos arriba
    }
    exit(1);
} finally {
    if (isset($lockFp) && is_resource($lockFp)) {
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }
}

function polling_log(string $path, string $msg): void
{
    @file_put_contents(
        $path,
        '[' . gmdate('c') . '] ' . $msg . "\n",
        FILE_APPEND
    );
}
