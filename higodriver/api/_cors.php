<?php
/**
 * higodriver/api/_cors.php
 *
 * Helper CORS para los endpoints del subdominio higodriver.com.
 * Espejo simplificado de public/api/_cors.php (que vive en el hosting
 * de higoapp.com). Acá la whitelist es FIJA porque el form de
 * registro de chofer solo se carga desde higodriver.com — no hay
 * razón para parametrizarla via config.
 *
 * Reemplaza el patrón Access-Control-Allow-Origin: * que tenia el
 * register-driver heredado.
 *
 * Si el Origin del request no esta en la whitelist:
 *   - Si es preflight OPTIONS, devuelve 403 sin headers CORS.
 *   - Si es request real con Origin, devuelve 403 + JSON error.
 *   - Si es request sin Origin (curl, server-to-server), pasa limpio
 *     y la auth posterior corta si corresponde. El form publico SIEMPRE
 *     manda Origin desde el browser, asi que esto solo aplica a llamados
 *     de scripts internos.
 *
 * Loggea rechazos a error_log para detectar abuso.
 */

// Hardening: este archivo SOLO debe incluirse desde otros .php. Si
// alguien lo pide via HTTP, 403.
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit('forbidden');
}

/**
 * Aplica los headers CORS y corta el preflight OPTIONS si corresponde.
 *
 * @param string $methods    metodos permitidos, ej. "POST, OPTIONS"
 * @param array  $extraHdrs  headers extra permitidos ademas de Content-Type
 */
function hd_apply_cors(string $methods = 'POST, OPTIONS', array $extraHdrs = []): void {
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');

    // Whitelist hardcoded. higodriver.com es el unico origen legitimo
    // para los endpoints de este subdirectorio (form publico de
    // registro de chofer). Cubrimos con/sin www. y los entornos de
    // dev (Capacitor WebView + Vite dev server) por consistencia con
    // public/api/_cors.php.
    $allowed = [
        'https://higodriver.com',
        'https://www.higodriver.com',
        'capacitor://localhost',
        'http://localhost',
        'http://localhost:5173',
        'http://localhost:5174',
    ];
    $isAllowed = $origin !== '' && in_array($origin, $allowed, true);

    if ($isAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        $hdrList = array_merge(['Content-Type'], $extraHdrs);
        header('Access-Control-Allow-Headers: ' . implode(', ', $hdrList));
        header('Access-Control-Allow-Methods: ' . $methods);
        header('Access-Control-Max-Age: 600');
    } elseif ($origin !== '') {
        // Solo loggeamos requests con Origin presente y rechazado.
        // Sin Origin (curl, cron, server-to-server) NO es abuso.
        error_log(sprintf(
            '[higodriver CORS] Rejected origin "%s" on %s (UA: %s, IP: %s)',
            $origin,
            $_SERVER['REQUEST_URI'] ?? '?',
            substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? '-'), 0, 100),
            $_SERVER['REMOTE_ADDR'] ?? '-'
        ));
    }

    // Preflight: cortar aca.
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
