<?php
declare(strict_types=1);

/**
 * api/send-support-push.php — Push FCM para el chat de soporte.
 *
 * Lo invoca el frontend (SupportChatWidget y AdminSupportPage) en
 * fire-and-forget tras insertar un mensaje. Decide a quién despertar:
 *
 *   sender_role='user'  → push a TODOS los admins con fcm_token
 *   sender_role='admin' → push al user dueño del hilo (si tiene fcm_token)
 *
 * Auth: header Authorization: Bearer <JWT del caller>. Se verifica
 *       contra /auth/v1/user. El caller debe ser el sender del último
 *       mensaje del hilo (anti-replay barato).
 *
 * Body JSON: { thread_id: int }
 *
 * Config requerido en /home/<user>/private/higo-banesco.php:
 *   - FIREBASE_PROJECT_ID
 *   - FIREBASE_SA_PATH
 *   - SUPABASE_PROJECT_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Salida: { ok, sent, skipped, errors[] } o { ok:false, error, detail? }
 */

require_once __DIR__ . '/../banesco-core.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function ssp_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    ssp_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// ═══ Auth: Bearer JWT del usuario que envió el mensaje ══════════════════
$auth = $_SERVER['HTTP_AUTHORIZATION']
     ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
     ?? '';
if (!str_starts_with($auth, 'Bearer ') || substr_count($auth, '.') < 2) {
    ssp_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = substr($auth, 7);

// ═══ Config ═════════════════════════════════════════════════════════════
try {
    $cfg = bl_load_config();
} catch (Throwable $e) {
    ssp_send(503, ['ok' => false, 'error' => 'config_missing', 'detail' => $e->getMessage()]);
}

$supaUrl   = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaKey   = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
$projectId = (string) ($cfg['FIREBASE_PROJECT_ID'] ?? '');
$saPath    = (string) ($cfg['FIREBASE_SA_PATH'] ?? '');
foreach (['SUPABASE_PROJECT_URL','SUPABASE_SERVICE_ROLE_KEY','FIREBASE_PROJECT_ID','FIREBASE_SA_PATH'] as $k) {
    if (empty($cfg[$k])) {
        ssp_send(503, ['ok' => false, 'error' => 'config_incomplete', 'detail' => "missing_$k"]);
    }
}

// ═══ Body ═══════════════════════════════════════════════════════════════
$raw  = (string) file_get_contents('php://input');
$data = json_decode($raw, true);
$threadId = (int) ($data['thread_id'] ?? 0);
if ($threadId <= 0) {
    ssp_send(400, ['ok' => false, 'error' => 'bad_request', 'detail' => 'thread_id required']);
}

// ═══ Verificar caller ═══════════════════════════════════════════════════
[$uStatus, $uBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $callerJwt]
);
if ($uStatus !== 200) {
    ssp_send(401, ['ok' => false, 'error' => 'invalid_token']);
}
$caller = json_decode($uBody, true);
$callerId = (string) ($caller['id'] ?? '');
if ($callerId === '') {
    ssp_send(401, ['ok' => false, 'error' => 'invalid_token']);
}

// ═══ Cargar el hilo + último mensaje ════════════════════════════════════
[$tStatus, $tBody] = bl_http_get(
    $supaUrl . '/rest/v1/support_threads?id=eq.' . $threadId . '&select=id,user_id,status',
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey]
);
$threads = json_decode($tBody, true);
if (!is_array($threads) || empty($threads[0])) {
    ssp_send(404, ['ok' => false, 'error' => 'thread_not_found']);
}
$thread = $threads[0];
$threadUserId = (string) $thread['user_id'];

[$mStatus, $mBody] = bl_http_get(
    $supaUrl . '/rest/v1/support_messages?thread_id=eq.' . $threadId
        . '&select=id,sender_id,sender_role,content,attachment_path,attachment_mime,created_at'
        . '&order=created_at.desc&limit=1',
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey]
);
$messages = json_decode($mBody, true);
if (!is_array($messages) || empty($messages[0])) {
    ssp_send(200, ['ok' => true, 'sent' => 0, 'skipped' => 0, 'errors' => [], 'note' => 'no_messages']);
}
$lastMsg = $messages[0];

