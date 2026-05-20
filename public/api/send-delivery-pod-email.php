<?php
declare(strict_types=1);

/**
 * api/send-delivery-pod-email.php — Envía un correo HTML premium al cliente
 * notificando la recogida o entrega de su paquete de Higo Envíos.
 *
 * Auth: Bearer JWT del CHOFER. Validamos que sea el driver_id del ride.
 * Body JSON: { ride_id: int, kind: string, pod_path: string }
 *   kind ∈ {pickup, delivery}
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg_cors = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg_cors, 'POST, OPTIONS');
api_rate_limit('send-delivery-pod-email', 30, '/tmp/higo_ratelimit.log');

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function spe_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    spe_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ═══ Auth: Bearer JWT del Chofer ════════════════════════════════════════
$auth = $_SERVER['HTTP_AUTHORIZATION']
     ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
     ?? '';
if (!str_starts_with($auth, 'Bearer ') || substr_count($auth, '.') < 2) {
    spe_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = substr($auth, 7);

// ═══ Config ═════════════════════════════════════════════════════════════
try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    spe_send(503, ['ok' => false, 'error' => 'config_missing', 'detail' => $e->getMessage()]);
}

foreach (['SUPABASE_PROJECT_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'] as $k) {
    if (empty($cfg[$k])) {
        spe_send(503, ['ok' => false, 'error' => 'config_incomplete', 'detail' => "missing_$k"]);
    }
}

$supaUrl = rtrim((string) $cfg['SUPABASE_PROJECT_URL'], '/');
$supaSrv = (string) $cfg['SUPABASE_SERVICE_ROLE_KEY'];
$supaAnon = (string) $cfg['SUPABASE_ANON_KEY'];

// Validar JWT del chofer
[$uStatus, $uBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaAnon, 'Authorization: Bearer ' . $callerJwt]
);
if ($uStatus !== 200) {
    spe_send(401, ['ok' => false, 'error' => 'invalid_token']);
}
$caller = json_decode((string) $uBody, true);
$callerId = (string) ($caller['id'] ?? '');
if ($callerId === '') {
    spe_send(401, ['ok' => false, 'error' => 'invalid_token']);
}

// ═══ Body ═══════════════════════════════════════════════════════════════
$raw = (string) file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    spe_send(400, ['ok' => false, 'error' => 'bad_json']);
}

$rideId  = (int) ($data['ride_id'] ?? 0);
$kind    = (string) ($data['kind'] ?? '');
$podPath = (string) ($data['pod_path'] ?? '');

if ($rideId <= 0 || !in_array($kind, ['pickup', 'delivery'], true) || empty($podPath)) {
    spe_send(400, ['ok' => false, 'error' => 'bad_request', 'detail' => 'missing_parameters']);
}

// ═══ Cargar Ride y validar Driver ═══════════════════════════════════════
[$rStatus, $rBody] = bl_http_get(
    $supaUrl . '/rest/v1/rides?id=eq.' . $rideId
        . '&select=id,user_id,driver_id,service_type,pickup,dropoff,delivery_info',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
if ($rStatus !== 200) {
    spe_send(500, ['ok' => false, 'error' => 'ride_fetch_failed']);
}
$rows = json_decode((string) $rBody, true);
$ride = is_array($rows) ? ($rows[0] ?? null) : null;
if (!$ride) {
    spe_send(404, ['ok' => false, 'error' => 'ride_not_found']);
}

if (($ride['service_type'] ?? '') !== 'delivery') {
    spe_send(409, ['ok' => false, 'error' => 'not_a_delivery']);
}
if ((string) ($ride['driver_id'] ?? '') !== $callerId) {
    spe_send(403, ['ok' => false, 'error' => 'not_assigned_driver']);
}

$clientId = (string) ($ride['user_id'] ?? '');
if ($clientId === '') {
    spe_send(404, ['ok' => false, 'error' => 'no_client_found']);
}

// ═══ Cargar Correo y Nombre del Cliente ═════════════════════════════════
[$auStatus, $auBody] = bl_http_get(
    $supaUrl . '/auth/v1/admin/users/' . rawurlencode($clientId),
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$clientAuth = ($auStatus === 200) ? json_decode((string) $auBody, true) : null;
$clientEmail = (string) ($clientAuth['email'] ?? '');
if ($clientEmail === '') {
    spe_send(404, ['ok' => false, 'error' => 'client_email_not_found']);
}

[$cpStatus, $cpBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($clientId) . '&select=full_name',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$clientProfile = ($cpStatus === 200) ? (json_decode((string) $cpBody, true)[0] ?? null) : null;
$clientName = (string) ($clientProfile['full_name'] ?? 'Cliente Higo');

// ═══ Cargar Detalles del Conductor Responsable ══════════════════════════
[$dStatus, $dBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($callerId)
        . '&select=full_name,phone,license_plate,vehicle_model,vehicle_brand,vehicle_color,vehicle_type',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$driver = ($dStatus === 200) ? (json_decode((string) $dBody, true)[0] ?? null) : null;
if (!$driver) {
    spe_send(404, ['ok' => false, 'error' => 'driver_profile_not_found']);
}

$driverName  = (string) ($driver['full_name'] ?? 'Conductor Profesional');
$driverPhone = (string) ($driver['phone'] ?? '—');
$driverPlate = (string) ($driver['license_plate'] ?? '—');
$driverBrand = (string) ($driver['vehicle_brand'] ?? '');
$driverModel = (string) ($driver['vehicle_model'] ?? '');
$driverColor = (string) ($driver['vehicle_color'] ?? '');
$driverType  = (string) ($driver['vehicle_type'] ?? 'Carro');

$vehicleDesc = trim("$driverColor $driverBrand $driverModel");
if ($vehicleDesc === '') {
    $vehicleDesc = $driverType;
}

// ═══ Generar Signed URL de 7 días para la Foto POD ══════════════════════
$encodedPath = implode('/', array_map('rawurlencode', explode('/', $podPath)));
$sigUrlEndpoint = $supaUrl . '/storage/v1/object/sign/delivery-pods/' . $encodedPath;

[$sigStatus, $sigBody] = bl_http_post(
    $sigUrlEndpoint,
    (string) json_encode(['expiresIn' => 7 * 24 * 3600]),
    [
        'apikey: ' . $supaSrv,
        'Authorization: Bearer ' . $supaSrv,
        'Content-Type: application/json',
    ],
    10
);

$podSignedUrl = '';
if ($sigStatus >= 200 && $sigStatus < 300) {
    $sigResp = json_decode((string) $sigBody, true);
    $relUrl = $sigResp['signedURL'] ?? $sigResp['signedUrl'] ?? '';
    if ($relUrl !== '') {
        $podSignedUrl = $supaUrl . '/storage/v1' . $relUrl;
    }
}

if ($podSignedUrl === '') {
    spe_send(500, ['ok' => false, 'error' => 'pod_signing_failed']);
}

// ═══ Render del Email HTML Premium ══════════════════════════════════════
$isPickup = ($kind === 'pickup');
$title = $isPickup ? '📦 Tu envío ha sido recogido' : '🏁 Tu envío ha sido entregado';
$subtitle = $isPickup
    ? 'El conductor ya tiene tu paquete y está en camino al destino.'
    : 'El paquete se entregó con éxito en el lugar acordado.';

$safeClientName  = htmlspecialchars($clientName, ENT_QUOTES);
$safeDriverName  = htmlspecialchars($driverName, ENT_QUOTES);
$safeDriverPhone = htmlspecialchars($driverPhone, ENT_QUOTES);
$safeDriverPlate = htmlspecialchars($driverPlate, ENT_QUOTES);
$safeVehicle     = htmlspecialchars($vehicleDesc, ENT_QUOTES);

$pickupAddress  = htmlspecialchars((string) ($ride['pickup'] ?? '—'), ENT_QUOTES);
$dropoffAddress = htmlspecialchars((string) ($ride['dropoff'] ?? '—'), ENT_QUOTES);

$packageDesc = 'Paquete de Envíos';
if (!empty($ride['delivery_info']['package_description'])) {
    $packageDesc = (string) $ride['delivery_info']['package_description'];
}
$safePkgDesc = htmlspecialchars($packageDesc, ENT_QUOTES);

$waPhone = preg_replace('/[^0-9]/', '', $driverPhone);
$waLink = !empty($waPhone) ? "https://wa.me/{$waPhone}" : '';

$html = '<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>' . $title . '</title>
</head>
<body style="margin:0;padding:0;background-color:#070d19;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#070d19;padding:32px 0;">
<tr>
<td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#0b1426;border:1px solid #1e293b;border-radius:24px;overflow:hidden;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
        <!-- HEADER -->
        <tr>
            <td style="background:linear-gradient(135deg, #0f172a 0%, #022c22 100%);padding:32px;text-align:center;border-bottom:1px solid #1e293b;">
                <div style="display:inline-block;background-color:rgba(16,185,129,0.1);padding:14px;border-radius:20px;margin-bottom:16px;border:1px solid rgba(16,185,129,0.2);">
                    ' . ($isPickup 
                        ? '<span style="font-size:36px;line-height:1;">📦</span>' 
                        : '<span style="font-size:36px;line-height:1;">🏁</span>') . '
                </div>
                <h1 style="margin:0;font-size:24px;font-weight:800;color:#10b981;letter-spacing:-0.5px;">' . $title . '</h1>
                <p style="margin:8px 0 0;font-size:14px;color:#94a3b8;line-height:1.5;">' . $subtitle . '</p>
            </td>
        </tr>

        <!-- CONTENIDO -->
        <tr>
            <td style="padding:32px;">
                <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#e2e8f0;">
                    Hola, <strong>' . $safeClientName . '</strong>. Te notificamos sobre una actualización importante de tu servicio Higo Envíos:
                </p>

                <!-- FOTO EVIDENCIA (POD) -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                    <tr>
                        <td style="background-color:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:20px;text-align:center;">
                            <p style="margin:0 0 12px;font-size:13px;text-transform:uppercase;font-weight:700;color:#10b981;letter-spacing:1px;">
                                ' . ($isPickup ? 'Foto tomada al recoger' : 'Foto tomada al entregar') . '
                            </p>
                            <a href="' . htmlspecialchars($podSignedUrl, ENT_QUOTES) . '" target="_blank" style="display:block;text-decoration:none;">
                                <img src="' . htmlspecialchars($podSignedUrl, ENT_QUOTES) . '" alt="Prueba de Entrega" style="width:100%;max-width:480px;border-radius:12px;border:1px solid #1e293b;display:inline-block;" />
                            </a>
                            <p style="margin:8px 0 0;font-size:11px;color:#64748b;">
                                Click en la foto para verla en tamaño completo (expira en 7 días).
                            </p>
                        </td>
                    </tr>
                </table>

                <!-- DETALLES DEL CHOFER RESPONSABLE -->
                <h2 style="margin:0 0 16px;font-size:14px;text-transform:uppercase;font-weight:800;color:#94a3b8;letter-spacing:1px;">
                    Conductor Responsable
                </h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:24px;margin-bottom:32px;">
                    <tr>
                        <td>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#e2e8f0;">
                                <tr>
                                    <td style="padding:6px 0;color:#64748b;width:130px;font-weight:600;">Nombre</td>
                                    <td style="padding:6px 0;font-weight:700;color:#ffffff;">' . $safeDriverName . '</td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;color:#64748b;font-weight:600;">Teléfono</td>
                                    <td style="padding:6px 0;">
                                        <a href="tel:' . $safeDriverPhone . '" style="color:#10b981;text-decoration:none;font-weight:700;">' . $safeDriverPhone . '</a>
                                        ' . (!empty($waLink) ? ' <a href="' . $waLink . '" target="_blank" style="margin-left:8px;color:#10b981;text-decoration:none;font-size:12px;background-color:rgba(16,185,129,0.1);padding:2px 8px;border-radius:4px;border:1px solid rgba(16,185,129,0.2);">💬 WhatsApp</a>' : '') . '
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;color:#64748b;font-weight:600;">Vehículo</td>
                                    <td style="padding:6px 0;color:#ffffff;">' . $safeVehicle . '</td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;color:#64748b;font-weight:600;">Placa</td>
                                    <td style="padding:6px 0;font-weight:700;color:#ffffff;font-family:monospace;font-size:15px;background-color:#1e293b;padding:2px 8px;border-radius:6px;display:inline-block;border:1px solid #334155;">' . $safeDriverPlate . '</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <!-- DETALLES DEL ENVÍO -->
                <h2 style="margin:0 0 16px;font-size:14px;text-transform:uppercase;font-weight:800;color:#94a3b8;letter-spacing:1px;">
                    Detalles del Envío
                </h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:24px;font-size:14px;line-height:1.6;color:#e2e8f0;margin-bottom:16px;">
                    <tr>
                        <td style="padding:6px 0;color:#64748b;width:130px;font-weight:600;vertical-align:top;">Paquete</td>
                        <td style="padding:6px 0;color:#ffffff;">' . $safePkgDesc . '</td>
                    </tr>
                    <tr>
                        <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Origen</td>
                        <td style="padding:6px 0;color:#ffffff;">' . $pickupAddress . '</td>
                    </tr>
                    <tr>
                        <td style="padding:6px 0;color:#64748b;font-weight:600;vertical-align:top;">Destino</td>
                        <td style="padding:6px 0;color:#ffffff;">' . $dropoffAddress . '</td>
                    </tr>
                </table>
            </td>
        </tr>

        <!-- FOOTER -->
        <tr>
            <td style="padding:24px;background-color:#070d19;border-top:1px solid #1e293b;text-align:center;font-size:12px;color:#64748b;">
                <p style="margin:0 0 8px;font-weight:700;color:#94a3b8;">Higo Envíos · La App de Higuerote</p>
                <p style="margin:0;line-height:1.5;">Este es un correo automático generado para garantizar la seguridad de tus envíos. Ante cualquier duda, contáctanos a soporte@higoapp.com</p>
            </td>
        </tr>
    </table>
</td>
</tr>
</table>
</body>
</html>';

// Fallback en Texto Plano
$plain = "Higo Envíos: {$title}\n"
    . "{$subtitle}\n\n"
    . str_repeat('=', 50) . "\n"
    . "Hola, {$clientName}.\n\n"
    . "Tu servicio de envío ha sido actualizado:\n"
    . "• Paquete  : {$packageDesc}\n"
    . "• Origen   : {$pickupAddress}\n"
    . "• Destino  : {$dropoffAddress}\n\n"
    . "CONDUCTOR RESPONSABLE:\n"
    . "• Conductor: {$driverName}\n"
    . "• Teléfono : {$driverPhone}\n"
    . "• Vehículo : {$vehicleDesc}\n"
    . "• Placa    : {$driverPlate}\n\n"
    . "FOTO PRUEBA:\n"
    . "Podés visualizar la foto en: {$podSignedUrl}\n\n"
    . str_repeat('=', 50) . "\n"
    . "Soporte Higo: soporte@higoapp.com\n";

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

$subject = "=?UTF-8?B?" . base64_encode("Higo Envíos: {$title} — {$packageDesc}") . "?=";

$headers  = "From: noreply@higoapp.com\r\n";
$headers .= "Reply-To: soporte@higoapp.com\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

$sent = @mail($clientEmail, $subject, $body, $headers);

spe_send(200, [
    'ok' => (bool) $sent,
    'sent_to' => $clientEmail
]);
