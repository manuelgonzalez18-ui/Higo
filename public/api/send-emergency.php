<?php
/**
 * send-emergency.php
 * Procesa una alerta SOS disparada desde RideStatusPage o DriverDashboard:
 *   1. Valida Bearer JWT del user.
 *   2. Inserta una fila en sos_events con snapshot del ride + ubicación.
 *   3. Manda email rich a admin@higoapp.com con todos los datos para
 *      que support pueda actuar (llamar al 911, contactar al user,
 *      al chofer / pasajero según corresponda).
 *
 * Sin SMS / Twilio (out of scope). El admin recibe el email y desde
 * ahí coordina llamadas/WhatsApp con los datos provistos.
 *
 * Auth: Bearer JWT (mismo patrón que banesco-validate, notify-payment).
 * CORS + rate limit: vía los helpers _cors.php y _ratelimit.php.
 */

require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$_cfg = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($_cfg, 'POST, OPTIONS');
// Cap a 10 req/min/IP. Suficientemente alto para retests honestos
// (el usuario suele probar SOS 2-3 veces seguidas para validar) y
// suficientemente bajo para frenar abuso real (>10 SOS reales por
// minuto desde la misma IP es spam, no emergencia).
api_rate_limit('send-emergency', 10, '/tmp/higo_ratelimit.log');

header('Content-Type: application/json; charset=utf-8');

