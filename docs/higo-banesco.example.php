<?php
/**
 * PLANTILLA del config de Banesco para Higo.
 *
 * ESTE ARCHIVO NO SE DEPLOYA (vive en docs/, Vite no lo toca).
 * Es solo una referencia para que copies su contenido a:
 *
 *   /home/<TU_HOSTINGER_USER>/private/higo-banesco.php
 *
 * OJO: esa ruta /private/ va FUERA de public_html/, a nivel del home.
 * NO la pongas dentro de public_html/private/ — eso es accesible por web.
 *
 * Cómo subirlo:
 *   1. File Manager de Hostinger → click en tu user (breadcrumb top-left).
 *   2. Si no existe, crear carpeta "private" al mismo nivel que public_html.
 *   3. Adentro de esa carpeta "private", crear archivo higo-banesco.php.
 *   4. Pegar el contenido de abajo y reemplazar los placeholders con los
 *      valores reales de Banesco.
 *   5. Permisos 600 si tu hosting lo permite (via SSH: chmod 600 ...).
 *
 * Lo consume:
 *   public_html/banesco-diagnostic.php  (diagnóstico CLI)
 *   public_html/banesco-lookup.php      (UI de diagnóstico web)
 *   public_html/banesco-validate.php    (endpoint server-to-server del SPA)
 */

return [
    // ── Banesco: API de "Confirmación de Transacciones" ────────────────
    // Endpoints del SSO Keycloak y del validador. En producción son fijos.
    'BANESCO_SSO_URL' => 'https://sso-sso-project.apps.proplakur.banesco.com/auth/realms/realm-api-prd/protocol/openid-connect/token',
    'BANESCO_TX_URL'  => 'https://sid-validador-consulta-de-transacciones-3scale-apicast-61e25ec.apps.proplakur.banesco.com/financial-account/transactions',

    // Credenciales que Banesco asignó al RIF de Higo (J402638850).
    // Van DOS veces en cada auth: como username/password en el body
    // (grant_type=password) Y como Basic Auth en el header. El script se
    // encarga de armar ambos desde estos dos valores.
    //
    // ⚠️ ROTAR con Banesco antes de go-live si se usaron en chats/logs.
    'BANESCO_CLIENT_ID'     => 'REEMPLAZAR_CON_EL_CLIENT_ID',
    'BANESCO_CLIENT_SECRET' => 'REEMPLAZAR_CON_EL_CLIENT_SECRET',

    // Cuenta destino Banesco de Higo — 20 dígitos, arranca con "0134".
    // Confirmada en los logs de wifirapidito como 01340332563321061868.
    'BANESCO_ACCOUNT_ID' => '01340332563321061868',

    // Banco default para queries cuando no se pasa --bank por CLI.
    // Dejar "0134" (Banesco) como default; el CLI pisa con --bank=0102
    // (BDV), 0105 (Mercantil), 0108 (Provincial), etc según el origen
    // del pago móvil que querés validar.
    'BANESCO_BANK_ID' => '0134',

    // RIF del titular (meramente cosmético en el lookup UI).
    'BANESCO_RIF' => 'J402638850',

    // ── Herramienta de diagnóstico web (banesco-lookup.php) ────────────
    // Si está vacío o no existe, la UI queda deshabilitada (503).
    // Si está seteado, el acceso a higoapp.com/banesco-lookup.php pide
    // HTTP Basic Auth: user libre, password = este valor.
    //
    // Elegí algo largo y único (no reciclado). Ejemplo:
    //   'DIAG_PASSWORD' => 'k9Z-higo-diag-ab3f7x2q',
    'DIAG_PASSWORD' => '',

    // Dónde se escribe el log de requests/responses del lookup.
    // Si se deja en null/ausente, se usa el default:
    //   /home/<user>/private/higo-banesco-diag.log
    'DIAG_LOG_PATH' => null,

    // ── Validación automática de pagos (banesco-validate.php) ──────────
    // El endpoint corre del lado del servidor, recibe POST JSON desde el
    // SPA con un Authorization: Bearer <Supabase JWT>, verifica firma,
    // calcula BCV, consulta Banesco y llama a la RPC con service_role.
    //
    // SUPABASE_JWT_SECRET = el "JWT Secret" del proyecto en Supabase
    //   (Project Settings → API → JWT Secret). 32+ chars random. NO es
    //   la anon key — es la clave HS256 con la que se firman los JWT.
    //
    // SUPABASE_SERVICE_ROLE_KEY = la "service_role" key (Project Settings
    //   → API). NUNCA va al cliente. Sólo vive en este archivo y la usa
    //   PHP para llamar a las RPC restringidas a service_role.
    'SUPABASE_URL'                => 'https://YOURPROJECT.supabase.co',
    'SUPABASE_JWT_SECRET'         => 'REEMPLAZAR_CON_EL_JWT_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY'   => 'REEMPLAZAR_CON_EL_SERVICE_ROLE_KEY',

    // Fuente del BCV (Bs por USD). El default funciona; si algún día se
    // cae se puede pivotear a otra. La respuesta se cachea localmente
    // en sys_get_temp_dir() por BCV_TTL_SECONDS para no martillar.
    'BCV_API_URL'      => 'https://ve.dolarapi.com/v1/dolares/oficial',
    'BCV_TTL_SECONDS'  => 1800,

    // Tolerancia entre el monto que reportó Banesco y el monto esperado
    // (price_usd × BCV). 2% absorbe redondeos del banco emisor pero
    // no es tan ancho como para aceptar una transferencia distinta.
    'AMOUNT_TOLERANCE_PCT' => 2.0,
];
