<?php
/**
 * send-claim-resolution-email.php
 *
 * Cuando un admin resuelve un delivery_claim a favor del remitente
 * (RPC resolve_delivery_claim_for_claimant), este endpoint:
 *
 *   1. Valida que el caller sea admin (Bearer JWT + profiles.role).
 *   2. Levanta el claim, el ride y el perfil del chofer suspendido.
 *   3. Manda un email AL REMITENTE con los datos identificatorios del
 *      chofer (cédula, nombre, teléfono, placa) para que pueda proceder
 *      por canales legales (civil/penal).
 *
 * Esto materializa el modelo de negocio acordado:
 *   - Higo NO indemniza con caja propia.
 *   - El recurso del remitente es contra el chofer por vía legal.
 *   - Higo facilita los datos identificatorios bajo los T&C aceptados.
 *
 * Idempotente del lado del email (mail() puede dispararse varias veces);
 * el RPC ya marca driver_contact_shared=true y driver_contact_shared_at.
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg, 'POST, OPTIONS');
// Cap a 20 req/min/IP — admin no debería disparar más en operación normal.
api_rate_limit('send-claim-resolution-email', 20, '/tmp/higo_ratelimit.log');

header('Content-Type: application/json; charset=utf-8');

function claim_send(int $code, array $payload): void {
    http_response_code($code);
    echo (string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    claim_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ─── Auth ────────────────────────────────────────────────────────────
$auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
    claim_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$token = trim($m[1]);

$supaUrl  = rtrim((string) ($_cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaSrv  = (string) ($_cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
$supaAnon = (string) ($_cfg['SUPABASE_ANON_KEY'] ?? '');
if ($supaUrl === '' || $supaSrv === '' || $supaAnon === '') {
    claim_send(503, ['ok' => false, 'error' => 'config_missing']);
}

[$uStatus, $uBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaAnon, 'Authorization: Bearer ' . $token]
);
if ($uStatus !== 200) {
    claim_send(401, ['ok' => false, 'error' => 'bad_token']);
}
$adminUser = json_decode((string) $uBody, true);
$adminId = (string) ($adminUser['id'] ?? '');
if ($adminId === '') {
    claim_send(401, ['ok' => false, 'error' => 'no_user_id']);
}

// Verificar role admin (segunda barrera además del RPC que el admin ya
// ejecutó para resolver el claim).
[$pStatus, $pBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($adminId) . '&select=role',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$adminProfile = ($pStatus === 200) ? (json_decode((string) $pBody, true)[0] ?? null) : null;
if (!$adminProfile || ($adminProfile['role'] ?? '') !== 'admin') {
    claim_send(403, ['ok' => false, 'error' => 'not_admin']);
}

// ─── Input ───────────────────────────────────────────────────────────
$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    claim_send(400, ['ok' => false, 'error' => 'bad_json']);
}
$claimId = (string) ($body['claim_id'] ?? '');
if ($claimId === '' || !preg_match('/^[0-9a-f-]{36}$/i', $claimId)) {
    claim_send(400, ['ok' => false, 'error' => 'bad_claim_id']);
}

// ─── Cargar claim + ride + chofer + remitente ────────────────────────
[$cStatus, $cBody] = bl_http_get(
    $supaUrl . '/rest/v1/delivery_claims?id=eq.' . rawurlencode($claimId)
        . '&select=id,ride_id,claimant_id,type,description,declared_value_usd,status,admin_resolution_note,created_at,resolved_at',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$claim = ($cStatus === 200) ? (json_decode((string) $cBody, true)[0] ?? null) : null;
if (!$claim) {
    claim_send(404, ['ok' => false, 'error' => 'claim_not_found']);
}
if (($claim['status'] ?? '') !== 'resolved_for_claimant') {
    claim_send(409, ['ok' => false, 'error' => 'claim_not_resolved_for_claimant']);
}

$rideId = (int) ($claim['ride_id'] ?? 0);
[$rStatus, $rBody] = bl_http_get(
    $supaUrl . '/rest/v1/rides?id=eq.' . $rideId
        . '&select=id,user_id,driver_id,pickup,dropoff,price,delivery_info,delivered_at',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$ride = ($rStatus === 200) ? (json_decode((string) $rBody, true)[0] ?? null) : null;
if (!$ride) {
    claim_send(404, ['ok' => false, 'error' => 'ride_not_found']);
}

$driverId = (string) ($ride['driver_id'] ?? '');
[$dStatus, $dBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($driverId)
        . '&select=full_name,phone,license_plate,vehicle_model,vehicle_color',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$driver = ($dStatus === 200) ? (json_decode((string) $dBody, true)[0] ?? null) : null;
if (!$driver) {
    claim_send(404, ['ok' => false, 'error' => 'driver_not_found']);
}

// Email del remitente (auth.users)
$claimantId = (string) ($claim['claimant_id'] ?? '');
[$auStatus, $auBody] = bl_http_get(
    $supaUrl . '/auth/v1/admin/users/' . rawurlencode($claimantId),
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$claimantAuth = ($auStatus === 200) ? json_decode((string) $auBody, true) : null;
$claimantEmail = (string) ($claimantAuth['email'] ?? '');
if ($claimantEmail === '') {
    claim_send(404, ['ok' => false, 'error' => 'claimant_email_not_found']);
}

[$cpStatus, $cpBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($claimantId) . '&select=full_name',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$claimantProfile = ($cpStatus === 200) ? (json_decode((string) $cpBody, true)[0] ?? null) : null;

// ─── Render del email ────────────────────────────────────────────────
$adminEmail = (string) ($_cfg['SUPPORT_ADMIN_EMAIL'] ?? 'admin@higoapp.com');
$legalEmail = (string) ($_cfg['LEGAL_EMAIL'] ?? 'legal@higoapp.com');
$mailFrom   = 'noreply@higoapp.com';

$safe = fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES);

$claimantName  = $safe($claimantProfile['full_name'] ?? 'remitente');
$drvName       = $safe($driver['full_name']      ?? '—');
$drvPhone      = $safe($driver['phone']          ?? '—');
$drvPlate      = $safe($driver['license_plate']  ?? '—');
$drvVehicle    = $safe(trim(($driver['vehicle_model'] ?? '') . ' ' . ($driver['vehicle_color'] ?? '')) ?: '—');

$claimType   = $safe($claim['type'] ?? '—');
$claimDesc   = $safe($claim['description'] ?? '');
$claimNote   = $safe($claim['admin_resolution_note'] ?? '');
$declVal     = $safe(number_format((float) ($claim['declared_value_usd'] ?? 0), 2));
$rideIdSafe  = $safe('#' . $rideId);
$pickupSafe  = $safe($ride['pickup']  ?? '—');
$dropoffSafe = $safe($ride['dropoff'] ?? '—');
$deliveredAt = $safe($ride['delivered_at'] ?? '—');

$html = '<!doctype html><html><body style="margin:0;font-family:-apple-system,sans-serif;background:#f3f4f6;padding:24px;">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">'

    . '<tr><td style="background:#0a101f;color:white;padding:24px;">'
    . '<h1 style="margin:0;font-size:22px;">Resolución de tu reclamo · Higo Envíos</h1>'
    . '<p style="margin:6px 0 0;opacity:.8;font-size:13px;">Ride ' . $rideIdSafe . ' &middot; ' . $safe(gmdate('Y-m-d')) . '</p>'
    . '</td></tr>'

    . '<tr><td style="padding:24px;color:#111827;">'
    . '<p style="margin:0 0 14px;font-size:15px;">Hola ' . $claimantName . ',</p>'
    . '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;">'
    . 'Hemos investigado tu reclamo (<strong>' . $claimType . '</strong>) sobre el envío ' . $rideIdSafe . ' y la evidencia recabada lo respalda. '
    . 'En cumplimiento de los <a href="https://higoapp.com/terms/envios" style="color:#10b981;">Términos y Condiciones de Higo Envíos</a> que aceptaste al confirmar tu envío, ya hemos tomado las siguientes acciones del lado de la plataforma:'
    . '</p>'

    . '<ul style="margin:0 0 14px;padding-left:18px;font-size:14px;line-height:1.6;">'
    . '<li>El chofer ha sido <strong>suspendido</strong> de la plataforma y no podrá tomar nuevos envíos.</li>'
    . '<li>Su membresía queda bloqueada hasta que la situación se resuelva.</li>'
    . '</ul>'

    . '<div style="margin:24px 0;padding:16px;border:2px solid #dc2626;border-radius:10px;background:#fef2f2;">'
    . '<h2 style="margin:0 0 10px;color:#dc2626;font-size:16px;">Datos identificatorios del chofer</h2>'
    . '<p style="margin:0 0 10px;font-size:12px;color:#7f1d1d;">'
    . 'Higo te entrega esta información <strong>únicamente</strong> para que puedas proceder por vía civil o penal contra el chofer por canales propios. '
    . 'Higo es plataforma de intermediación tecnológica y no es parte del proceso legal.'
    . '</p>'
    . '<table cellpadding="6" cellspacing="0" style="font-size:13px;color:#111827;border-collapse:collapse;width:100%;">'
    . '<tr><td style="color:#6b7280;width:40%;">Nombre completo</td><td><strong>' . $drvName . '</strong></td></tr>'
    . '<tr><td style="color:#6b7280;">Teléfono</td><td><a href="tel:' . $drvPhone . '" style="color:#2563eb;">' . $drvPhone . '</a></td></tr>'
    . '<tr><td style="color:#6b7280;">Vehículo</td><td>' . $drvVehicle . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Placa</td><td><strong>' . $drvPlate . '</strong></td></tr>'
    . '</table>'
    . '<p style="margin:10px 0 0;font-size:11px;color:#7f1d1d;font-style:italic;">'
    . 'Si la fiscalía o un juzgado requiere documentación adicional (cédula, licencia, RCV, certificado de circulación) podés solicitarla a legal@higoapp.com indicando este número de ride.'
    . '</p>'
    . '</div>'

    . '<h3 style="margin:24px 0 8px;color:#111827;font-size:15px;">Datos del envío para tu denuncia</h3>'
    . '<table cellpadding="6" cellspacing="0" style="font-size:13px;color:#111827;border-collapse:collapse;">'
    . '<tr><td style="color:#6b7280;">Ride</td><td>' . $rideIdSafe . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Origen</td><td>' . $pickupSafe . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Destino</td><td>' . $dropoffSafe . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Entregado (registro app)</td><td>' . $deliveredAt . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Valor declarado</td><td><strong>USD ' . $declVal . '</strong></td></tr>'
    . '<tr><td style="color:#6b7280;">Tu descripción</td><td>' . ($claimDesc !== '' ? $claimDesc : '—') . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Nota de Higo</td><td>' . ($claimNote !== '' ? $claimNote : '—') . '</td></tr>'
    . '</table>'

    . '<div style="margin:24px 0 0;padding:14px;background:#f3f4f6;border-radius:8px;">'
    . '<p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">'
    . '<strong>Próximos pasos sugeridos:</strong> ante una pérdida o daño material, podés radicar denuncia formal ante CICPC (penal) o demandar civilmente al chofer. '
    . 'Conservá este correo y la conversación en la app como evidencia documental. '
    . 'Si la fiscalía o un juez requiere oficialmente más información, Higo cooperará con autoridades competentes — los requerimientos deben dirigirse a '
    . '<a href="mailto:' . $safe($legalEmail) . '" style="color:#2563eb;">' . $safe($legalEmail) . '</a>.'
    . '</p>'
    . '</div>'

    . '<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">'
    . 'Si necesitás aclarar algo de este caso, respondé este email o escribinos a '
    . '<a href="mailto:' . $safe($adminEmail) . '" style="color:#2563eb;">' . $safe($adminEmail) . '</a>.'
    . '</p>'

    . '<p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">'
    . 'Higo · Plataforma de intermediación tecnológica. Esta comunicación se envía en cumplimiento de los T&amp;C de Higo Envíos.'
    . '</p>'

    . '</td></tr></table></body></html>';

$subject = '=?UTF-8?B?' . base64_encode('Resolución de reclamo Higo Envíos · Ride ' . $rideIdSafe) . '?=';

$headers  = "From: {$mailFrom}\r\n";
$headers .= "Reply-To: {$adminEmail}\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: text/html; charset=utf-8\r\n";
$headers .= "X-Priority: 3\r\n";

$mailOk = @mail($claimantEmail, $subject, $html, $headers);
if (!$mailOk) {
    error_log(sprintf(
        '[CLAIM] mail() failed: claim=%s to=%s from=%s',
        $claimId, $claimantEmail, $mailFrom
    ));
}

// Copia a legal/admin para audit
@mail($adminEmail, $subject, $html, $headers);

claim_send(200, [
    'ok' => true,
    'email_ok' => (bool) $mailOk,
    'sent_to' => $claimantEmail,
]);
