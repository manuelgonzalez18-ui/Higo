import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('SOS uses native GPS, persistent cache and precise follow-up', () => {
    const location = read('src/utils/emergencyLocation.js');
    const trigger = read('src/utils/triggerEmergencyAlert.js');

    assert.match(location, /Geolocation\.getCurrentPosition/);
    assert.match(location, /higo:last-known-location/);
    assert.match(location, /rememberEmergencyLocation/);
    assert.match(trigger, /readEmergencyLocation\(\)/);
    assert.match(trigger, /update-emergency-location\.php/);
    assert.match(trigger, /location_accuracy/);
    assert.doesNotMatch(trigger, /GEO_SOFT_TIMEOUT_MS/);
});

test('regular app geolocation refreshes the SOS cache', () => {
    const hook = read('src/hooks/useGeolocation.js');
    assert.match(hook, /rememberEmergencyLocation/);
    assert.match(hook, /native_app_location/);
    assert.match(hook, /web_app_location/);
});

test('SOS server resolves safe location fallbacks and exposes source', () => {
    const endpoint = read('public/api/send-emergency.php');
    assert.match(endpoint, /driver_vehicle_last_known/);
    assert.match(endpoint, /ride_pickup_reference/);
    assert.match(endpoint, /curr_lat,curr_lng,last_location_update/);
    assert.match(endpoint, /location_available/);
    assert.match(endpoint, /UBICACIÓN DEL SOS/);
    assert.match(endpoint, /emerg_valid_location/);
});

test('precise GPS follow-up updates event metadata and support thread', () => {
    const endpoint = read('public/api/update-emergency-location.php');
    assert.match(endpoint, /'metadata' => \$metadata/);
    assert.match(endpoint, /GPS preciso del dispositivo/);
    assert.match(endpoint, /location_accuracy/);
});

test('admin support renders Google Maps URLs as clickable links', () => {
    const page = read('src/pages/AdminSupportPage.jsx');
    assert.match(page, /renderMessageContent/);
    assert.match(page, /target="_blank"/);
    assert.match(page, /text-blue-400 underline/);
});

test('release is Higo 1.5.28 build 60', () => {
    const gradle = read('android/app/build.gradle');
    assert.match(gradle, /versionCode 60/);
    assert.match(gradle, /versionName "1\.5\.28"/);
});