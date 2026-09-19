<?php
declare(strict_types=1);
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) { http_response_code(403); exit; }

/** Backend origins must come from private configuration, never request headers. */
function higo_backend_origin(array $cfg, string $name): string {
    $value = rtrim((string) ($cfg[$name] ?? ''), '/');
    $parts = parse_url($value);
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
        || isset($parts['user']) || isset($parts['pass'])
        || isset($parts['query']) || isset($parts['fragment']) || !empty($parts['path'])
        || preg_match('/[\x00-\x20\x7f]/', $value)) throw new RuntimeException('backend_not_configured');
    return $value;
}

function higo_private_key(array $cfg, string $name): string {
    $value = (string) ($cfg[$name] ?? '');
    if ($value === '' || preg_match('/[\r\n\x00]/', $value)) throw new RuntimeException('backend_not_configured');
    return $value;
}

function higo_route_point($point): array {
    if (!is_array($point) || !isset($point['lat'], $point['lng']) || !is_numeric($point['lat']) || !is_numeric($point['lng'])) throw new InvalidArgumentException('invalid_coordinates');
    $lat = (float) $point['lat']; $lng = (float) $point['lng'];
    if (!is_finite($lat) || !is_finite($lng) || abs($lat) > 90 || abs($lng) > 180) throw new InvalidArgumentException('invalid_coordinates');
    return ['lat' => $lat, 'lng' => $lng];
}

/** Transport is injected for deterministic tests; no client-selected upstream URL. */
function higo_route_quote(array $input, string $userId, array $cfg, callable $post): array {
    $origin = higo_route_point($input['pickupCoords'] ?? null);
    $destination = higo_route_point($input['dropoffCoords'] ?? null);
    $stops = $input['stops'] ?? [];
    if (!is_array($stops) || !array_is_list($stops) || count($stops) > 5) throw new InvalidArgumentException('invalid_stops');
    $stops = array_map(static function ($stop) {
        $point = higo_route_point($stop);
        if (isset($stop['address']) && (!is_string($stop['address']) || strlen($stop['address']) > 500)) throw new InvalidArgumentException('invalid_stop_address');
        $point['address'] = (string) ($stop['address'] ?? '');
        return $point;
    }, array_values($stops));
    $vehicle = $input['vehicleType'] ?? '';
    $service = $input['serviceType'] ?? 'ride';
    if (!in_array($vehicle, ['moto', 'standard', 'van'], true) || !in_array($service, ['ride', 'delivery'], true)) throw new InvalidArgumentException('invalid_service');
    if (isset($input['promoCode']) && (!is_string($input['promoCode']) || strlen($input['promoCode']) > 100)) throw new InvalidArgumentException('invalid_promo_code');
    $promo = trim($input['promoCode'] ?? '');
    $key = higo_private_key($cfg, 'GOOGLE_ROUTES_SERVER_KEY');
    $base = higo_backend_origin($cfg, 'SUPABASE_PROJECT_URL');
    $serverKey = higo_private_key($cfg, 'SUPABASE_SERVICE_ROLE_KEY');
    $waypoint = static fn(array $p): array => ['location' => ['latLng' => ['latitude' => $p['lat'], 'longitude' => $p['lng']]]];
    [$status, $body] = $post('https://routes.googleapis.com/directions/v2:computeRoutes', [
        'origin' => $waypoint($origin), 'destination' => $waypoint($destination),
        'intermediates' => array_map($waypoint, $stops), 'travelMode' => 'DRIVE',
        'routingPreference' => 'TRAFFIC_AWARE', 'computeAlternativeRoutes' => false,
        'languageCode' => 'es', 'units' => 'METRIC',
    ], ['X-Goog-Api-Key: ' . $key, 'X-Goog-FieldMask: routes.distanceMeters,routes.duration']);
    $route = $body['routes'][0] ?? null;
    if ($status !== 200 || !is_array($route) || !is_numeric($route['distanceMeters'] ?? null)
        || !preg_match('/^([0-9]+(?:\.[0-9]+)?)s$/D', (string) ($route['duration'] ?? ''), $duration)) throw new RuntimeException('route_unavailable');
    $km = (float) $route['distanceMeters'] / 1000; $minutes = (float) $duration[1] / 60;
    if (!is_finite($km) || !is_finite($minutes) || $km <= 0 || $km > 2000 || $minutes <= 0 || $minutes > 2880) throw new RuntimeException('invalid_route_metrics');
    [$status, $quote] = $post($base . '/rest/v1/rpc/higo_store_route_quote', [
        'p_user_id' => $userId, 'p_route' => ['pickupCoords' => $origin, 'dropoffCoords' => $destination, 'stops' => $stops],
        'p_distance_km' => $km, 'p_duration_min' => $minutes,
        'p_vehicle_type' => $vehicle, 'p_service_type' => $service,
        'p_promo_code' => $promo === '' ? null : strtoupper($promo),
    ], ['apikey: ' . $serverKey, 'Authorization: Bearer ' . $serverKey]);
    if ($status < 200 || $status >= 300 || !is_array($quote) || empty($quote['quoteId'])) throw new RuntimeException('quote_unavailable');
    return $quote;
}
