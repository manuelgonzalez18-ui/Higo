<?php
declare(strict_types=1);

/**
 * api/welcome-driver.php — Crea el auth user del nuevo conductor y le envía
 * un correo de bienvenida con sus credenciales, link de descarga e
 * instrucciones para activar la membresía.
 *
 * Lo invoca AdminDriversPage.jsx tras el submit del modal "Nuevo Conductor".
 *
 * Auth: header Authorization: Bearer <admin JWT de Supabase>. Se verifica
 *       contra /auth/v1/user y se valida que el caller tenga role='admin'
 *       en profiles (consultado con SERVICE_ROLE_KEY).
 *
 * Config requerido en /home/<user>/private/higo-banesco.php:
 *   - SUPABASE_PROJECT_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Body JSON:
 *   full_name, email, password, phone, vehicle_type, vehicle_brand,
 *   vehicle_model, vehicle_color, license_plate, avatar_url?
 *
 * Salida: { ok, user_id, email_sent } o { ok:false, error, detail? }
 */

require_once __DIR__ . '/../banesco-core.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function wd_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    wd_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ═══ Auth: Bearer JWT ════════════════════════════════════════════════════

$auth = $_SERVER['HTTP_AUTHORIZATION']
     ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
     ?? '';
if (!str_starts_with($auth, 'Bearer ') || substr_count($auth, '.') < 2) {
    wd_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = substr($auth, 7);

// ═══ Config ══════════════════════════════════════════════════════════════

try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    wd_send(503, ['ok' => false, 'error' => 'config_missing', 'detail' => $e->getMessage()]);
}

$supaUrl = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaKey = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
if ($supaUrl === '' || $supaKey === '') {
    wd_send(503, ['ok' => false, 'error' => 'config_incomplete']);
}

// ═══ Payload ═════════════════════════════════════════════════════════════
// Acepta multipart/form-data (preferido, para incluir el archivo del avatar)
// o JSON. Multipart evita que el WAF/ModSecurity de Hostinger bloquee el
// request por el tamaño/contenido del base64 (devolvía 403).

$ct = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
$isMultipart = stripos($ct, 'multipart/form-data') !== false;

if ($isMultipart) {
    $data = $_POST;
} else {
    $raw  = file_get_contents('php://input');
    $data = json_decode((string) $raw, true);
    if (!is_array($data)) {
        wd_send(400, ['ok' => false, 'error' => 'bad_request']);
    }
}

$fullName = trim((string) ($data['full_name'] ?? ''));
$email    = strtolower(trim((string) ($data['email'] ?? '')));
$password = (string) ($data['password'] ?? '');
$phone    = trim((string) ($data['phone'] ?? ''));

