<?php
declare(strict_types=1);

/**
 * api/register-driver.php — Recibe el formulario público de "Unirme como
 * conductor" desde higodriver.com y envía un correo a admin@higodriver.com
 * con los datos y las 4 fotos como adjuntos.
 *
 * Form fields (multipart/form-data):
 *   full_name, cedula, phone, email, city, plan,
 *   vehicle_brand, vehicle_model, vehicle_color, license_plate,
 *   photo_driver, photo_cedula, photo_health, photo_circulation
 *
 * Salida: { ok:true } o { ok:false, error, detail? }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function rd_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    rd_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ═══ Cargar config SMTP ════════════════════════════════════════════════
// _smtp_config.php vive al lado de este archivo y NO se commitea (está
// en .gitignore). Debe definir un array con: host, port, username,
// password, from_email, from_name (opcional), ehlo (opcional).
// Si falta, fallamos rápido para no perder solicitudes silenciosamente.
$smtpConfigPath = __DIR__ . '/_smtp_config.php';
if (!is_file($smtpConfigPath)) {
    error_log('register-driver: falta _smtp_config.php en ' . __DIR__);
    rd_send(503, ['ok' => false, 'error' => 'mail_config_missing']);
}
$smtpCfg = require $smtpConfigPath;
if (!is_array($smtpCfg) || empty($smtpCfg['host']) || empty($smtpCfg['username']) || empty($smtpCfg['password'])) {
    error_log('register-driver: _smtp_config.php inválido');
    rd_send(503, ['ok' => false, 'error' => 'mail_config_invalid']);
}

// ═══ Anti-abuso muy básico ════════════════════════════════════════════
// Honeypot opcional (si en algún momento agregamos un campo invisible).
if (!empty($_POST['website'] ?? '')) {
    rd_send(200, ['ok' => true]); // silencio
}

// ═══ Validación de campos ═════════════════════════════════════════════

$fullName     = trim((string) ($_POST['full_name']     ?? ''));
$cedula       = trim((string) ($_POST['cedula']        ?? ''));
$phone        = trim((string) ($_POST['phone']         ?? ''));
$email        = strtolower(trim((string) ($_POST['email'] ?? '')));
$city         = trim((string) ($_POST['city']          ?? ''));
$plan         = trim((string) ($_POST['plan']          ?? ''));
$vehicleBrand = trim((string) ($_POST['vehicle_brand'] ?? ''));
$vehicleModel = trim((string) ($_POST['vehicle_model'] ?? ''));
$vehicleColor = trim((string) ($_POST['vehicle_color'] ?? ''));
$licensePlate = strtoupper(trim((string) ($_POST['license_plate'] ?? '')));

$required = compact(
    'fullName', 'cedula', 'phone', 'email', 'city', 'plan',
    'vehicleBrand', 'vehicleModel', 'vehicleColor', 'licensePlate'
);
foreach ($required as $k => $v) {
    if ($v === '') rd_send(400, ['ok' => false, 'error' => 'missing_field', 'detail' => $k]);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    rd_send(400, ['ok' => false, 'error' => 'invalid_email']);
}
if (!in_array($plan, ['moto', 'carro', 'camioneta'], true)) {
    rd_send(400, ['ok' => false, 'error' => 'invalid_plan']);
}

// ═══ Validación de archivos ═══════════════════════════════════════════

$fileKeys = [
    'photo_driver'      => 'Foto del conductor',
    'photo_cedula'      => 'Foto de la cédula',
    'photo_health'      => 'Certificado de salud',
    'photo_circulation' => 'Carnet de circulación',
];

$maxBytes  = 8 * 1024 * 1024;
$allowMime = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

$attachments = [];
foreach ($fileKeys as $key => $label) {
    if (empty($_FILES[$key]) || ($_FILES[$key]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        rd_send(400, ['ok' => false, 'error' => 'missing_file', 'detail' => $key]);
    }
    $f = $_FILES[$key];
    if ($f['size'] <= 0 || $f['size'] > $maxBytes) {
        rd_send(400, ['ok' => false, 'error' => 'file_too_large', 'detail' => $key]);
    }
    $mime = function_exists('mime_content_type') ? (mime_content_type($f['tmp_name']) ?: '') : '';
    if ($mime === '' || !in_array($mime, $allowMime, true)) {
        rd_send(400, ['ok' => false, 'error' => 'invalid_file_type', 'detail' => $key . ' (' . $mime . ')']);
    }
    $data = file_get_contents($f['tmp_name']);
    if ($data === false) {
        rd_send(500, ['ok' => false, 'error' => 'file_read_failed', 'detail' => $key]);
    }
    $ext = pathinfo((string) $f['name'], PATHINFO_EXTENSION) ?: '';
    if ($ext === '') {
        $ext = $mime === 'application/pdf' ? 'pdf' : explode('/', $mime)[1] ?? 'bin';
    }
    $safeName = preg_replace('/[^A-Za-z0-9_\-]/', '_', $key) . '.' . strtolower($ext);
    $attachments[] = [
        'name' => $safeName,
        'mime' => $mime,
        'data' => $data,
        'label' => $label,
    ];
}

// ═══ Construcción del correo ══════════════════════════════════════════

$planLabel = [
    'moto'      => 'Higo Moto · $10/mes',
    'carro'     => 'Higo Carro · $20/mes',
    'camioneta' => 'Higo Camioneta · $25/mes',
][$plan];

// Destino: admin@higodriver.com — mailbox que vive en el mismo hosting
// que el VPS donde corre este script. Entregar al mismo proveedor evita
// el bloqueo de puerto 25 saliente que tiene el VPS (típico anti-spam
// de planes KVM de Hostinger). Cualquier intento de mandar a un dominio
// externo (incluido admin@higoapp.com) se perdía silenciosamente — el
// mail() retornaba true pero el MTA local no podía relayar.
//
// El From queda en noreply@higodriver.com — mismo dominio que el host
// que ejecuta el script (SPF de higodriver.com incluye al VPS).
$to      = 'admin@higodriver.com';
$subject = '=?UTF-8?B?' . base64_encode("Nueva solicitud Higo App — {$fullName}") . '?=';

$safe = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');

$rowsHtml = '';
$rows = [
    'Nombre y apellido' => $fullName,
    'Cédula'            => $cedula,
    'Teléfono'          => $phone,
    'Correo'            => $email,
    'Ciudad / zona'     => $city,
    'Plan'              => $planLabel,
    'Marca'             => $vehicleBrand,
    'Modelo'            => $vehicleModel,
    'Color'             => $vehicleColor,
    'Placa'             => $licensePlate,
];
foreach ($rows as $k => $v) {
    $rowsHtml .= '<tr>'
        . '<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700;width:180px;">' . $safe($k) . '</td>'
        . '<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' . $safe($v) . '</td>'
        . '</tr>';
}

$html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>'
    . '<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">'
    . '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">'
    . '<tr><td style="background:linear-gradient(135deg,#3B82F6,#60A5FA);padding:24px;color:#fff;">'
    . '<h1 style="margin:0;font-size:20px;">Nueva solicitud de conductor</h1>'
    . '<p style="margin:6px 0 0;opacity:.9;font-size:13px;">Recibida desde higodriver.com</p>'
    . '</td></tr>'
    . '<tr><td style="padding:20px 24px;">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">'
    . $rowsHtml
    . '</table>'
    . '<p style="margin:18px 0 0;font-size:13px;color:#6b7280;">Las 4 fotos están adjuntas en este correo.</p>'
    . '</td></tr>'
    . '<tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">'
    . 'Higo App · higodriver.com'
    . '</td></tr>'
    . '</table></td></tr></table></body></html>';

$plain = "Nueva solicitud de conductor recibida en higodriver.com\n"
    . str_repeat('-', 50) . "\n";
foreach ($rows as $k => $v) {
    $plain .= str_pad($k . ':', 22) . $v . "\n";
}
$plain .= "\nLas 4 fotos están adjuntas en este correo.\n";

// ═══ Armado MIME (multipart/mixed con alternative anidado) ═════════════

$mixedBoundary = '=_mixed_' . bin2hex(random_bytes(8));
$altBoundary   = '=_alt_'   . bin2hex(random_bytes(8));

$body  = "--{$mixedBoundary}\r\n";
$body .= "Content-Type: multipart/alternative; boundary=\"{$altBoundary}\"\r\n\r\n";

$body .= "--{$altBoundary}\r\n";
$body .= "Content-Type: text/plain; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
$body .= $plain . "\r\n";

$body .= "--{$altBoundary}\r\n";
$body .= "Content-Type: text/html; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
$body .= $html . "\r\n";
$body .= "--{$altBoundary}--\r\n";

foreach ($attachments as $att) {
    $body .= "--{$mixedBoundary}\r\n";
    $body .= "Content-Type: {$att['mime']}; name=\"{$att['name']}\"\r\n";
    $body .= "Content-Transfer-Encoding: base64\r\n";
    $body .= "Content-Disposition: attachment; filename=\"{$att['name']}\"\r\n\r\n";
    $body .= chunk_split(base64_encode($att['data'])) . "\r\n";
}
$body .= "--{$mixedBoundary}--\r\n";

$headers  = "From: " . ($smtpCfg['from_name'] ?? 'Higo Driver') . " <{$smtpCfg['from_email']}>\r\n";
$headers .= "Reply-To: {$email}\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/mixed; boundary=\"{$mixedBoundary}\"\r\n";

// ═══ Envío via SMTP autenticado ════════════════════════════════════════
// NO usamos mail() porque el VPS de Hostinger tiene puerto 25 saliente
// bloqueado (anti-spam default de planes KVM). Postfix local aceptaba
// el mensaje pero nunca lograba relayarlo a ningún MX, devolviendo true
// silenciosamente. Hablamos directo con smtp.hostinger.com:465 (TLS) y
// nos autenticamos como admin@higodriver.com (mailbox real del dominio).
$sent = rd_smtp_send($smtpCfg, $to, $subject, $body, $headers);

if (!$sent) {
    rd_send(502, ['ok' => false, 'error' => 'mail_failed']);
}

rd_send(200, ['ok' => true]);

// ─── Cliente SMTP minimal ──────────────────────────────────────────────
// Reemplazo de mail(). Sin dependencias (no PHPMailer, no Composer).
// Soporta SSL/TLS implícito (puerto 465) y STARTTLS (puerto 587).
function rd_smtp_send(array $cfg, string $to, string $subject, string $body, string $headers): bool {
    $host = $cfg['host'];
    $port = (int) $cfg['port'];
    $user = $cfg['username'];
    $pass = $cfg['password'];
    $from = $cfg['from_email'];

    $url = ($port === 465 ? 'ssl://' : '') . $host;
    $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
    $fp  = @stream_socket_client("$url:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        error_log("rd_smtp_send: connect failed $host:$port — $errno $errstr");
        return false;
    }
    stream_set_timeout($fp, 30);

    $read = function () use ($fp) {
        $out = '';
        while ($line = fgets($fp, 1024)) {
            $out .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $out;
    };
    $write = function (string $cmd) use ($fp) { fwrite($fp, $cmd . "\r\n"); };
    $expect = function (string $resp, string $code) {
        if (strpos($resp, $code) !== 0) {
            error_log('rd_smtp_send: expected ' . $code . ' got ' . trim($resp));
            return false;
        }
        return true;
    };

    if (!$expect($read(), '220')) { fclose($fp); return false; }

    $write('EHLO ' . ($cfg['ehlo'] ?? 'higodriver.com'));
    if (!$expect($read(), '250')) { fclose($fp); return false; }

    // STARTTLS si estamos en 587
    if ($port === 587) {
        $write('STARTTLS');
        if (!$expect($read(), '220')) { fclose($fp); return false; }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            error_log('rd_smtp_send: STARTTLS handshake failed');
            fclose($fp); return false;
        }
        $write('EHLO ' . ($cfg['ehlo'] ?? 'higodriver.com'));
        if (!$expect($read(), '250')) { fclose($fp); return false; }
    }

    $write('AUTH LOGIN');
    if (!$expect($read(), '334')) { fclose($fp); return false; }
    $write(base64_encode($user));
    if (!$expect($read(), '334')) { fclose($fp); return false; }
    $write(base64_encode($pass));
    if (!$expect($read(), '235')) { fclose($fp); return false; }

    $write("MAIL FROM:<{$from}>");
    if (!$expect($read(), '250')) { fclose($fp); return false; }
    $write("RCPT TO:<{$to}>");
    if (!$expect($read(), '250')) { fclose($fp); return false; }

    $write('DATA');
    if (!$expect($read(), '354')) { fclose($fp); return false; }

    $msg  = "Subject: {$subject}\r\n";
    $msg .= "To: {$to}\r\n";
    $msg .= $headers;
    $msg .= "\r\n";
    $msg .= $body;
    // RFC 5321: líneas que empiezan con '.' se doblan a '..' para no
    // confundirlas con el terminador.
    $msg = preg_replace('/(^|\r\n)\./', '$1..', $msg);

    fwrite($fp, $msg);
    fwrite($fp, "\r\n.\r\n");
    if (!$expect($read(), '250')) { fclose($fp); return false; }

    $write('QUIT');
    fclose($fp);
    return true;
}
