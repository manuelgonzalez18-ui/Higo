<?php
/**
 * Shared CORS policy for public/api/*.php.
 *
 * Production origins are explicit. Preview access is limited to Vercel hosts
 * generated for the Higo project in the owner's account; arbitrary
 * *.vercel.app origins are never accepted.
 */

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit('forbidden');
}

function api_apply_cors(array $cfg, string $methods = 'POST, OPTIONS', array $extraHdrs = []): void {
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');

    $hardcodedAllowed = [
        'https://higoapp.com',
        'https://www.higoapp.com',
        'https://higodriver.com',
        'https://www.higodriver.com',
        'capacitor://localhost',
        'https://localhost',
        'http://localhost',
        'http://localhost:5173',
        'http://localhost:5174',
    ];

    $configuredAllowed = array_values(array_filter(array_map(
        static fn($value) => rtrim(trim((string) $value), '/'),
        (array) ($cfg['HIGOPAY_ALLOWED_ORIGINS'] ?? [])
    )));
    $allowed = array_unique(array_merge($hardcodedAllowed, $configuredAllowed));

    $isHigoVercelPreview = $origin !== ''
        && preg_match(
            '#^https://higo(?:-[a-z0-9-]+)*-manuelgonzalez18-uis-projects\.vercel\.app$#i',
            $origin
        ) === 1;

    $isAllowed = $origin !== ''
        && (in_array(rtrim($origin, '/'), $allowed, true) || $isHigoVercelPreview);

    if ($isAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        $hdrList = array_merge(['Content-Type', 'Authorization'], $extraHdrs);
        header('Access-Control-Allow-Headers: ' . implode(', ', array_unique($hdrList)));
        header('Access-Control-Allow-Methods: ' . $methods);
        header('Access-Control-Max-Age: 600');
    } elseif ($origin !== '') {
        error_log(sprintf(
            '[CORS] Rejected origin "%s" on %s (UA: %s, IP: %s)',
            $origin,
            $_SERVER['REQUEST_URI'] ?? '?',
            substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? '-'), 0, 100),
            $_SERVER['REMOTE_ADDR'] ?? '-'
        ));
    }

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code($isAllowed ? 204 : 403);
        exit;
    }

    if ($origin !== '' && !$isAllowed) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'origin_not_allowed']);
        exit;
    }
}
