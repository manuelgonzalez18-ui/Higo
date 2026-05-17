<?php
/**
 * _ratelimit.php
 * Token bucket compartido para endpoints PHP. Persistido en archivos
 * JSON dentro de sys_get_temp_dir() porque Hostinger no expone Redis ni
 * APCu en planes compartidos. Una entrada por (bucket, IP).
 *
 * El "bucket" es un identificador estable del endpoint (ej.
 * "banesco-validate"). Si querés rate-limit más fino podés combinarlo
 * con el user id en el lado del endpoint antes de llamar.
 *
 * Devuelve HTTP 429 con header Retry-After y JSON cuando se excede el
 * cupo del minuto en curso.
 *
 * Trade-off conocido: ventana fija de 60s (no sliding). Cuando termina
 * la ventana, el contador se resetea de golpe; un atacante puede mandar
 * 2 * max al filo del segundo 59→00. Para nuestro modelo de amenazas
 * (brute-force de referencias bancarias) es suficiente; si en el futuro
 * se vuelve insuficiente, se puede pasar a sliding window real.
 */

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit('forbidden');
}

/**
 * @param string $bucket    identificador del endpoint, ej. 'banesco-validate'
 * @param int    $maxPerMin requests permitidos por minuto y por IP
 * @param string|null $logFile path donde appendear los 429s para auditar
 */
function api_rate_limit(string $bucket, int $maxPerMin, ?string $logFile = null): void {
    $ip  = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    // Si está detrás de un proxy/Cloudflare, preferimos el header real.
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = (string) $_SERVER['HTTP_CF_CONNECTING_IP'];
    } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ip = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    }

    $key  = preg_replace('/[^a-z0-9_-]/i', '_', $bucket . '_' . $ip);
    $dir  = sys_get_temp_dir() . '/higo_ratelimit';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $path = $dir . '/' . $key . '.json';
    $now  = time();

    $state = ['count' => 0, 'window_start' => $now];
    if (is_file($path)) {
        $raw    = @file_get_contents($path);
        $parsed = $raw ? json_decode($raw, true) : null;
        if (is_array($parsed)) {
            $state = $parsed + $state;
        }
    }

    // Ventana de 60s vencida: reset.
    if ($now - (int) $state['window_start'] >= 60) {
        $state = ['count' => 0, 'window_start' => $now];
    }

    if ((int) $state['count'] >= $maxPerMin) {
        $retry = 60 - ($now - (int) $state['window_start']);
        if ($retry < 1) $retry = 1;
        if ($logFile !== null) {
            @file_put_contents(
                $logFile,
                sprintf(
                    "[%s] 429 %s ip=%s bucket=%s count=%d max=%d\n",
                    date('c'),
                    $_SERVER['REQUEST_URI'] ?? '?',
                    $ip,
                    $bucket,
                    (int) $state['count'],
                    $maxPerMin
                ),
                FILE_APPEND
            );
        }
        http_response_code(429);
        header('Retry-After: ' . $retry);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok'          => false,
            'error'       => 'rate_limited',
            'retry_after' => $retry,
        ]);
        exit;
    }

    $state['count']++;
    @file_put_contents($path, json_encode($state), LOCK_EX);
}