if ($fullName === '' || $email === '' || $password === '') {
    wd_send(400, ['ok' => false, 'error' => 'missing_fields']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    wd_send(400, ['ok' => false, 'error' => 'invalid_email']);
}
if (strlen($password) < 6) {
    wd_send(400, ['ok' => false, 'error' => 'weak_password']);
}

$vehicleType  = (string) ($data['vehicle_type']  ?? '');
$vehicleBrand = (string) ($data['vehicle_brand'] ?? '');
$vehicleModel = (string) ($data['vehicle_model'] ?? '');
$vehicleColor = (string) ($data['vehicle_color'] ?? '');
$licensePlate = (string) ($data['license_plate'] ?? '');
$avatarUrl    = (string) ($data['avatar_url']    ?? '');
$paymentQrUrl = (string) ($data['payment_qr_url']?? '');

// Avatar como archivo (multipart) o base64 (fallback JSON).
$avatarBin = '';
$avatarExt = 'jpg';
if ($isMultipart && !empty($_FILES['avatar_file']) && ($_FILES['avatar_file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
    $tmp = $_FILES['avatar_file']['tmp_name'] ?? '';
    if (is_uploaded_file($tmp)) {
        $avatarBin = (string) file_get_contents($tmp);
        $origExt = strtolower(pathinfo((string) $_FILES['avatar_file']['name'], PATHINFO_EXTENSION));
        if ($origExt !== '') $avatarExt = $origExt;
    }
} elseif (!empty($data['avatar_base64'])) {
    $decoded = base64_decode((string) $data['avatar_base64'], true);
    if ($decoded !== false) $avatarBin = $decoded;
    if (!empty($data['avatar_ext'])) $avatarExt = strtolower((string) $data['avatar_ext']);
}

// ═══ Verificar caller es admin ═══════════════════════════════════════════

[$uStatus, $uBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    [
        'apikey: ' . $supaKey,
        'Authorization: Bearer ' . $callerJwt,
    ]
);
if ($uStatus !== 200) {
    wd_send(401, ['ok' => false, 'error' => 'invalid_token']);
}
$caller = json_decode($uBody, true);
$callerId = (string) ($caller['id'] ?? '');
if ($callerId === '') {
    wd_send(401, ['ok' => false, 'error' => 'invalid_token']);
}

[$pStatus, $pBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . urlencode($callerId) . '&select=role',
    [
        'apikey: ' . $supaKey,
        'Authorization: Bearer ' . $supaKey,
    ]
);
$profileRows = json_decode($pBody, true);
$callerRole  = is_array($profileRows) && isset($profileRows[0]['role'])
    ? (string) $profileRows[0]['role'] : '';
if ($callerRole !== 'admin') {
    wd_send(403, ['ok' => false, 'error' => 'forbidden']);
}

// ═══ Crear auth user (Supabase Admin API) ════════════════════════════════

$createBody = json_encode([
    'email'         => $email,
    'password'      => $password,
    'email_confirm' => true,
    'user_metadata' => [
        'full_name' => $fullName,
        'phone'     => $phone,
    ],
], JSON_UNESCAPED_SLASHES);

[$cStatus, $cBody] = bl_http_post(
    $supaUrl . '/auth/v1/admin/users',
    (string) $createBody,
    [
        'apikey: ' . $supaKey,
        'Authorization: Bearer ' . $supaKey,
        'Content-Type: application/json',
    ]
);
$created = json_decode($cBody, true);
if ($cStatus < 200 || $cStatus >= 300 || !isset($created['id'])) {
    $msg = is_array($created)
        ? ($created['msg'] ?? $created['error_description'] ?? $created['message'] ?? 'supabase_error')
        : 'supabase_error';
    $code = ($cStatus === 422 || stripos((string) $msg, 'already') !== false) ? 409 : 502;
    wd_send($code, ['ok' => false, 'error' => 'auth_create_failed', 'detail' => $msg]);
}
$userId = (string) $created['id'];

// ═══ Subir foto del conductor (Supabase Storage, bypass RLS) ═════════════
// Se hace antes del insert para guardar la URL en el mismo profile.
$avatarUploaded = false;
$avatarDetail   = '';

if ($avatarBin === '') {
    // Diagnóstico: distinguir "no llegó archivo" de "llegó pero falló".
    if ($isMultipart) {
        $fileErr = $_FILES['avatar_file']['error'] ?? UPLOAD_ERR_NO_FILE;
        $errMap = [
            UPLOAD_ERR_INI_SIZE   => 'ini_size_exceeded',
            UPLOAD_ERR_FORM_SIZE  => 'form_size_exceeded',
            UPLOAD_ERR_PARTIAL    => 'partial_upload',
            UPLOAD_ERR_NO_FILE    => 'no_file',
            UPLOAD_ERR_NO_TMP_DIR => 'no_tmp_dir',
            UPLOAD_ERR_CANT_WRITE => 'cant_write',
            UPLOAD_ERR_EXTENSION  => 'extension_blocked',
        ];
        $avatarDetail = $errMap[$fileErr] ?? ('upload_err_' . (int) $fileErr);
    } else {
        $avatarDetail = 'no_avatar';
    }
} elseif (strlen($avatarBin) > 12 * 1024 * 1024) {
    $avatarDetail = 'too_large_' . strlen($avatarBin);
} else {
    $ext = preg_replace('/[^a-z0-9]/', '', $avatarExt) ?: 'jpg';
    if (!in_array($ext, ['jpg','jpeg','png','webp','heic','heif'], true)) $ext = 'jpg';
    $mime = $ext === 'png'  ? 'image/png'
          : ($ext === 'webp' ? 'image/webp'
          : ($ext === 'heic' || $ext === 'heif' ? 'image/' . $ext
          : 'image/jpeg'));
    $objectPath = $userId . '/avatar.' . $ext;

    $doUpload = function () use ($supaUrl, $supaKey, $objectPath, $avatarBin, $mime) {
        $ch = curl_init($supaUrl . '/storage/v1/object/avatars/' . $objectPath);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_POSTFIELDS     => $avatarBin,
            CURLOPT_HTTPHEADER     => [
                'apikey: ' . $supaKey,
                'Authorization: Bearer ' . $supaKey,
                'Content-Type: ' . $mime,
                'x-upsert: true',
            ],
        ]);
        $resp = (string) @curl_exec($ch);
        $stat = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        return [$stat, $resp, $err];
    };

    [$upStat, $upResp, $upErr] = $doUpload();

    // Self-heal: si el bucket 'avatars' no existe (instalación nueva), lo
    // creamos público con el service role y reintentamos la subida una vez.
    if ($upStat === 404 && stripos($upResp, 'Bucket not found') !== false) {
        $ch = curl_init($supaUrl . '/storage/v1/bucket');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_POSTFIELDS     => json_encode([
                'id'     => 'avatars',
                'name'   => 'avatars',
                'public' => true,
            ]),
            CURLOPT_HTTPHEADER     => [
                'apikey: ' . $supaKey,
                'Authorization: Bearer ' . $supaKey,
                'Content-Type: application/json',
            ],
        ]);
        $bResp = (string) @curl_exec($ch);
        $bStat = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (($bStat >= 200 && $bStat < 300) || stripos($bResp, 'already exists') !== false) {
            [$upStat, $upResp, $upErr] = $doUpload();
        } else {
            $avatarDetail = 'bucket_create_' . $bStat . ' ' . substr($bResp, 0, 200);
        }
    }

    if ($upStat >= 200 && $upStat < 300) {
        $avatarUrl = $supaUrl . '/storage/v1/object/public/avatars/' . $objectPath;
        $avatarUploaded = true;
    } elseif ($avatarDetail === '') {
        $avatarDetail = 'storage_' . $upStat . ($upErr !== '' ? ' ' . $upErr : '') . ' ' . substr($upResp, 0, 200);
    }
}

