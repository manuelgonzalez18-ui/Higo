import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('driver online confirmation uses operational native TTS with the exact phrase', async () => {
    const [dashboard, notifications] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/services/notificationService.js'),
    ]);
    assert.match(dashboard, /Ahora estás disponible para recibir servicios/);
    assert.match(dashboard, /speakOperationalMessage\(serverOnline/);
    assert.match(notifications, /@capacitor-community\/text-to-speech/);
    assert.match(notifications, /export const speakOperationalMessage/);
});

test('directed offer reconciliation alerts unseen offers immediately', async () => {
    const dashboard = await read('src/pages/DriverDashboard.jsx');
    assert.match(dashboard, /announcedRequestKeysRef/);
    assert.match(dashboard, /const unseenRequests = filtered\.filter/);
    assert.match(dashboard, /void notifyNewRequest\(unseenRequests\[0\]\)/);
    assert.doesNotMatch(dashboard, /if \(!replace && filtered\.length > 0\)/);
    assert.match(dashboard, /higo_rides_v13_immediate/);
});

test('ride chat sounds outside the open panel and sends a background push', async () => {
    const chat = await read('src/components/ChatWidget.jsx');
    const soundIndex = chat.indexOf('void playAlertSound();', chat.indexOf('const appIsVisible'));
    const openReturnIndex = chat.indexOf('if (chatIsOpen) return;', chat.indexOf('const appIsVisible'));
    assert.ok(soundIndex >= 0 && soundIndex < openReturnIndex);
    assert.match(chat, /send-ride-message-push\.php/);
    assert.match(chat, /higo_messages_v3_immediate/);
    assert.match(chat, /higo:\/\/chat/);
});

test('Android uses high-priority data-only paths for fresh ride and chat alerts', async () => {
    const [nativeService, directedPush, legacyPush, chatPush] = await Promise.all([
        read('android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java'),
        read('public/api/send-ride-offer-push.php'),
        read('public/api/send-ride-request-push.php'),
        read('public/api/send-ride-message-push.php'),
    ]);
    assert.match(nativeService, /"ride_message"\.equals\(type\)/);
    assert.match(nativeService, /higo_rides_v13_immediate/);
    assert.match(nativeService, /higo_messages_v3_immediate/);
    assert.match(directedPush, /'ttl' => '20s'/);
    assert.match(legacyPush, /'ttl' => '30s'/);
    assert.match(chatPush, /'type' => 'ride_message'/);
    assert.match(chatPush, /'priority' => 'HIGH'/);
});

test('release is Higo 1.5.23 build 55', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 55/);
    assert.match(gradle, /versionName "1\.5\.23"/);
});
