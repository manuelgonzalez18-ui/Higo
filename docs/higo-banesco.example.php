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
 *   public_html/banesco-diagnostic.php   (diagnóstico CLI)
 *   public_html/banesco-lookup.php       (UI diagnóstico web · HTTP Basic Auth)
 *   public_html/api/banesco-validate.php (endpoint JSON de Higo Pay · JWT Supabase)
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

    // ── Higo Pay (api/banesco-validate.php) ─────────────────────────────
    // Orígenes que pueden hacer fetch al endpoint desde el browser.
    // El handler responde Access-Control-Allow-Origin sólo si el Origin
    // que llega coincide con uno de estos.
    'HIGOPAY_ALLOWED_ORIGINS' => [
        'https://higoapp.com',
        'https://www.higoapp.com',
        'https://higodriver.com',
        'http://localhost:5173',
    ],

    // Datos del comerciante que el SPA muestra como "Datos de recepción".
    // (Hoy también están hardcodeados en src/pages/HigoPayPage.jsx.
    //  Si los cambiás aquí, actualizá también allí o exponelos por API.)
    'HIGOPAY_RECEIVER_RIF'   => 'J-402638850',
    'HIGOPAY_RECEIVER_PHONE' => '04120330315',

    // ── Supabase (introspección de JWT del conductor) ───────────────────
    // El endpoint api/banesco-validate.php valida el Bearer token llamando
    // a <SUPABASE_PROJECT_URL>/auth/v1/user con SUPABASE_ANON_KEY como apikey.
    // No usamos service_role; basta el anon key para esa llamada.
    'SUPABASE_PROJECT_URL' => 'https://yfgomicdcwifgeumqsvv.supabase.co',
    'SUPABASE_ANON_KEY'    => 'REEMPLAZAR_CON_VITE_SUPABASE_ANON_KEY',

    // ── Cron de avisos de vencimiento (api/send-membership-reminders.php) ─
    // Service role key de Supabase. ⚠️ Tiene permisos totales sobre la DB,
    // tratar como secreto de servidor; nunca exponerlo al frontend. Se saca
    // de Supabase → Settings → API → service_role key.
    'SUPABASE_SERVICE_ROLE_KEY' => 'REEMPLAZAR_CON_SERVICE_ROLE_KEY',

    // Token compartido entre el cron de Hostinger y el endpoint. El cron
    // lo manda en el header `X-Cron-Secret`. Generar con:
    //   openssl rand -hex 32
    'CRON_SECRET' => 'REEMPLAZAR_CON_TOKEN_LARGO_ALEATORIO',

    // Project ID de Firebase (mismo que firebaseConfig.projectId del SPA).
    'FIREBASE_PROJECT_ID' => 'higo-app-26a19',

    // Path absoluto al Service Account JSON de Firebase, fuera de
    // public_html/. Cómo obtenerlo:
    //   Firebase Console → Project settings → Service accounts →
    //   "Generate new private key" → descarga JSON.
    // Subirlo a /home/<TU_USER>/private/firebase-sa.json (chmod 600).
    'FIREBASE_SA_PATH' => '/home/REEMPLAZAR_USER/private/firebase-sa.json',

    // Log opcional del cron. Si está vacío, no se escribe.
    'CRON_LOG_PATH' => null,
];
