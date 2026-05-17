<?php
/**
 * _cors.php
 * Helper compartido para aplicar whitelist CORS a todos los endpoints de
 * public/api/*.php. Reemplaza el patrón "Access-Control-Allow-Origin: *"
 * que tenían heredado los endpoints viejos.
 *
 * Lee HIGOPAY_ALLOWED_ORIGINS del config privado (mismo array que ya usa
 * banesco-validate.php). Si el Origin del request no está en la whitelist:
 *   - Si es un preflight OPTIONS, devuelve 403 sin headers CORS.
 *   - Si es un request real con Origin, devuelve 403 + JSON error.
 *   - Si es un request server-to-server (sin Origin, ej. cron), pasa
 *     limpio. La autenticación posterior (Bearer JWT, X-Cron-Secret) es
 *     la responsable de cortar.
 *
 * Loggea origenes rechazados a error_log para detectar abuso y permitir
 * agregar nuevos dominios legítimos al whitelist sin sorpresas.
 */

// Hardening: este archivo SOLO debe incluirse desde otros .php, nunca
// servirse directo. Si alguien lo pide vía HTTP, 403.
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit('forbidden');
}

/**
 * Aplica los headers CORS y corta el preflight OPTIONS si corresponde.
 *
 * @param array  $cfg        config cargado por bl_load_config()
 * @param string $methods    métodos permitidos, ej. "POST, OPTIONS" o "GET, OPTIONS"
 * @param array  $extraHdrs  headers extra permitidos además de Content-Type y Authorization
 */
function api_apply_cors(array $cfg, string $methods = 'POST, OPTIONS', array $extraHdrs = []): void {
    $origin    = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $allowed   = (array) ($cfg['HIGOPAY_ALLOWED_ORIGINS'] ?? []);
    $isAllowed = $origin !== '' && in_array($origin, $allowed, true);

    if ($isAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        $hdrList = array_merge(['Content-Type', 'Authorization'], $extraHdrs);
        header('Access-Control-Allow-Headers: ' . implode(', ', $hdrList));
        header('Access-Control-Allow-Methods: ' . $methods);
        header('Access-Control-Max-Age: 600');
    } elseif ($origin !== '') {
        // Solo loggeamos requests con Origin presente y no permitido.
        // Los sin Origin (curl, cron, server-to-server) NO son abuso.
        error_log(sprintf(
            '[CORS] Rejected origin "%s" on %s (UA: %s, IP: %s)',
            $origin,
            $_SERVER['REQUEST_URI'] ?? '?',
            substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? '-'), 0, 100),
            $_SERVER['REMOTE_ADDR'] ?? '-'
        ));
    }

    // Preflight: cortar acá.
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code($isAllowed ? 204 : 403);
        exit;
    }

    // Request real con Origin no whitelisted: 403 inmediato.
    // Sin Origin pasa (server-to-server lo maneja su propia auth).
    if ($origin !== '' && !$isAllowed) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'origin_not_allowed']);
        exit;
    }
}