function emerg_send(int $code, array $payload): void {
    http_response_code($code);
    echo (string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// bl_http_patch vive en public/banesco-core.php (require_once arriba),
// junto al resto de los helpers cURL.

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    emerg_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ─── Auth ────────────────────────────────────────────────────────────
$auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
    emerg_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$token = trim($m[1]);

$supaUrl = rtrim((string) ($_cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaSrv = (string) ($_cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
$supaAnon = (string) ($_cfg['SUPABASE_ANON_KEY'] ?? '');
if ($supaUrl === '' || $supaSrv === '' || $supaAnon === '') {
    emerg_send(503, ['ok' => false, 'error' => 'config_missing']);
}

[$uStatus, $uBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaAnon, 'Authorization: Bearer ' . $token]
);
if ($uStatus !== 200) {
    emerg_send(401, ['ok' => false, 'error' => 'bad_token']);
}
$user = json_decode((string) $uBody, true);
$userId = (string) ($user['id'] ?? '');
$userEmail = (string) ($user['email'] ?? '');
if ($userId === '') {
    emerg_send(401, ['ok' => false, 'error' => 'no_user_id']);
}

// ─── Input ───────────────────────────────────────────────────────────
$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    emerg_send(400, ['ok' => false, 'error' => 'bad_json']);
}
$rideId      = isset($body['ride_id']) ? (int) $body['ride_id'] : 0;
$lat         = isset($body['lat']) ? (float) $body['lat'] : null;
$lng         = isset($body['lng']) ? (float) $body['lng'] : null;
$triggeredBy = (string) ($body['triggered_by'] ?? 'passenger'); // 'passenger'|'driver'
if (!in_array($triggeredBy, ['passenger', 'driver'], true)) {
    emerg_send(400, ['ok' => false, 'error' => 'bad_triggered_by']);
}

// ─── Recolectar contexto ────────────────────────────────────────────
// Profile del que disparó (con service_role para saltar RLS).
[$pStatus, $pBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($userId)
        . '&select=full_name,phone,role,avatar_url',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$callerProfile = ($pStatus === 200) ? (json_decode((string) $pBody, true)[0] ?? null) : null;

// Ride + contraparte si hay ride_id.
$ride = null;
$counterpartId = null;
$counterpartProfile = null;
if ($rideId > 0) {
    [$rStatus, $rBody] = bl_http_get(
        $supaUrl . '/rest/v1/rides?id=eq.' . $rideId
            . '&select=id,user_id,driver_id,pickup,dropoff,status,vehicle_model,license_plate,created_at',
        ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
    );
    if ($rStatus === 200) {
        $ride = json_decode((string) $rBody, true)[0] ?? null;
        if ($ride) {
            $counterpartId = ($triggeredBy === 'passenger')
                ? ($ride['driver_id'] ?? null)
                : ($ride['user_id'] ?? null);
        }
    }
}
if ($counterpartId) {
    [$cpStatus, $cpBody] = bl_http_get(
        $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode((string) $counterpartId)
            . '&select=full_name,phone,role,license_plate,vehicle_model,vehicle_color,avatar_url',
        ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
    );
    if ($cpStatus === 200) {
        $counterpartProfile = json_decode((string) $cpBody, true)[0] ?? null;
    }
}

// Contactos de emergencia del user (puede estar vacío).
[$ecStatus, $ecBody] = bl_http_get(
    $supaUrl . '/rest/v1/emergency_contacts?user_id=eq.' . rawurlencode($userId)
        . '&select=name,phone,relationship&order=created_at.asc&limit=10',
    ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
);
$contacts = ($ecStatus === 200) ? (json_decode((string) $ecBody, true) ?? []) : [];

// ─── Persistir el evento ────────────────────────────────────────────
$metadata = [
    'caller'      => $callerProfile,
    'ride'        => $ride,
    'counterpart' => $counterpartProfile,
    'contacts'    => $contacts,
    'user_agent'  => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
    'caller_ip'   => $_SERVER['REMOTE_ADDR'] ?? null,
];
$insertBody = json_encode([
    'user_id'        => $userId,
    'ride_id'        => $rideId > 0 ? $rideId : null,
    'counterpart_id' => $counterpartId,
    'triggered_by'   => $triggeredBy,
    'location_lat'   => $lat,
    'location_lng'   => $lng,
    'metadata'       => $metadata,
]);
[$insStatus, $insBody] = bl_http_post(
    $supaUrl . '/rest/v1/sos_events',
    (string) $insertBody,
    [
        'apikey: ' . $supaSrv,
        'Authorization: Bearer ' . $supaSrv,
        'Content-Type: application/json',
        'Prefer: return=representation',
    ]
);
$sosId = null;
if ($insStatus >= 200 && $insStatus < 300) {
    $sosId = (json_decode((string) $insBody, true)[0] ?? null)['id'] ?? null;
}

// ─── Integración con Chat de Soporte Administrativo ──────────────────
try {
    // 1. Buscar si ya existe el hilo de soporte para este rol y usuario
    [$stStatus, $stBody] = bl_http_get(
        $supaUrl . '/rest/v1/support_threads?user_id=eq.' . rawurlencode($userId) . '&role_context=eq.' . rawurlencode($triggeredBy) . '&select=id',
        ['apikey: ' . $supaSrv, 'Authorization: Bearer ' . $supaSrv]
    );

    $threadId = null;
    if ($stStatus === 200) {
        $threadsList = json_decode((string) $stBody, true);
        if (!empty($threadsList[0]['id'])) {
            $threadId = (int) $threadsList[0]['id'];
        }
    }

    if ($threadId === null) {
        // 2. Si no existe, crear el hilo
        $stInsert = [
            'user_id' => $userId,
            'role_context' => $triggeredBy,
            'status' => 'open',
            'unread_for_admin' => true,
        ];
        [$stInsStatus, $stInsBody] = bl_http_post(
            $supaUrl . '/rest/v1/support_threads',
            (string) json_encode($stInsert),
            [
                'apikey: ' . $supaSrv,
                'Authorization: Bearer ' . $supaSrv,
                'Content-Type: application/json',
                'Prefer: return=representation',
            ]
        );
        if ($stInsStatus >= 200 && $stInsStatus < 300) {
            $newThread = json_decode((string) $stInsBody, true);
            if (!empty($newThread[0]['id'])) {
                $threadId = (int) $newThread[0]['id'];
            }
        }
    } else {
        // 3. Si existe, reabrirlo
        $stUpdate = [
            'status' => 'open',
            'unread_for_admin' => true,
            'last_message_at' => gmdate('c'),
        ];
        bl_http_patch(
            $supaUrl . '/rest/v1/support_threads?id=eq.' . $threadId,
            (string) json_encode($stUpdate),
            [
                'apikey: ' . $supaSrv,
                'Authorization: Bearer ' . $supaSrv,
                'Content-Type: application/json',
            ]
        );
    }

    if ($threadId !== null) {
        // 4. Construir y enviar el mensaje enriquecido
        $triggeredLabel = $triggeredBy === 'passenger' ? 'Pasajero' : 'Conductor';
        $rawCallerName  = (string) ($callerProfile['full_name'] ?? '(sin nombre)');
        $rawCallerPhone = (string) ($callerProfile['phone']     ?? '—');
        $rawCpName      = (string) ($counterpartProfile['full_name']    ?? '—');
        $rawCpPhone     = (string) ($counterpartProfile['phone']        ?? '—');
        $rawCpPlate     = (string) ($counterpartProfile['license_plate'] ?? '—');
        $rawCpVehicle   = trim(($counterpartProfile['vehicle_model'] ?? '') . ' ' . ($counterpartProfile['vehicle_color'] ?? '')) ?: '—';
        $rawPickup      = (string) ($ride['pickup']  ?? '—');
        $rawDropoff     = (string) ($ride['dropoff'] ?? '—');
        $rawMapsLink    = ($lat !== null && $lng !== null)
            ? 'https://www.google.com/maps?q=' . $lat . ',' . $lng
            : 'Ubicación no disponible';

        $contactsText = '';
        if (!empty($contacts)) {
            foreach ($contacts as $c) {
                $cName  = (string) $c['name'];
                $cPhone = (string) $c['phone'];
                $cRel   = (string) ($c['relationship'] ?? '');
                $waLink = 'https://wa.me/' . preg_replace('/[^0-9]/', '', $cPhone);
                $contactsText .= sprintf(
                    "- %s%s: %s (Llamar: tel:%s | WhatsApp: %s)\n",
                    $cName,
                    ($cRel !== '' ? ' (' . $cRel . ')' : ''),
                    $cPhone,
                    $cPhone,
                    $waLink
                );
            }
        } else {
            $contactsText = "(El usuario no tiene contactos de emergencia configurados.)\n";
        }

        $richMessageText = "🚨 ALERTA DE EMERGENCIA SOS DISPARADA 🚨\n"
            . "----------------------------------------\n"
            . "El botón de pánico SOS fue presionado por el " . $triggeredLabel . ".\n\n"
            . "🧑‍✈️ DETALLES DEL USUARIO QUE ALERTA:\n"
            . "- Nombre: " . $rawCallerName . "\n"
            . "- Teléfono: " . $rawCallerPhone . "\n"
            . "- Correo: " . $userEmail . "\n\n"
            . "📍 UBICACIÓN EN VIVO:\n"
            . "- Coordenadas: " . ($lat !== null && $lng !== null ? $lat . ", " . $lng : "No disponibles") . "\n"
            . "- Google Maps: " . $rawMapsLink . "\n\n"
            . "🚗 CONTEXTO DEL VIAJE:\n"
            . "- Viaje ID: " . ($rideId > 0 ? '#' . $rideId : 'Sin viaje activo') . "\n"
            . "- Origen (Pickup): " . $rawPickup . "\n"
            . "- Destino (Dropoff): " . $rawDropoff . "\n"
            . "- Contraparte: " . $rawCpName . " (" . $rawCpPhone . ")\n"
            . "- Vehículo contraparte: " . $rawCpVehicle . " · Placa: " . $rawCpPlate . "\n\n"
            . "📞 CONTACTOS DE EMERGENCIA:\n"
            . $contactsText . "\n"
            . "⚠️ ACCIÓN REQUERIDA:\n"
            . "Por favor, póngase en contacto con el usuario de inmediato. Si no responde y las coordenadas muestran anomalías, escale la situación al 911 indicando la ubicación del vehículo.";

        $msgBody = [
            'thread_id'   => $threadId,
            'sender_id'   => $userId,
            'sender_role' => 'user',
            'content'     => $richMessageText,
        ];

        [$msgStatus, $msgRes] = bl_http_post(
            $supaUrl . '/rest/v1/support_messages',
            (string) json_encode($msgBody),
            [
                'apikey: ' . $supaSrv,
                'Authorization: Bearer ' . $supaSrv,
                'Content-Type: application/json',
                'Prefer: return=representation',
            ]
        );

        if ($msgStatus >= 200 && $msgStatus < 300) {
            // 5. Disparar notificaciones push locales a todos los admins
            $localPushUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://" . $_SERVER['HTTP_HOST'] . "/api/send-support-push.php";
            @bl_http_post(
                $localPushUrl,
                (string) json_encode(['thread_id' => $threadId]),
                [
                    'Authorization: Bearer ' . $token,
                    'Content-Type: application/json',
                ],
                5 // Timeout rápido
            );
        }
    }
} catch (Throwable $e) {
    error_log("[SOS Support Integration Error] " . $e->getMessage());
}

// ─── Email rich a admin@higoapp.com ─────────────────────────────────
$adminEmail = (string) ($_cfg['SUPPORT_ADMIN_EMAIL'] ?? 'admin@higoapp.com');
// IMPORTANTE: From DEBE matchear un mailbox local que existe en
// Hostinger, sin guiones ni display name. `noreply@higoapp.com` está
// validado y funciona en send-support-push.php. Cualquier otra forma
// (Higo <no-reply@higoapp.com>, foo@higoapp.com) puede hacer que el
// MTA de Hostinger rechace el envío silenciosamente y mail() devuelva
// false sin error visible.
$mailFrom   = 'noreply@higoapp.com';

$safe = fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES);
$mapsLink = ($lat !== null && $lng !== null)
    ? 'https://www.google.com/maps?q=' . $lat . ',' . $lng
    : null;

$callerName  = $safe($callerProfile['full_name'] ?? '(sin nombre)');
$callerPhone = $safe($callerProfile['phone']     ?? '—');
$cpName      = $safe($counterpartProfile['full_name']    ?? '—');
$cpPhone     = $safe($counterpartProfile['phone']        ?? '—');
$cpPlate     = $safe($counterpartProfile['license_plate'] ?? '—');
$cpVehicle   = $safe(trim(($counterpartProfile['vehicle_model'] ?? '') . ' ' . ($counterpartProfile['vehicle_color'] ?? '')) ?: '—');
$rideIdSafe  = $safe($rideId > 0 ? '#' . $rideId : '—');
$pickupSafe  = $safe($ride['pickup']  ?? '—');
$dropoffSafe = $safe($ride['dropoff'] ?? '—');
$triggeredLabel = $triggeredBy === 'passenger' ? 'Pasajero' : 'Conductor';

$contactsHtml = '';
if (!empty($contacts)) {
    $contactsHtml .= '<h3 style="margin:18px 0 8px;color:#dc2626;">Contactos de emergencia del usuario</h3><ul style="margin:0;padding-left:18px;color:#111827;font-size:13px;">';
    foreach ($contacts as $c) {
        $cName  = $safe($c['name']);
        $cPhone = $safe($c['phone']);
        $cRel   = $safe($c['relationship'] ?? '');
        $waLink = 'https://wa.me/' . preg_replace('/[^0-9]/', '', (string) $c['phone']);
        $contactsHtml .= '<li style="margin-bottom:6px;">'
            . '<strong>' . $cName . '</strong>'
            . ($cRel !== '' ? ' <span style="color:#6b7280;">(' . $cRel . ')</span>' : '')
            . ' &middot; <a href="tel:' . $cPhone . '" style="color:#2563eb;">' . $cPhone . '</a>'
            . ' &middot; <a href="' . $waLink . '" style="color:#16a34a;">WhatsApp</a>'
            . '</li>';
    }
    $contactsHtml .= '</ul>';
} else {
    $contactsHtml = '<p style="margin:18px 0 0;color:#6b7280;font-style:italic;">El usuario no tiene contactos de emergencia configurados.</p>';
}

$html = '<!doctype html><html><body style="margin:0;font-family:-apple-system,sans-serif;background:#f3f4f6;padding:24px;">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">'
    . '<tr><td style="background:#dc2626;color:white;padding:20px 24px;">'
    . '<h1 style="margin:0;font-size:22px;">🚨 ALERTA SOS</h1>'
    . '<p style="margin:6px 0 0;opacity:.9;font-size:13px;">Disparada por ' . $triggeredLabel . ' &middot; ' . $safe(gmdate('Y-m-d H:i:s') . ' UTC') . '</p>'
    . '</td></tr>'
    . '<tr><td style="padding:24px;">'
    . '<h3 style="margin:0 0 8px;color:#111827;">Quién disparó</h3>'
    . '<p style="margin:0;color:#111827;font-size:14px;"><strong>' . $callerName . '</strong> &middot; '
    . '<a href="tel:' . $callerPhone . '" style="color:#2563eb;">' . $callerPhone . '</a> &middot; '
    . '<a href="mailto:' . $safe($userEmail) . '" style="color:#2563eb;">' . $safe($userEmail) . '</a>'
    . '</p>'
    . ($mapsLink ? '<p style="margin:8px 0 0;font-size:14px;"><a href="' . $safe($mapsLink) . '" style="display:inline-block;padding:8px 14px;background:#dc2626;color:white;border-radius:8px;text-decoration:none;font-weight:bold;">📍 Ver ubicación en Google Maps</a></p>' : '<p style="margin:8px 0 0;color:#6b7280;font-style:italic;">Ubicación no disponible</p>')
    . '<h3 style="margin:24px 0 8px;color:#111827;">Contexto del viaje</h3>'
    . '<table cellpadding="6" cellspacing="0" style="font-size:13px;color:#111827;border-collapse:collapse;">'
    . '<tr><td style="color:#6b7280;">Ride</td><td><strong>' . $rideIdSafe . '</strong></td></tr>'
    . '<tr><td style="color:#6b7280;">Pickup</td><td>' . $pickupSafe . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Destino</td><td>' . $dropoffSafe . '</td></tr>'
    . '<tr><td style="color:#6b7280;">Contraparte</td><td><strong>' . $cpName . '</strong></td></tr>'
    . '<tr><td style="color:#6b7280;">Teléfono</td><td><a href="tel:' . $cpPhone . '" style="color:#2563eb;">' . $cpPhone . '</a></td></tr>'
    . '<tr><td style="color:#6b7280;">Vehículo</td><td>' . $cpVehicle . ' &middot; placa <strong>' . $cpPlate . '</strong></td></tr>'
    . '</table>'
    . $contactsHtml
    . '<p style="margin:24px 0 0;padding:12px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e;">Acción sugerida: llamar al pasajero/conductor para verificar, escalar al 911 si no responde. Marcar como resuelto en el panel admin cuando el incidente se cierre.'
    . ($sosId ? ' &middot; SOS event #' . $sosId : '')
    . '</p>'
    . '</td></tr></table></body></html>';

// Subject base64-encoded UTF-8 para que el emoji 🚨 no se mangle ni
// dispare filtros de spam por mojibake (mismo patrón que send-support-
// push.php que SÍ funciona en prod).
$subject = '=?UTF-8?B?' . base64_encode('🚨 SOS Higo · ' . $callerName . ' · ' . $triggeredLabel) . '?=';

// Headers como string concatenado (no array imploded), mismo formato
// que el endpoint que funciona. Reply-To apunta a admin para que
// responder al email vuelva al inbox correcto.
$headers  = "From: {$mailFrom}\r\n";
$headers .= "Reply-To: {$adminEmail}\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: text/html; charset=utf-8\r\n";
$headers .= "X-Priority: 1\r\n";
$headers .= "X-MSMail-Priority: High\r\n";

$mailOk = @mail($adminEmail, $subject, $html, $headers);
if (!$mailOk) {
    // mail() devuelve false si el MTA local rechazó el envío. Log
    // para que el admin pueda revisar en Hostinger cPanel → Error Logs.
    error_log(sprintf(
        '[SOS] mail() failed: to=%s from=%s subject_len=%d body_len=%d',
        $adminEmail, $mailFrom, strlen($subject), strlen($html)
    ));
}

emerg_send(200, [
    'ok'        => true,
    'sos_id'    => $sosId,
    'email_ok'  => (bool) $mailOk,
    'contacts'  => count($contacts),
]);