// ═══ Insertar profile ════════════════════════════════════════════════════

$profileBody = json_encode([
    'id'                  => $userId,
    'full_name'           => $fullName,
    'phone'               => $phone,
    'role'                => 'driver',
    'status'              => 'offline',
    'vehicle_type'        => $vehicleType,
    'vehicle_brand'       => $vehicleBrand,
    'vehicle_model'       => $vehicleModel,
    'vehicle_color'       => $vehicleColor,
    'license_plate'       => $licensePlate,
    'avatar_url'          => $avatarUrl,
    'payment_qr_url'      => $paymentQrUrl,
    'subscription_status' => 'active',
    'last_payment_date'   => gmdate('Y-m-d\TH:i:s\Z'),
], JSON_UNESCAPED_SLASHES);

[$insStatus, $insBody] = bl_http_post(
    $supaUrl . '/rest/v1/profiles',
    (string) $profileBody,
    [
        'apikey: ' . $supaKey,
        'Authorization: Bearer ' . $supaKey,
        'Content-Type: application/json',
        'Prefer: return=minimal',
    ]
);
if ($insStatus < 200 || $insStatus >= 300) {
    // Rollback best-effort: borrar el auth user para no dejar huérfanos.
    $ch = curl_init($supaUrl . '/auth/v1/admin/users/' . urlencode($userId));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . $supaKey,
            'Authorization: Bearer ' . $supaKey,
        ],
    ]);
    @curl_exec($ch);
    curl_close($ch);
    wd_send(502, ['ok' => false, 'error' => 'profile_insert_failed', 'detail' => $insBody]);
}

// ═══ Email de bienvenida ═════════════════════════════════════════════════

$playStoreUrl = 'https://play.google.com/store/apps/details?id=com.higoapp.ve';

$safeName = htmlspecialchars($fullName, ENT_QUOTES);
$safeMail = htmlspecialchars($email,    ENT_QUOTES);
$safePass = htmlspecialchars($password, ENT_QUOTES);