// Sanity / anti-replay barato: el caller debe ser el sender del último msj.
if (($lastMsg['sender_id'] ?? '') !== $callerId) {
    ssp_send(409, ['ok' => false, 'error' => 'sender_mismatch']);
}

$senderRole     = (string) $lastMsg['sender_role'];
$content        = (string) ($lastMsg['content'] ?? '');
$attachmentPath = (string) ($lastMsg['attachment_path'] ?? '');
$attachmentMime = (string) ($lastMsg['attachment_mime'] ?? '');
$hasAttachment  = $attachmentPath !== '';
$isImageAtt     = $hasAttachment && str_starts_with($attachmentMime, 'image/');
$isAudioAtt     = $hasAttachment && str_starts_with($attachmentMime, 'audio/');
$isPdfAtt       = $hasAttachment && $attachmentMime === 'application/pdf';
$attLabel       = $isImageAtt ? '🖼️ Imagen'
                : ($isAudioAtt ? '🎤 Audio'
                : ($isPdfAtt   ? '📄 PDF'
                : ($hasAttachment ? '📎 Archivo' : '')));
// Preview con fallback al label del adjunto si vino sin texto.
$preview = $content !== ''
    ? mb_substr($content, 0, 140)
    : $attLabel;

// ═══ Resolver destinatarios ═════════════════════════════════════════════
$recipients = [];   // [{id, full_name, fcm_token}]
$clickAction = '/#/';

if ($senderRole === 'user') {
    // Push a todos los admins con token.
    [$rStatus, $rBody] = bl_http_get(
        $supaUrl . '/rest/v1/profiles?role=eq.admin'
            . '&fcm_token=not.is.null'
            . '&select=id,full_name,fcm_token',
        ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey]
    );
    $recipients = is_array(json_decode($rBody, true)) ? json_decode($rBody, true) : [];
    $clickAction = '/#/admin/support?thread=' . $threadId;
} elseif ($senderRole === 'admin') {
    // Push al user dueño del hilo.
    [$rStatus, $rBody] = bl_http_get(
        $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($threadUserId)
            . '&fcm_token=not.is.null'
            . '&select=id,full_name,fcm_token',
        ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey]
    );
    $recipients = is_array(json_decode($rBody, true)) ? json_decode($rBody, true) : [];
    $clickAction = '/#/';
} else {
    ssp_send(400, ['ok' => false, 'error' => 'bad_sender_role']);
}

// No mandar push al propio sender (caso admin↔admin, autoenvío, etc.)
$recipients = array_values(array_filter($recipients, fn($p) => ($p['id'] ?? '') !== $callerId));

if (empty($recipients)) {
    ssp_send(200, ['ok' => true, 'sent' => 0, 'skipped' => 0, 'errors' => [], 'note' => 'no_recipients']);
}

