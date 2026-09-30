<?php
declare(strict_types=1);
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) { http_response_code(403); exit('forbidden'); }

/** Only an explicitly trusted immediate proxy may supply the client address. */
function api_client_ip(array $server, array $trusted = []): string {
    $remote = (string) ($server['REMOTE_ADDR'] ?? '');
    if (!filter_var($remote, FILTER_VALIDATE_IP)) $remote = '0.0.0.0';
    if (!in_array($remote, $trusted, true)) return $remote;
    $chain = explode(',', (string) ($server['HTTP_X_FORWARDED_FOR'] ?? ''));
    $chain[] = $remote;
    foreach (array_reverse($chain) as $candidate) {
        $candidate = trim($candidate);
        if (!filter_var($candidate, FILTER_VALIDATE_IP)) return $remote;
        if (!in_array($candidate, $trusted, true)) return $candidate;
    }
    return $remote;
}

/** Atomic read/modify/write; storage failure fails closed at the HTTP boundary. */
function api_take_rate_slot(string $dir, string $key, int $limit, int $now): int {
    if ($limit < 1) throw new InvalidArgumentException('invalid_rate_limit');
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('rate_storage_unavailable');
    $handle = @fopen($dir . '/' . hash('sha256', $key) . '.json', 'c+');
    if ($handle === false) throw new RuntimeException('rate_storage_unavailable');
    try {
        if (!flock($handle, LOCK_EX)) throw new RuntimeException('rate_lock_unavailable');
        $state = json_decode(stream_get_contents($handle) ?: '{}', true);
        if (!is_array($state) || !isset($state['start'], $state['count']) || !is_int($state['start']) || !is_int($state['count']) || $state['count'] < 0 || $now < $state['start'] || $now - $state['start'] >= 60) $state = ['start' => $now, 'count' => 0];
        if ($state['count'] >= $limit) return max(1, 60 - ($now - $state['start']));
        $state['count']++;
        rewind($handle);
        $encoded = json_encode($state, JSON_THROW_ON_ERROR);
        if (!ftruncate($handle, 0) || fwrite($handle, $encoded) !== strlen($encoded) || !fflush($handle)) throw new RuntimeException('rate_storage_unavailable');
        return 0;
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}
function api_rate_limit(string $bucket, int $maxPerMin, ?string $logFile = null, ?string $subject = null): void {
    $trusted = array_filter(array_map('trim', explode(',', getenv('HIGO_TRUSTED_PROXY_IPS') ?: '')));
    $ip = api_client_ip($_SERVER, $trusted);
    $identity = $subject === null ? 'ip:' . $ip : 'subject:' . $subject;
    try { $retry = api_take_rate_slot(sys_get_temp_dir() . '/higo_ratelimit', $bucket . ':' . $identity, $maxPerMin, time()); }
    catch (Throwable $error) {
        error_log('[rate-limit] storage unavailable');
        http_response_code(503); header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'error' => 'temporarily_unavailable']); exit;
    }
    if ($retry === 0) return;
    if ($logFile !== null) @file_put_contents($logFile, gmdate('c') . " 429 bucket=" . preg_replace('/[^a-z0-9_-]/i', '_', $bucket) . "\n", FILE_APPEND | LOCK_EX);
    http_response_code(429); header('Retry-After: ' . $retry); header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'rate_limited', 'retry_after' => $retry]); exit;
}
