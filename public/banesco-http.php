<?php
declare(strict_types=1);
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) { http_response_code(403); exit; }

/**
 * $verifyTls solo debe ser false para los endpoints de Banesco (cert
 * interno firmado por CA privada). Todo lo demás (Supabase, FCM,
 * dolarapi) verifica el cert: estos requests llevan service_role keys y
 * JWTs que un MITM podría capturar.
 *
 * @return array{0:int,1:string} [http status, body]
 */
function bl_http_post(string $url, string $body, array $headers, int $timeout = 30, bool $verifyTls = true): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => $verifyTls,
        CURLOPT_SSL_VERIFYHOST => $verifyTls ? 2 : 0,
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
function bl_http_get(string $url, array $headers, int $timeout = 15, bool $verifyTls = true): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => $verifyTls,
        CURLOPT_SSL_VERIFYHOST => $verifyTls ? 2 : 0,
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
 * PATCH cURL — usado por endpoints que necesitan UPDATEs parciales
 * contra Supabase (PostgREST). Mismo timeout/SSL profile que bl_http_post.
 *
 * @return array{0:int,1:string}
 */
function bl_http_patch(string $url, string $body, array $headers, int $timeout = 30, bool $verifyTls = true): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => $verifyTls,
        CURLOPT_SSL_VERIFYHOST => $verifyTls ? 2 : 0,
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


