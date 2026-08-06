import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('passenger ride milestones have a server FCM path and native TTS', async () => {
    const [hook, endpoint, service] = await Promise.all([
        read('src/hooks/useDriverActiveTrip.js'),
        read('public/api/send-ride-status-push.php'),
        read('android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java'),
    ]);

    for (const milestone of ['driver_found', 'arrived', 'started', 'completed']) {
        assert.match(hook, new RegExp(`milestone: '${milestone}'`));
        assert.match(endpoint, new RegExp(`'${milestone}'`));
    }
    assert.match(endpoint, /'type' => 'ride_status'/);
    assert.match(endpoint, /'voice_text' => \$message\['voice'\]/);
    assert.match(service, /\"ride_status\"\.equals\(type\)/);
    assert.match(service, /TextToSpeech/);
    assert.match(service, /markRideStatusAsNew/);
    assert.match(service, /higo:\/\/ride\?rideId=/);
});

test('SOS is sent quickly and receives a precise GPS follow-up', async () => {
    const [client, endpoint] = await Promise.all([
        read('src/utils/triggerEmergencyAlert.js'),
        read('public/api/update-emergency-location.php'),
    ]);
    assert.match(client, /GEO_SOFT_TIMEOUT_MS = 700/);
    assert.match(client, /GEO_FOLLOW_UP_TIMEOUT_MS = 12000/);
    assert.match(client, /update-emergency-location\.php/);
    assert.match(endpoint, /location_lat/);
    assert.match(endpoint, /UBICACIÓN SOS ACTUALIZADA/);
});

test('ride message push remains compatible with PHP hosts without str_starts_with or mbstring', async () => {
    const [endpoint, chat] = await Promise.all([
        read('public/api/send-ride-message-push.php'),
        read('src/components/ChatWidget.jsx'),
    ]);
    assert.doesNotMatch(endpoint, /str_starts_with/);
    assert.match(endpoint, /function_exists\('mb_substr'\)/);
    assert.match(chat, /if \(!pushResponse\.ok\)/);
});

test('Android release version is 1.5.25 build 57', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 57/);
    assert.match(gradle, /versionName \"1\.5\.25\"/);
});
