<?php
declare(strict_types=1);

/**
 * Adds a precise GPS point to an already-created SOS without delaying the
 * initial emergency request. The caller may only update its own SOS event.
 */
require_once __DIR__ . '/../banesco-core.php';
require_once __DIR__ . '/_cors.php';
require_once __DIR__ . '/_ratelimit.php';

$cfg = function_exists('bl_load_config') ? bl_load_config() : [];
api_apply_cors($cfg, 'POST, OPTIONS');
api_rate_limit('update-emergency-location', 20, '/tmp/higo_ratelimit.log');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function uel_send(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    uel_send(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $match)) {
    uel_send(401, ['ok' => false, 'error' => 'unauthorized']);
}
$callerJwt = trim((string) $match[1]);

$supaUrl = rtrim((string) ($cfg['SUPABASE_PROJECT_URL'] ?? ''), '/');
$supaKey = (string) ($cfg['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
$supaAnon = (string) ($cfg['SUPABASE_ANON_KEY'] ?? '');
if ($supaUrl === '' || $supaKey === '' || $supaAnon === '') {
    uel_send(503, ['ok' => false, 'error' => 'config_missing']);
}

[$userStatus, $userBody] = bl_http_get(
    $supaUrl . '/auth/v1/user',
    ['apikey: ' . $supaAnon, 'Authorization: Bearer ' . $callerJwt],
    15
);
if ($userStatus !== 200) uel_send(401, ['ok' => false, 'error' => 'invalid_token']);
$user = json_decode((string) $userBody, true);
$callerId = (string) ($user['id'] ?? '');
if ($callerId === '') uel_send(401, ['ok' => false, 'error' => 'invalid_token']);

$body = json_decode((string) file_get_contents('php://input'), true);
$sosId = (int) ($body['sos_id'] ?? 0);
$threadId = (int) ($body['support_thread_id'] ?? 0);
$lat = isset($body['lat']) ? (float) $body['lat'] : null;
$lng = isset($body['lng']) ? (float) $body['lng'] : null;
$accuracy = isset($body['location_accuracy']) && is_numeric($body['location_accuracy'])
    ? max(0.0, (float) $body['location_accuracy'])
    : null;
$capturedAt = (string) ($body['location_captured_at'] ?? gmdate('c'));
$source = preg_replace('/[^a-z0-9_\-]/i', '', (string) ($body['location_source'] ?? 'device_gps'));
if ($sosId <= 0) uel_send(400, ['ok' => false, 'error' => 'sos_id_required']);
if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
    uel_send(400, ['ok' => false, 'error' => 'invalid_coordinates']);
}

$serviceHeaders = ['apikey: ' . $supaKey, 'Authorization: Bearer ' . $supaKey];
[$eventStatus, $eventBody] = bl_http_get(
    $supaUrl . '/rest/v1/sos_events?id=eq.' . $sosId . '&select=id,user_id,ride_id,metadata&limit=1',
    $serviceHeaders,
    15
);
$events = json_decode((string) $eventBody, true);
$event = is_array($events) ? ($events[0] ?? null) : null;
if ($eventStatus !== 200 || !is_array($event)) uel_send(404, ['ok' => false, 'error' => 'sos_not_found']);
if ((string) ($event['user_id'] ?? '') !== $callerId) uel_send(403, ['ok' => false, 'error' => 'not_owner']);

$metadata = is_array($event['metadata'] ?? null) ? $event['metadata'] : [];
$metadata['location'] = [
    'source' => $source ?: 'device_gps',
    'accuracy_m' => $accuracy,
    'captured_at' => $capturedAt,
    'approximate' => false,
];

[$patchStatus] = bl_http_patch(
    $supaUrl . '/rest/v1/sos_events?id=eq.' . $sosId,
    (string) json_encode([
        'location_lat' => $lat,
        'location_lng' => $lng,
        'metadata' => $metadata,
    ]),
    array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
    15
);
if ($patchStatus < 200 || $patchStatus >= 300) {
    uel_send(502, ['ok' => false, 'error' => 'sos_update_failed']);
}

$supportUpdated = false;
if ($threadId > 0) {
    [$threadStatus, $threadBody] = bl_http_get(
        $supaUrl . '/rest/v1/support_threads?id=eq.' . $threadId . '&select=id,user_id&limit=1',
        $serviceHeaders,
        15
    );
    $threads = json_decode((string) $threadBody, true);
    $thread = is_array($threads) ? ($threads[0] ?? null) : null;
    if ($threadStatus === 200 && is_array($thread) && (string) ($thread['user_id'] ?? '') === $callerId) {
        $maps = 'https://www.google.com/maps?q=' . $lat . ',' . $lng;
        $message = "📍 UBICACIÓN SOS ACTUALIZADA\n"
            . "- Evento SOS: #" . $sosId . "\n"
            . "- Coordenadas: " . $lat . ", " . $lng . "\n"
            . "- Google Maps: " . $maps . "\n"
            . "- Fuente: GPS preciso del dispositivo"
            . ($accuracy !== null ? " · precisión ±" . round($accuracy) . " m" : "") . "\n"
            . "- Capturada: " . $capturedAt . "\n"
            . "- Recibida UTC: " . gmdate('Y-m-d H:i:s');

        [$messageStatus] = bl_http_post(
            $supaUrl . '/rest/v1/support_messages',
            (string) json_encode([
                'thread_id' => $threadId,
                'sender_id' => $callerId,
                'sender_role' => 'user',
                'content' => $message,
            ]),
            array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
            15
        );
        if ($messageStatus >= 200 && $messageStatus < 300) {
            $supportUpdated = true;
            bl_http_patch(
                $supaUrl . '/rest/v1/support_threads?id=eq.' . $threadId,
                (string) json_encode([
                    'status' => 'open',
                    'unread_for_admin' => true,
                    'last_message_at' => gmdate('c'),
                ]),
                array_merge($serviceHeaders, ['Content-Type: application/json', 'Prefer: return=minimal']),
                10
            );
        }
    }
}

uel_send(200, [
    'ok' => true,
    'sos_id' => $sosId,
    'support_updated' => $supportUpdated,
]);