// ═══ OAuth2 SA → Bearer (FCM HTTP v1) ═══════════════════════════════════
// Misma implementación que send-membership-reminders.php. Se duplica acá
// adrede para no tocar el cron de membresías en producción.
function ssp_get_google_access_token(string $saPath): string {
    if (!is_file($saPath)) {
        throw new RuntimeException("SA JSON no existe en $saPath");
    }
    $cachePath = sys_get_temp_dir() . '/higo-fcm-token-' . md5($saPath) . '.json';
    if (is_file($cachePath)) {
        $cached = json_decode((string) @file_get_contents($cachePath), true);
        if (is_array($cached) && ($cached['expires'] ?? 0) > time() + 60) {
            return (string) $cached['token'];
        }
    }
    $sa = json_decode((string) file_get_contents($saPath), true);
    if (!is_array($sa) || empty($sa['client_email']) || empty($sa['private_key'])) {
        throw new RuntimeException('SA JSON inválido');
    }
    $now = time();
    $header = ['alg' => 'RS256', 'typ' => 'JWT'];
    $claim  = [
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ];
    $b64 = static fn(string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $unsigned = $b64((string) json_encode($header, JSON_UNESCAPED_SLASHES))
              . '.' . $b64((string) json_encode($claim,  JSON_UNESCAPED_SLASHES));
    $sig = '';
    if (!openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('openssl_sign failed');
    }
    $jwt = $unsigned . '.' . $b64($sig);
    [$status, $body] = bl_http_post(
        'https://oauth2.googleapis.com/token',
        http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        ['Content-Type: application/x-www-form-urlencoded'],
        15
    );
    if ($status !== 200) {
        throw new RuntimeException("google_oauth_$status");
    }
    $tokenResp = json_decode($body, true);
    if (!is_array($tokenResp) || empty($tokenResp['access_token'])) {
        throw new RuntimeException('bad_token_response');
    }
    @file_put_contents($cachePath, (string) json_encode([
        'token'   => $tokenResp['access_token'],
        'expires' => $now + (int) ($tokenResp['expires_in'] ?? 3000),
    ]));
    return (string) $tokenResp['access_token'];
}

try {
    $accessToken = ssp_get_google_access_token($saPath);
} catch (Throwable $e) {
    ssp_send(500, ['ok' => false, 'error' => 'oauth_fail', 'detail' => $e->getMessage()]);
}

// ═══ Enviar pushes ══════════════════════════════════════════════════════
$senderName = '';
$senderPhone = '';
$senderRoleDb = '';
[, $sBody] = bl_http_get(
    $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode($callerId) . '&select=full_name,phone,role',
    ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey]
);
$sp = json_decode($sBody, true);
if (is_array($sp) && !empty($sp[0])) {
    $senderName   = (string) ($sp[0]['full_name'] ?? '');
    $senderPhone  = (string) ($sp[0]['phone'] ?? '');
    $senderRoleDb = (string) ($sp[0]['role'] ?? '');
}
$senderEmail = (string) ($caller['email'] ?? '');

$title = $senderRole === 'admin'
    ? 'Soporte Higo'
    : ('Soporte · ' . ($senderName !== '' ? $senderName : 'Usuario'));

$sent = 0;
$skipped = 0;
$errors = [];

foreach ($recipients as $rcpt) {
    $token = (string) ($rcpt['fcm_token'] ?? '');
    if ($token === '') { $skipped++; continue; }

    $fcmPayload = [
        'message' => [
            'token'        => $token,
            'notification' => ['title' => $title, 'body' => $preview],
            'data'         => [
                'type'         => 'support_message',
                'thread_id'    => (string) $threadId,
                'sender_role'  => $senderRole,
                'click_action' => $clickAction,
            ],
            'webpush' => [
                'fcm_options'  => ['link' => $clickAction],
                'notification' => [
                    'icon'    => '/higo-icon.svg',
                    'vibrate' => [200, 100, 200],
                ],
            ],
        ],
    ];

    [$fcmStatus, $fcmBody] = bl_http_post(
        "https://fcm.googleapis.com/v1/projects/$projectId/messages:send",
        (string) json_encode($fcmPayload, JSON_UNESCAPED_SLASHES),
        [
            'Authorization: Bearer ' . $accessToken,
            'Content-Type: application/json',
        ],
        15
    );

    if ($fcmStatus >= 200 && $fcmStatus < 300) {
        $sent++;
        continue;
    }

    // Token muerto → limpiar para que el próximo registro lo reemplace.
    if ($fcmStatus === 404 || ($fcmStatus === 400 && stripos((string) $fcmBody, 'UNREGISTERED') !== false)) {
        bl_http_post(
            $supaUrl . '/rest/v1/profiles?id=eq.' . rawurlencode((string) $rcpt['id']),
            (string) json_encode(['fcm_token' => null]),
            [
                'apikey: ' . $supaKey,
                'Authorization: Bearer ' . $supaKey,
                'Content-Type: application/json',
                'Prefer: return=minimal',
            ],
            10
        );
    }

    $errors[] = [
        'recipient_id' => (string) ($rcpt['id'] ?? ''),
        'fcm_status'   => $fcmStatus,
        'message'      => substr((string) $fcmBody, 0, 200),
    ];
}

