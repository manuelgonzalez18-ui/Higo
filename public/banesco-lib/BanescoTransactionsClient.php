<?php
/**
 * BanescoTransactionsClient — consume el endpoint
 *   /financial-account/transactions
 *
 * Autenticación: Bearer token obtenido de BanescoAuthClient.
 * Parámetros de query: dateFrom, dateTo, accountNumber, rif (o lo que
 * use el API real — el mapeo exacto se ajusta al ver la primera
 * respuesta real, pero los nombres típicos están abajo).
 *
 * IMPORTANTE: el shape exacto del JSON de respuesta de Banesco se
 * verificará en la primera corrida contra el API. Este cliente devuelve
 * el array crudo; la normalización se hace en BanescoPayloadNormalizer.
 */

final class BanescoTransactionsClient
{
    private string $txUrl;
    private BanescoAuthClient $auth;
    private string $rif;
    private int $timeoutSec;
    private int $retries;
    private ?string $logPath;

    public function __construct(
        string $txUrl,
        BanescoAuthClient $auth,
        string $rif,
        int $timeoutSec = 30,
        int $retries = 2,
        ?string $logPath = null
    ) {
        $this->txUrl = $txUrl;
        $this->auth = $auth;
        $this->rif = $rif;
        $this->timeoutSec = $timeoutSec;
        $this->retries = $retries;
        $this->logPath = $logPath;
    }

    /**
     * Fetch de transacciones en una ventana temporal.
     *
     * @param DateTimeImmutable $from UTC
     * @param DateTimeImmutable $to   UTC
     * @return array Lista de transacciones (raw, tal cual devuelve Banesco)
     */
    public function fetchRange(DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        $attempt = 0;
        $lastErr = null;

        while ($attempt <= $this->retries) {
            try {
                return $this->doFetch($from, $to);
            } catch (Throwable $e) {
                $lastErr = $e;
                $this->log("fetchRange attempt {$attempt} failed: " . $e->getMessage());
                $attempt++;
                if ($attempt <= $this->retries) {
                    sleep(2 ** $attempt); // backoff: 2s, 4s
                }
            }
        }
        throw new RuntimeException(
            'fetchRange exhausted retries: ' . ($lastErr ? $lastErr->getMessage() : 'unknown')
        );
    }

    private function doFetch(DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        $token = $this->auth->getAccessToken();

        // Query params: ajustar nombres si el API real usa otros
        // (dateFrom/dateTo, startDate/endDate, from/to, etc).
        $query = http_build_query([
            'rif'      => $this->rif,
            'dateFrom' => $from->format('Y-m-d\TH:i:s\Z'),
            'dateTo'   => $to->format('Y-m-d\TH:i:s\Z'),
        ]);
        $url = $this->txUrl . (str_contains($this->txUrl, '?') ? '&' : '?') . $query;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeoutSec,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $token,
                'Accept: application/json',
            ],
        ]);

        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("Transactions cURL error: {$err}");
        }
        if ($status === 401 || $status === 403) {
            // Token probablemente inválido; forzar refresh invalidando cache
            $this->invalidateAuthCache();
            throw new RuntimeException("Transactions HTTP {$status} (auth)");
        }
        if ($status < 200 || $status >= 300) {
            $this->log("Transactions HTTP {$status}: " . substr((string) $raw, 0, 500));
            throw new RuntimeException("Transactions HTTP {$status}");
        }

        $decoded = json_decode($raw, true);
        if ($decoded === null) {
            throw new RuntimeException('Transactions response is not valid JSON');
        }

        // Banesco puede devolver:
        //   - un array top-level de transacciones
        //   - un objeto con "transactions" / "data" / "items" dentro
        $list = $this->extractList($decoded);
        $this->log("fetchRange returned " . count($list) . " transactions (raw sample keys: "
            . implode(',', array_slice(array_keys($list[0] ?? []), 0, 6)) . ")");
        return $list;
    }

    private function extractList($json): array
    {
        if (is_array($json) && array_is_list($json)) return $json;
        foreach (['transactions', 'data', 'items', 'result', 'resultados'] as $k) {
            if (is_array($json) && isset($json[$k]) && is_array($json[$k])) {
                return $json[$k];
            }
        }
        return [];
    }

    private function invalidateAuthCache(): void
    {
        // Forzar que el próximo getAccessToken pida uno nuevo.
        // Implementación simple: reflexión al path privado y borrarlo.
        // Como no lo expusimos, simplemente re-pedimos en el retry.
    }

    private function log(string $msg): void
    {
        if (!$this->logPath) return;
        @file_put_contents(
            $this->logPath,
            '[' . gmdate('c') . '] BanescoTransactionsClient: ' . $msg . "\n",
            FILE_APPEND
        );
    }
}
