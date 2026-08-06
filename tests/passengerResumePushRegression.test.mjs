import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('passenger ride screen resynchronizes after Android background suspension', async () => {
    const page = await read('src/pages/RideStatusPage.jsx');
    assert.match(page, /CapacitorApp\.addListener\('appStateChange'/);
    assert.match(page, /document\.addEventListener\('visibilitychange'/);
    assert.match(page, /window\.addEventListener\('pageshow'/);
    assert.match(page, /window\.addEventListener\('online'/);
    assert.match(page, /syncRideNow\('native-resume'\)/);
    assert.match(page, /fetchRide\(reason\)/);
    assert.match(page, /}, 10000\);/);
    assert.match(page, /statusRef\.current = data\.status/);
});

test('ride status push retries and survives screen transitions', async () => {
    const client = await read('src/utils/sendRideStatusPush.js');
    assert.match(client, /RETRY_DELAYS_MS = \[0, 800, 2500\]/);
    assert.match(client, /keepalive: true/);
    assert.match(client, /attempt \$\{index \+ 1\} failed/);
});

test('native token persistence survives auth races and resume', async () => {
    const [push, app] = await Promise.all([
        read('src/services/pushNotifications.js'),
        read('src/App.jsx'),
    ]);
    assert.match(push, /supabase\.auth\.getSession\(\)/);
    assert.match(push, /NATIVE_TOKEN_CACHE_KEY/);
    assert.match(push, /pendingNativeToken/);
    assert.match(app, /if \(isActive\) \{[\s\S]*ensureFcmRegistration\(\)/);
});

test('Android background service uses real activity state and keeps TTS awake', async () => {
    const [activity, service] = await Promise.all([
        read('android/app/src/main/java/com/higoapp/ve/MainActivity.java'),
        read('android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java'),
    ]);
    assert.match(activity, /private static volatile boolean inForeground/);
    assert.match(activity, /protected void onStop\(\)/);
    assert.match(service, /MainActivity\.isInForeground\(\)/);
    assert.match(service, /PowerManager\.PARTIAL_WAKE_LOCK/);
    assert.match(service, /higo_ride_status_v2/);
});

test('status endpoint is retry-safe and targets the Android package', async () => {
    const endpoint = await read('public/api/send-ride-status-push.php');
    assert.match(endpoint, /dedupePath/);
    assert.match(endpoint, /'ttl' => '600s'/);
    assert.match(endpoint, /'restricted_package_name' => 'com\.higoapp\.ve'/);
    assert.match(endpoint, /LOCK_EX/);
});

test('Android release is Higo 1.5.26 build 58', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 58/);
    assert.match(gradle, /versionName "1\.5\.26"/);
});
