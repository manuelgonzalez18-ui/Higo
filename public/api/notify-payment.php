<?php
/**
 * notify-payment.php
 * Envía un email HTML a admin@higoapp.com cuando un conductor reporta un pago.
 * Llamado desde HigoPayPage.jsx tras cada submit (validado, rechazado o pendiente).
 * Autenticación: Bearer JWT de Supabase (mismo patrón que banesco-validate.php).
 *
 * El comprobante se incrusta como <img> con la signed URL completa, evitando
 * que se rompa por line-wrap del cliente de correo.
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!str_starts_with($auth, 'Bearer ') || substr_count($auth, '.') < 2) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
if (!$data) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'bad_request']);
    exit;
}

$driverName  = htmlspecialchars($data['driver_name']  ?? '(desconocido)', ENT_QUOTES);
$driverEmail = htmlspecialchars($data['driver_email'] ?? '', ENT_QUOTES);
$paymentType = $data['payment_type'] ?? '';
$amountBs    = htmlspecialchars($data['amount_bs']    ?? '', ENT_QUOTES);
$reference   = htmlspecialchars($data['reference']    ?? '', ENT_QUOTES);
$trnDate     = htmlspecialchars($data['trn_date']     ?? '', ENT_QUOTES);
$status      = $data['status'] ?? '';
$receiptUrl  = $data['receipt_url']   ?? '';
$errorMsg    = $data['error_message'] ?? '';

$statusLabel = match($status) {
    'validated' => '✅ APROBADO AUTOMÁTICAMENTE',
    'rejected'  => '❌ RECHAZADO',
    'pending'   => '⏳ PENDIENTE DE REVISIÓN MANUAL',
    default     => strtoupper($status),
};

$statusColor = match($status) {
    'validated' => '#10b981',
    'rejected'  => '#ef4444',
    'pending'   => '#f59e0b',
    default     => '#6b7280',
};

$typeLabel = match($paymentType) {
    'pm_banesco' => 'Pago Móvil Banesco → Banesco',
    'pm_otros'   => 'Pago Móvil Otros Bancos → Banesco',
    'tf_banesco' => 'Transferencia Banesco → Banesco',
    'tf_otros'   => 'Transferencia Otros Bancos → Banesco',
    default      => $paymentType,
};

// Detectar si el comprobante es PDF o imagen.
$urlPath = $receiptUrl ? strtolower((string) parse_url($receiptUrl, PHP_URL_PATH)) : '';
$isPdf   = $receiptUrl && str_ends_with($urlPath, '.pdf');
$isImage = $receiptUrl && !$isPdf;

// Bloque del comprobante: imagen incrustada o link a PDF.
if ($isImage) {
    $safeUrl = htmlspecialchars($receiptUrl, ENT_QUOTES);
    $receiptBlock = '
        <tr><td style="padding:16px 0;border-top:1px solid #e5e7eb;">
            <p style="margin:0 0 12px;color:#374151;font-weight:600;">Comprobante de pago</p>
            <a href="' . $safeUrl . '" style="display:inline-block;text-decoration:none;">
                <img src="' . $safeUrl . '" alt="Comprobante"
                     style="max-width:100%;border:1px solid #e5e7eb;border-radius:8px;display:block;" />
            </a>
            <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Click en la imagen para abrirla en tamaño completo.</p>
        </td></tr>';
} elseif ($isPdf) {
    $safeUrl = htmlspecialchars($receiptUrl, ENT_QUOTES);
    $receiptBlock = '
        <tr><td style="padding:16px 0;border-top:1px solid #e5e7eb;">
            <p style="margin:0 0 8px;color:#374151;font-weight:600;">Comprobante de pago (PDF)</p>
            <a href="' . $safeUrl . '"
               style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">
                📄 Abrir comprobante PDF
            </a>
        </td></tr>';
} else {
    $receiptBlock = '
        <tr><td style="padding:16px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-style:italic;">
            Sin comprobante adjunto.
        </td></tr>';
}

$errorBlock = $errorMsg
    ? '<tr><td style="padding:12px 16px;background:#fef2f2;border-left:4px solid #ef4444;color:#991b1b;font-size:13px;">
         <strong>Detalle:</strong> ' . htmlspecialchars($errorMsg, ENT_QUOTES) . '
       </td></tr>'
    : '';

$html = '<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <tr><td style="background:' . $statusColor . ';padding:20px 24px;color:#fff;">
        <h1 style="margin:0;font-size:18px;font-weight:700;">' . $statusLabel . '</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:.9;">Higo Pay · Reporte de pago recibido</p>
    </td></tr>
    ' . $errorBlock . '
    <tr><td style="padding:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1f2937;">
            <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Driver</td><td style="padding:6px 0;font-weight:600;">' . $driverName . '</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;"><a href="mailto:' . $driverEmail . '" style="color:#0ea5e9;">' . $driverEmail . '</a></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Método</td><td style="padding:6px 0;">' . $typeLabel . '</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Monto (Bs)</td><td style="padding:6px 0;font-weight:700;font-family:ui-monospace,Menlo,monospace;">' . $amountBs . '</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Referencia</td><td style="padding:6px 0;font-family:ui-monospace,Menlo,monospace;">' . $reference . '</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Fecha</td><td style="padding:6px 0;">' . $trnDate . '</td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">' . $receiptBlock . '</table>
    </td></tr>
    <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#6b7280;">
        <a href="https://higoapp.com/#/admin/drivers" style="color:#0ea5e9;text-decoration:none;font-weight:600;">→ Ver conductores en panel admin</a>
    </td></tr>
</table>
</td></tr></table>
</body></html>';

// Versión texto plano como fallback.
$plain = "Reporte de pago recibido en Higo Pay\n"
    . str_repeat('-', 40) . "\n\n"
    . "Estado     : {$statusLabel}\n"
    . "Driver     : {$driverName}\n"
    . "Email      : {$driverEmail}\n"
    . "Método     : {$typeLabel}\n"
    . "Monto (Bs) : {$amountBs}\n"
    . "Referencia : {$reference}\n"
    . "Fecha      : {$trnDate}\n"
    . ($receiptUrl ? "Comprobante: {$receiptUrl}\n" : "Comprobante: (no adjunto)\n")
    . ($errorMsg   ? "\nDetalle error: {$errorMsg}\n" : '')
    . "\n" . str_repeat('-', 40) . "\n"
    . "Ver conductores: https://higoapp.com/#/admin/drivers\n";

// Email multipart/alternative (texto + HTML).
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

$to      = 'admin@higoapp.com';
$subject = "=?UTF-8?B?" . base64_encode("Higo Pay: {$statusLabel} — {$driverName}") . "?=";

$headers  = "From: noreply@higoapp.com\r\n";
$headers .= "Reply-To: noreply@higoapp.com\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

$sent = @mail($to, $subject, $body, $headers);
echo json_encode(['ok' => $sent]);
