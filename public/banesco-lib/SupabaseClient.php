<?php
/**
 * SupabaseClient — wrapper mínimo sobre cURL para llamar a la REST API
 * de Supabase con el service_role key. No reemplaza supabase-php; solo
 * lo necesario para invocar RPCs y hacer updates puntuales desde el
 * poller de Banesco.
 *
 * NO usar en código servido a cliente: el service_role key bypasea RLS.
 */

final class SupabaseClient
{
    private string $url;
    private string $serviceKey;
    private int $timeoutSec;

    public function __construct(string $url, string $serviceKey, int $timeoutSec = 15)
    {
        $this->url = rtrim($url, '/');
        $this->serviceKey = $serviceKey;
        $this->timeoutSec = $timeoutSec;
    }

    /**
     * Invoca un RPC de Postgres expuesto vía PostgREST.
     * @return array ['status' => int, 'body' => mixed decodificado o string]
     */
    public function rpc(string $functionName, array $params = []): array
    {
        return $this->request(
            'POST',
            "/rest/v1/rpc/{$functionName}",
            $params
        );
    }

    /**
     * PATCH/UPDATE sobre una tabla con filtros PostgREST (?id=eq.1 etc).
     */
    public function update(string $table, string $filter, array $values): array
    {
        return $this->request(
            'PATCH',
            "/rest/v1/{$table}?{$filter}",
            $values
        );
    }

    /**
     * Upsert idempotente (ON CONFLICT DO UPDATE) con Prefer: resolution=merge-duplicates.
     */
    public function upsert(string $table, array $values, string $onConflict): array
    {
        return $this->request(
            'POST',
            "/rest/v1/{$table}?on_conflict={$onConflict}",
            $values,
            ['Prefer: resolution=merge-duplicates', 'Prefer: return=representation']
        );
    }

    /**
     * SELECT simple con filtros PostgREST.
     */
    public function select(string $path): array
    {
        return $this->request('GET', "/rest/v1/{$path}", null);
    }

    private function request(string $method, string $path, $body, array $extraHeaders = []): array
    {
        $ch = curl_init($this->url . $path);
        $headers = array_merge([
            'apikey: ' . $this->serviceKey,
            'Authorization: Bearer ' . $this->serviceKey,
            'Content-Type: application/json',
            'Accept: application/json',
        ], $extraHeaders);

        $opts = [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeoutSec,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }
        curl_setopt_array($ch, $opts);

        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("Supabase request failed: {$err}");
        }

        $decoded = json_decode($raw, true);
        return [
            'status' => (int) $status,
            'body'   => $decoded !== null ? $decoded : $raw,
        ];
    }
}