$html = '<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <tr><td style="background:linear-gradient(135deg,#7c3aed,#c026d3);padding:28px 24px;color:#fff;text-align:center;">
        <h1 style="margin:0;font-size:22px;font-weight:800;">¡Bienvenido a Higo, ' . $safeName . '!</h1>
        <p style="margin:8px 0 0;font-size:14px;opacity:.9;">Ya eres parte de la flota Higo App</p>
    </td></tr>

    <tr><td style="padding:24px;color:#1f2937;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 16px;">
            Tu cuenta de conductor ya está activa. A continuación tus datos de acceso y los pasos para empezar a recibir viajes.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin:8px 0 20px;">
            <tr><td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
                <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:.5px;">Tu correo</p>
                <p style="margin:4px 0 0;font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700;">' . $safeMail . '</p>
            </td></tr>
            <tr><td style="padding:14px 16px;">
                <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:.5px;">Tu contraseña</p>
                <p style="margin:4px 0 0;font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700;">' . $safePass . '</p>
            </td></tr>
        </table>

        <p style="margin:0 0 12px;font-weight:700;color:#111827;">1. Descarga la app</p>
        <p style="margin:0 0 16px;">
            Instala Higo App desde Google Play:
        </p>
        <p style="text-align:center;margin:0 0 24px;">
            <a href="' . $playStoreUrl . '"
               style="display:inline-block;background:#7c3aed;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">
                📱 Descargar Higo App
            </a>
        </p>

        <p style="margin:0 0 12px;font-weight:700;color:#111827;">2. Inicia sesión</p>
        <p style="margin:0 0 16px;">
            Abre la app e inicia sesión con el correo y la contraseña de arriba.
        </p>

        <p style="margin:0 0 12px;font-weight:700;color:#111827;">3. Activa tu membresía</p>
        <p style="margin:0 0 8px;">
            Para empezar a recibir viajes necesitas tener membresía activa:
        </p>
        <ol style="margin:0 0 16px;padding-left:20px;color:#374151;">
            <li style="margin-bottom:6px;">Dentro de la app, abre el menú <strong>Higo Pay</strong> (ícono de tarjeta).</li>
            <li style="margin-bottom:6px;">Elige el método de pago (Pago Móvil o Transferencia) y el periodo (semanal o mensual).</li>
            <li style="margin-bottom:6px;">Realiza el pago a la cuenta Banesco que aparece en pantalla.</li>
            <li style="margin-bottom:6px;">Sube el comprobante. La validación es automática en la mayoría de los casos.</li>
            <li>Una vez aprobado, conéctate desde el botón <strong>“En línea”</strong> y empieza a recibir viajes.</li>
        </ol>

        <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
            ¿Problemas para iniciar sesión o subir el comprobante? Escríbenos a
            <a href="mailto:admin@higoapp.com" style="color:#7c3aed;">admin@higoapp.com</a>.
        </p>
    </td></tr>

    <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#6b7280;">
        Higo · La app de Higuerote · <a href="https://higoapp.com" style="color:#7c3aed;text-decoration:none;">higoapp.com</a>
    </td></tr>
</table>
</td></tr></table>
</body></html>';

$plain = "¡Bienvenido a Higo, {$fullName}!\n"
    . str_repeat('-', 50) . "\n\n"
    . "Tu cuenta de conductor ya está activa.\n\n"
    . "DATOS DE ACCESO\n"
    . "  Correo     : {$email}\n"
    . "  Contraseña : {$password}\n\n"
    . "1) DESCARGA LA APP\n"
    . "   {$playStoreUrl}\n\n"
    . "2) INICIA SESIÓN\n"
    . "   Abre la app y entra con el correo y clave de arriba.\n\n"
    . "3) ACTIVA TU MEMBRESÍA\n"
    . "   - Abre el menú Higo Pay dentro de la app.\n"
    . "   - Elige método de pago (Pago Móvil o Transferencia) y periodo (semanal o mensual).\n"
    . "   - Paga a la cuenta Banesco que aparece en pantalla.\n"
    . "   - Sube el comprobante (validación automática en la mayoría de casos).\n"
    . "   - Conéctate desde 'En línea' y empieza a recibir viajes.\n\n"
    . "Soporte: admin@higoapp.com\n"
    . "Higo · La app de Higuerote · https://higoapp.com\n";

$boundary = '=_higo_' . bin2hex(random_bytes(8));
$body  = "--{$boundary}\r\n"
       . "Content-Type: text/plain; charset=UTF-8\r\n"
       . "Content-Transfer-Encoding: 8bit\r\n\r\n"
       . $plain . "\r\n"
       . "--{$boundary}\r\n"
       . "Content-Type: text/html; charset=UTF-8\r\n"
       . "Content-Transfer-Encoding: 8bit\r\n\r\n"
       . $html . "\r\n"
       . "--{$boundary}--\r\n";

$subject = "=?UTF-8?B?" . base64_encode("Bienvenido a Higo App — {$fullName}") . "?=";
$headers  = "From: noreply@higoapp.com\r\n";
$headers .= "Reply-To: admin@higoapp.com\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

$emailSent = @mail($email, $subject, $body, $headers);

wd_send(200, [
    'ok'              => true,
    'user_id'         => $userId,
    'email_sent'      => (bool) $emailSent,
    'avatar_uploaded' => $avatarUploaded,
    'avatar_detail'   => $avatarDetail,
]);
