<?php
/**
 * PLANTILLA de /home/<user>/private/higo-banesco.php
 *
 * Este archivo NO va en public_html ni en el repo. Copialo a
 *   /home/<user>/private/higo-banesco.php
 * con SFTP, completá los valores reales, y dejalo con permisos 600:
 *
 *   chmod 600 /home/<user>/private/higo-banesco.php
 *
 * El poller lo lee via require_once al arrancar.
 */

return [
    // ── Supabase (service_role: bypasea RLS — NO usar en cliente) ──
    'SUPABASE_URL'               => 'https://YOUR_PROJECT.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY'  => 'eyJhbGciOiJIUzI1NiIsInR5cCI6...',

    // ── Banesco: API de "Confirmación de Transacciones" ──
    'BANESCO_SSO_URL'            => 'https://sso-sso-project.apps.proplakur.banesco.com/auth/realms/realm-api-prd/protocol/openid-connect/token',
    'BANESCO_TX_URL'             => 'https://sid-validador-consulta-de-transacciones-3scale-apicast-61e25ec.apps.proplakur.banesco.com/financial-account/transactions',
    'BANESCO_CLIENT_ID'          => 'YOUR_CLIENT_ID',
    'BANESCO_CLIENT_SECRET'      => 'YOUR_CLIENT_SECRET',
    'BANESCO_RIF'                => 'JXXXXXXXXX',
    'BANESCO_TIMEOUT_SEC'        => 30,
    'BANESCO_RETRIES'            => 2,
    'BANESCO_TOKEN_CACHE_PATH'   => '/home/YOUR_HOSTINGER_USER/private/banesco-token.json',

    // ── BCV: endpoint que devuelve la tasa oficial del día ──
    'BCV_RATE_API_URL'           => 'https://ve.dolarapi.com/v1/dolares/oficial',
    // Si el JSON trae la tasa en una ruta anidada, indicala con notación de puntos.
    // Ejemplo: 'rates.usd'. Dejar null para autodetectar (price|rate|usd|tasa...).
    'BCV_RATE_JSON_PATH'         => null,
    'BCV_RATE_TTL_SEC'           => 600,      // cache 10 min
    'BCV_RATE_TOLERANCE_PCT'     => 1.0,      // ±1% sobre monto esperado

    // ── Estado del poller ──
    'POLL_OVERLAP_MIN'           => 5,        // overlap de seguridad al consultar tx

    // ── Archivos privados ──
    'LOG_PATH'                   => '/home/YOUR_HOSTINGER_USER/private/higo-banesco.log',
    'LOCK_PATH'                  => '/home/YOUR_HOSTINGER_USER/private/banesco-poller.lock',
];
