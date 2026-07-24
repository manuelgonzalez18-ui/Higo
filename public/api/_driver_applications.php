<?php
declare(strict_types=1);

require_once __DIR__ . '/../banesco-core.php';

if (defined('HIGO_DRIVER_APPLICATION_HELPERS_LOADED')) return;
define('HIGO_DRIVER_APPLICATION_HELPERS_LOADED', true);

function da_send(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function da_config(): array {
    try {
        $cfg = bl_load_config();
    } catch (Throwable $e) {
        da_send(503, ['ok' => false, 'error' => 'config_missing']);
    }
    $url = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
    $anon = (string) ($cfg['SUPABASE_ANON_KEY'] ?? '');
    $service = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? $cfg['SUPABASE_SERVICE_ROLE'] ?? '');
    if ($url === '' || $anon === '' || $service === '') {
        da_send(503, ['ok' => false, 'error' => 'config_incomplete']);
    }
    $cfg['_supabase_url'] = $url;
    $cfg['_supabase_anon'] = $anon;
    $cfg['_supabase_service'] = $service;
    return $cfg;
}

function da_json_input(): array {
    $raw = file_get_contents('php://input') ?: '';
    $input = json_decode($raw, true);
    if (!is_array($input)) da_send(400, ['ok' => false, 'error' => 'invalid_json']);
    return $input;
}

function da_bearer_token(): string {
    $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        da_send(401, ['ok' => false, 'error' => 'unauthorized']);
    }
    return trim($matches[1]);
}

/** @return array{0:string,1:string,2:array} caller id, JWT, admin context */
function da_require_admin(array $cfg, string $permission = 'manage_drivers', bool $sensitive = false): array {
    $jwt = da_bearer_token();
    [$userStatus, $userBody] = bl_http_get(
        $cfg['_supabase_url'] . '/auth/v1/user',
        [
            'apikey: ' . $cfg['_supabase_anon'],
            'Authorization: Bearer ' . $jwt,
            'Accept: application/json',
        ]
    );
    $caller = json_decode($userBody, true);
    $callerId = is_array($caller) ? (string) ($caller['id'] ?? '') : '';
    if ($userStatus !== 200 || $callerId === '') da_send(401, ['ok' => false, 'error' => 'invalid_token']);

    [$contextStatus, $contextBody] = bl_http_post(
        $cfg['_supabase_url'] . '/rest/v1/rpc/admin_get_context',
        '{}',
        [
            'apikey: ' . $cfg['_supabase_anon'],
            'Authorization: Bearer ' . $jwt,
            'Content-Type: application/json',
            'Accept: application/json',
        ]
    );
    $context = json_decode($contextBody, true);
    if ($contextStatus < 200 || $contextStatus >= 300 || !is_array($context)) {
        da_send(403, ['ok' => false, 'error' => 'admin_context_unavailable']);
    }
    if (!($context['authorized'] ?? false) || !(($context['permissions'][$permission] ?? false))) {
        da_send(403, ['ok' => false, 'error' => 'admin_permission_denied']);
    }
    if ($sensitive && ($context['require_mfa'] ?? false) && (($context['aal'] ?? 'aal1') !== 'aal2')) {
        da_send(403, ['ok' => false, 'error' => 'admin_mfa_required']);
    }
    return [$callerId, $jwt, $context];
}

function da_service_headers(array $cfg, array $extra = []): array {
    return array_merge([
        'apikey: ' . $cfg['_supabase_service'],
        'Authorization: Bearer ' . $cfg['_supabase_service'],
        'Content-Type: application/json',
        'Accept: application/json',
    ], $extra);
}

function da_fetch_application(array $cfg, string $applicationCode): ?array {
    $url = $cfg['_supabase_url'] . '/rest/v1/driver_applications?application_code=eq.'
        . rawurlencode(strtoupper(trim($applicationCode))) . '&select=*';
    [$status, $body] = bl_http_get($url, da_service_headers($cfg));
    $rows = json_decode($body, true);
    if ($status < 200 || $status >= 300 || !is_array($rows)) {
        throw new RuntimeException('application_fetch_failed:' . $status);
    }
    return isset($rows[0]) && is_array($rows[0]) ? $rows[0] : null;
}

