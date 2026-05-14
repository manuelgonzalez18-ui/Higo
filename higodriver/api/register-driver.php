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

$headers  = "From: noreply@higodriver.com\r\n";
$headers .= "Reply-To: {$email}\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/mixed; boundary=\"{$mixedBoundary}\"\r\n";

$sent = @mail($to, $subject, $body, $headers);

if (!$sent) {
    rd_send(502, ['ok' => false, 'error' => 'mail_failed']);
}

rd_send(200, ['ok' => true]);
