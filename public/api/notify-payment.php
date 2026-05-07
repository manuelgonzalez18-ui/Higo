<?php
/**
 * notify-payment.php
 * Envía un email a admin@higoapp.com cuando un conductor reporta un pago.
 * Llamado desde HigoPayPage.jsx tras cada submit (validado, rechazado o pendiente).
 * Autenticación: Bearer JWT de Supabase (mismo patrón que banesco-validate.php).
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

// Validar JWT (mínimo: que sea un token de tres partes)
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

$typeLabel = match($paymentType) {
    'pm_banesco' => 'Pago Móvil Banesco → Banesco',
    'pm_otros'   => 'Pago Móvil Otros Bancos → Banesco',
    'tf_banesco' => 'Transferencia Banesco → Banesco',
    'tf_otros'   => 'Transferencia Otros Bancos → Banesco',
    default      => $paymentType,
};

$to      = 'admin@higoapp.com';
$subject = "=?UTF-8?B?" . base64_encode("Higo Pay: {$statusLabel} — {$driverName}") . "?=";
$body    = "Reporte de pago recibido en Higo Pay\n"
    . str_repeat('─', 40) . "\n\n"
    . "Estado     : {$statusLabel}\n"
    . "Driver     : {$driverName}\n"
    . "Email      : {$driverEmail}\n"
    . "Método     : {$typeLabel}\n"
    . "Monto (Bs) : {$amountBs}\n"
    . "Referencia : {$reference}\n"
    . "Fecha      : {$trnDate}\n"
    . ($receiptUrl ? "Comprobante: {$receiptUrl}\n" : "Comprobante: (no adjunto)\n")
    . ($errorMsg   ? "\nDetalle error: {$errorMsg}\n" : '')
    . "\n" . str_repeat('─', 40) . "\n"
    . "Ver conductores: https://higoapp.com/#/admin/drivers\n";

$headers  = "From: noreply@higoapp.com\r\n";
$headers .= "Reply-To: noreply@higoapp.com\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$headers .= "MIME-Version: 1.0\r\n";

$sent = @mail($to, $subject, $body, $headers);
echo json_encode(['ok' => $sent]);