// ═══ Email a admin@higoapp.com (solo para mensajes del USER) ════════════
// Queda como registro permanente fuera de la app. Los mensajes del admin
// no generan email (sería el equipo enviándose correos a sí mismo).
$emailSent = false;
if ($senderRole === 'user') {
    // Si el mensaje vino con imagen, generamos una signed URL larga (7 días)
    // contra el bucket privado support-attachments. La imagen viaja como
    // <img src> remoto — Gmail la proxea y cachea al abrir el correo.
    $attachmentSignedUrl = '';
    if ($hasAttachment) {
        [$sigStatus, $sigBody] = bl_http_post(
            $supaUrl . '/storage/v1/object/sign/support-attachments/' . $attachmentPath,
            (string) json_encode(['expiresIn' => 7 * 24 * 3600]),
            [
                'apikey: ' . $supaKey,
                'Authorization: Bearer ' . $supaKey,
                'Content-Type: application/json',
            ],
            10
        );
        if ($sigStatus >= 200 && $sigStatus < 300) {
            $sigResp = json_decode((string) $sigBody, true);
            $relUrl = $sigResp['signedURL'] ?? $sigResp['signedUrl'] ?? '';
            if ($relUrl !== '') {
                $attachmentSignedUrl = $supaUrl . '/storage/v1' . $relUrl;
            }
        }
    }

    $supportUrl = 'https://higoapp.com/#/admin/support?thread=' . $threadId;
    $roleLabel  = $senderRoleDb === 'driver' ? 'Conductor' : 'Pasajero';

    $safeName  = htmlspecialchars($senderName !== '' ? $senderName : '(sin nombre)', ENT_QUOTES);
    $safeEmail = htmlspecialchars($senderEmail, ENT_QUOTES);
    $safePhone = htmlspecialchars($senderPhone !== '' ? $senderPhone : '—', ENT_QUOTES);
    $safeRole  = htmlspecialchars($roleLabel, ENT_QUOTES);
    $hasText   = $content !== '';
    $safeMsg   = $hasText ? nl2br(htmlspecialchars($content, ENT_QUOTES)) : '';
    $safePrev  = htmlspecialchars(
        $hasText ? mb_substr($content, 0, 80) : $attLabel,
        ENT_QUOTES
    );
    $sentTs    = htmlspecialchars(gmdate('Y-m-d H:i:s') . ' UTC', ENT_QUOTES);

    $attachmentHtml = '';
    if ($attachmentSignedUrl !== '') {
        $safeAttach = htmlspecialchars($attachmentSignedUrl, ENT_QUOTES);
        if ($isImageAtt) {
            $attachmentHtml =
                  '<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:.5px;">Imagen adjunta</p>'
                . '<a href="' . $safeAttach . '" target="_blank" style="display:block;margin-bottom:18px;">'
                . '<img src="' . $safeAttach . '" alt="Adjunto" style="max-width:100%;max-height:400px;border-radius:10px;border:1px solid #e5e7eb;display:block;" />'
                . '</a>';
        } else {
            // PDF, audio u otro: tarjeta clickeable. Los clientes de email
            // no reproducen audio embebido confiablemente, así que damos
            // un link grande que abre la signed URL en el navegador.
            $cardTitle = $isPdfAtt   ? 'Documento PDF adjunto'
                       : ($isAudioAtt ? 'Audio adjunto' : 'Archivo adjunto');
            $cardIcon  = $isPdfAtt   ? '📄'
                       : ($isAudioAtt ? '🎤' : '📎');
            $cardSub   = $isPdfAtt   ? 'Tap para abrir el PDF en una pestaña nueva.'
                       : ($isAudioAtt ? 'Tap para escuchar el audio.'
                       : 'Tap para descargar.');
            $attachmentHtml =
                  '<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:.5px;">Adjunto</p>'
                . '<a href="' . $safeAttach . '" target="_blank" style="display:flex;align-items:center;gap:12px;margin-bottom:18px;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:#111827;">'
                . '<span style="font-size:32px;line-height:1;">' . $cardIcon . '</span>'
                . '<span style="flex:1;min-width:0;">'
                . '<span style="display:block;font-weight:700;font-size:14px;color:#111827;">' . htmlspecialchars($cardTitle, ENT_QUOTES) . '</span>'
                . '<span style="display:block;font-size:12px;color:#6b7280;margin-top:2px;">' . htmlspecialchars($cardSub, ENT_QUOTES) . '</span>'
                . '</span>'
                . '</a>';
        }
    }

    $html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>'
        . '<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">'
        . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">'
        . '<tr><td style="background:linear-gradient(135deg,#7c3aed,#c026d3);padding:20px 24px;color:#fff;">'
        . '<p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.9;font-weight:700;">Soporte Higo · ' . $safeRole . '</p>'
        . '<h1 style="margin:4px 0 0;font-size:20px;font-weight:800;">' . $safeName . '</h1>'
        . '</td></tr>'

        . '<tr><td style="padding:24px;color:#1f2937;font-size:14px;line-height:1.6;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin:0 0 18px;">'
        . '<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;"><b>Correo:</b> ' . $safeEmail . '</td></tr>'
        . '<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;"><b>Teléfono:</b> ' . $safePhone . '</td></tr>'
        . '<tr><td style="padding:10px 14px;font-size:12px;color:#6b7280;"><b>Hilo:</b> #' . $threadId . ' · ' . $sentTs . '</td></tr>'
        . '</table>'

        . $attachmentHtml
        . ($hasText
            ? '<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:.5px;">Mensaje</p>'
              . '<div style="background:#f3f4f6;border-left:3px solid #7c3aed;padding:12px 16px;border-radius:6px;color:#111827;font-size:14px;white-space:pre-wrap;">'
              . $safeMsg
              . '</div>'
            : '<p style="margin:0;color:#6b7280;font-size:13px;font-style:italic;">(El usuario solo envió una imagen, sin texto.)</p>'
          )

        . '<p style="text-align:center;margin:24px 0 0;">'
        . '<a href="' . htmlspecialchars($supportUrl, ENT_QUOTES) . '" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">'
        . 'Responder en el panel'
        . '</a></p>'
        . '</td></tr>'

        . '<tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#6b7280;">'
        . 'Este correo se generó automáticamente por un mensaje en el chat de soporte. '
        . 'Para responderle al usuario abrí el panel — Reply-To apunta al equipo.'
        . '</td></tr>'
        . '</table></td></tr></table></body></html>';

    $plainBody = $hasText
        ? "Mensaje:\n{$content}\n\n"
        : "(Mensaje sin texto, solo adjunto: {$attLabel}.)\n\n";
    $plainAttach = $attachmentSignedUrl !== ''
        ? "{$attLabel}: {$attachmentSignedUrl}\n\n"
        : '';
    $plain = "Soporte Higo · {$roleLabel}\n"
        . str_repeat('-', 50) . "\n"
        . "De: {$senderName} <{$senderEmail}>\n"
        . "Teléfono: " . ($senderPhone !== '' ? $senderPhone : '—') . "\n"
        . "Hilo: #{$threadId}\n"
        . "Fecha: " . gmdate('Y-m-d H:i:s') . " UTC\n\n"
        . $plainBody
        . $plainAttach
        . "Responder en el panel: {$supportUrl}\n";

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

    $subjectPreview = $hasText ? mb_substr($content, 0, 80) : $attLabel;
    $subject = "=?UTF-8?B?" . base64_encode("[Soporte] {$senderName} — {$subjectPreview}") . "?=";
    $headers  = "From: noreply@higoapp.com\r\n";
    $headers .= "Reply-To: admin@higoapp.com\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    $emailSent = (bool) @mail('admin@higoapp.com', $subject, $body, $headers);
}

ssp_send(200, [
    'ok'         => true,
    'sent'       => $sent,
    'skipped'    => $skipped,
    'errors'     => $errors,
    'email_sent' => $emailSent,
]);
