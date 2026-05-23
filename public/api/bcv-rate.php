<?php
declare(strict_types=1);

/**
 * api/bcv-rate.php — Devuelve la tasa oficial USD→Bs del BCV.
 *
 * Fuente: https://ve.dolarapi.com/v1/dolares/oficial
 * Cache:  archivo en /tmp · TTL 1h. Evita martillar dolarapi en cada
 *         carga de Higo Pay. Si la fuente falla, devuelve el último
 *         cache aunque esté vencido (graceful degradation).
 *
 * No requiere autenticación: la tasa es información pública.
 *
 * Respuesta:
 *   { ok: true, rate: 36.42, source: "BCV via dolarapi",
 *     fetchedAt: "2026-04-25T18:30:00Z", cached: false }
 *   { ok: false, errorMessage: "..." }
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

const BCV_URL        = 'https://ve.dolarapi.com/v1/dolares/oficial';
const BCV_CACHE_TTL  = 3600; // 1 hora

// Detección dinámica de carpeta temporal portable en Linux/Windows/Hostinger
$bcv_temp_dir   = (is_dir('/tmp') && is_writable('/tmp')) ? '/tmp' : sys_get_temp_dir();
$bcv_cache_file = $bcv_temp_dir . '/higo-bcv-rate.json';
$bcv_ratelimit_file = $bcv_temp_dir . '/higo_ratelimit.log';

function bcv_send(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=300'); // browser puede cachear 5 min
    echo (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// CORS: aunque la tasa BCV es info pública (la fuente dolarapi.com es
// abierta), restringimos a nuestros dominios para no servir de cache
// gratis a terceros. Quien quiera la tasa puede ir directo al origen.
try {
    $_cfg_cors = function_exists('bl_load_config') ? bl_load_config() : [];
} catch (Throwable $e) {
    $_cfg_cors = [];
}
api_apply_cors($_cfg_cors, 'GET, OPTIONS');
api_rate_limit('bcv-rate', 60, $bcv_ratelimit_file);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// 1. Intentar servir desde cache fresco.
if (is_file($bcv_cache_file)) {
    $age = time() - (int) @filemtime($bcv_cache_file);
    if ($age < BCV_CACHE_TTL) {
        $cached = @json_decode((string) @file_get_contents($bcv_cache_file), true);
        if (is_array($cached) && !empty($cached['rate'])) {
            $cached['cached'] = true;
            bcv_send(200, $cached);
        }
    }
}

// 2. Cache vencido o ausente: ir a la fuente.
try {
    [$status, $body] = bl_http_get(BCV_URL, ['Accept: application/json'], 10);
    if ($status !== 200) {
        throw new RuntimeException("dolarapi HTTP {$status}");
    }
    $data = json_decode($body, true);
    if (!is_array($data) || !isset($data['promedio']) || !is_numeric($data['promedio'])) {
        throw new RuntimeException('dolarapi sin campo promedio numérico');
    }

    $payload = [
        'ok'        => true,
        'rate'      => (float) $data['promedio'],
        'source'    => 'BCV via dolarapi',
        'fetchedAt' => $data['fechaActualizacion'] ?? gmdate('c'),
        'cached'    => false,
    ];
    @file_put_contents($bcv_cache_file, json_encode($payload));
    bcv_send(200, $payload);
} catch (Throwable $e) {
    // 3. Fallback: si tenemos cache vencido, servirlo igual antes que nada.
    if (is_file($bcv_cache_file)) {
        $stale = @json_decode((string) @file_get_contents($bcv_cache_file), true);
        if (is_array($stale) && !empty($stale['rate'])) {
            $stale['cached'] = true;
            $stale['stale']  = true;
            $stale['warning'] = 'Fuente BCV no respondió, usando último cache.';
            bcv_send(200, $stale);
        }
    }
    bcv_send(502, ['ok' => false, 'errorMessage' => 'No se pudo obtener tasa BCV: ' . $e->getMessage()]);
}
