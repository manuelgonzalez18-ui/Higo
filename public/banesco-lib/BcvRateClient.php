<?php
/**
 * BcvRateClient — obtiene la tasa oficial BCV (Bs/USD) y la cachea
 * en bcv_rate_cache de Supabase para que la SPA y el poller lean
 * el mismo valor.
 *
 * La URL del endpoint y el shape del JSON se configuran desde
 * /private/higo-banesco.php (BCV_RATE_API_URL).
 *
 * Estrategia de resolución del rate en el JSON:
 *   1. Si el config trae BCV_RATE_JSON_PATH (ej "rates.usd"),
 *      se evalúa ese path con notación de puntos.
 *   2. Sino, se buscan keys comunes: "price", "rate", "usd",
 *      "tasa", "dolar", "promedio".
 *   3. Si nada matchea, se toma el primer valor numérico del JSON.
 */

final class BcvRateClient
{
    private string $apiUrl;
    private ?string $jsonPath;
    private int $ttlSec;
    private SupabaseClient $supa;
    private ?string $logPath;

    public function __construct(
        string $apiUrl,
        SupabaseClient $supa,
        ?string $jsonPath = null,
        int $ttlSec = 600,
        ?string $logPath = null
    ) {
        $this->apiUrl  = $apiUrl;
        $this->supa    = $supa;
        $this->jsonPath = $jsonPath;
        $this->ttlSec  = $ttlSec;
        $this->logPath = $logPath;
    }

    /**
     * Devuelve la tasa actual. Usa cache si es fresco; sino fetchea,
     * persiste en Supabase y retorna el valor nuevo.
     *
     * @return float Bs por USD
     * @throws RuntimeException si no hay tasa fresca ni se puede fetchear
     */
    public function getRate(): float
    {
        $cached = $this->readCache();
        if ($cached !== null) {
            return $cached;
        }

        $fresh = $this->fetchFromApi();
        $this->writeCache($fresh);
        return $fresh;
    }

    private function readCache(): ?float
    {
        try {
            $res = $this->supa->select('bcv_rate_cache?id=eq.1&select=rate,fetched_at');
            if ($res['status'] !== 200 || !is_array($res['body']) || empty($res['body'])) {
                return null;
            }
            $row = $res['body'][0];
            $fetchedAt = strtotime($row['fetched_at'] ?? '');
            if (!$fetchedAt || (time() - $fetchedAt) > $this->ttlSec) {
                return null; // cache vencido
            }
            return (float) $row['rate'];
        } catch (Throwable $e) {
            $this->log('readCache error: ' . $e->getMessage());
            return null;
        }
    }

    private function writeCache(float $rate): void
    {
        try {
            $this->supa->upsert(
                'bcv_rate_cache',
                [[
                    'id'         => 1,
                    'rate'       => $rate,
                    'fetched_at' => gmdate('c'),
                ]],
                'id'
            );
        } catch (Throwable $e) {
            $this->log('writeCache error: ' . $e->getMessage());
        }
    }

    private function fetchFromApi(): float
    {
        $ch = curl_init($this->apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $status >= 400) {
            throw new RuntimeException("BCV fetch failed (HTTP {$status}): {$err}");
        }
        $decoded = json_decode($raw, true);
        if ($decoded === null) {
            throw new RuntimeException('BCV response is not valid JSON');
        }

        $rate = $this->extractRate($decoded);
        if ($rate === null || $rate <= 0) {
            throw new RuntimeException('BCV rate not found in response');
        }
        return $rate;
    }

    private function extractRate($json): ?float
    {
        if ($this->jsonPath) {
            $v = $this->resolvePath($json, $this->jsonPath);
            if (is_numeric($v)) return (float) $v;
        }
        $candidates = ['price', 'rate', 'usd', 'tasa', 'dolar', 'promedio', 'bcv'];
        foreach ($candidates as $key) {
            if (is_array($json) && isset($json[$key]) && is_numeric($json[$key])) {
                return (float) $json[$key];
            }
        }
        // Último recurso: primer valor numérico del JSON
        return $this->firstNumeric($json);
    }

    private function resolvePath($json, string $path)
    {
        $parts = explode('.', $path);
        $cur = $json;
        foreach ($parts as $p) {
            if (is_array($cur) && array_key_exists($p, $cur)) {
                $cur = $cur[$p];
            } else {
                return null;
            }
        }
        return $cur;
    }

    private function firstNumeric($json): ?float
    {
        if (is_numeric($json)) return (float) $json;
        if (is_array($json)) {
            foreach ($json as $v) {
                $r = $this->firstNumeric($v);
                if ($r !== null) return $r;
            }
        }
        return null;
    }

    private function log(string $msg): void
    {
        if (!$this->logPath) return;
        @file_put_contents(
            $this->logPath,
            '[' . gmdate('c') . '] BcvRateClient: ' . $msg . "\n",
            FILE_APPEND
        );
    }
}