function da_send_email(string $to, string $subject, string $html, string $replyTo = 'admin@higoapp.com'): bool {
    $safeTo = str_replace(["\r", "\n", "\0"], '', $to);
    $safeReply = str_replace(["\r", "\n", "\0"], '', $replyTo);
    if (!filter_var($safeTo, FILTER_VALIDATE_EMAIL)) return false;
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = "From: Higo Driver <noreply@higoapp.com>\r\n"
        . 'Reply-To: ' . $safeReply . "\r\n"
        . "MIME-Version: 1.0\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n";
    return @mail($safeTo, $encodedSubject, $html, $headers);
}

function da_email_shell(string $title, string $bodyHtml): string {
    return '<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;padding:24px;">'
        . '<table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">'
        . '<tr><td style="padding:24px;background:#07132f;color:#fff;"><h1 style="margin:0;font-size:22px;">' . htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</h1></td></tr>'
        . '<tr><td style="padding:26px;color:#0f172a;font-size:15px;line-height:1.6;">' . $bodyHtml
        . '<p style="margin-top:24px;color:#64748b;font-size:13px;">Equipo Higo · Higo Technologies Inc · Higo Technologies C.A.</p>'
        . '</td></tr></table></td></tr></table></body></html>';
}

function da_application_email_for_status(array $application, string $status, ?string $reason = null): array {
    $name = htmlspecialchars((string) ($application['full_name'] ?? 'Conductor'), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $code = htmlspecialchars((string) ($application['application_code'] ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $safeReason = htmlspecialchars(trim((string) $reason), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $statusUrl = 'https://higodriver.com/status/?id=' . rawurlencode((string) ($application['application_code'] ?? ''));
    $copy = [
        'under_review' => ['Tu solicitud Higo Driver está en revisión', '<p>Hola ' . $name . ',</p><p>Comenzamos la revisión de tu pre-registro <strong>' . $code . '</strong>. Validaremos cobertura, datos y capacidad operativa.</p>'],
        'documents_submitted' => ['Recibimos tus documentos Higo Driver', '<p>Hola ' . $name . ',</p><p>Recibimos los documentos de la solicitud <strong>' . $code . '</strong>. El equipo los revisará y te informará el resultado.</p>'],
        'correction_requested' => ['Debes corregir documentos de tu solicitud Higo Driver', '<p>Hola ' . $name . ',</p><p>Necesitamos una corrección en los documentos de la solicitud <strong>' . $code . '</strong>.</p>' . ($safeReason !== '' ? '<p><strong>Observación:</strong> ' . $safeReason . '</p>' : '')],
        'approved' => ['Tu solicitud Higo Driver fue aprobada', '<p>Hola ' . $name . ',</p><p>Tu solicitud <strong>' . $code . '</strong> fue aprobada. El equipo completará la creación de tu cuenta y recibirás otro correo con los datos de acceso.</p>'],
        'waitlist' => ['Actualización de tu solicitud Higo Driver', '<p>Hola ' . $name . ',</p><p>Tu solicitud <strong>' . $code . '</strong> quedó en lista de espera por disponibilidad de zona o modalidad.</p>'],
        'rejected' => ['Resultado de tu solicitud Higo Driver', '<p>Hola ' . $name . ',</p><p>La solicitud <strong>' . $code . '</strong> no fue aprobada en esta oportunidad.</p>' . ($safeReason !== '' ? '<p><strong>Motivo:</strong> ' . $safeReason . '</p>' : '')],
    ];
    if (!isset($copy[$status])) return ['', ''];
    [$subject, $body] = $copy[$status];
    $body .= '<p><a href="' . htmlspecialchars($statusUrl, ENT_QUOTES, 'UTF-8') . '" style="color:#315ef4;font-weight:700;">Consultar estado de la solicitud</a></p>';
    return [$subject, da_email_shell($subject, $body)];
}
