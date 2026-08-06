import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('chat discovers a newly assigned ride before either participant opens the panel', async () => {
    const chat = await read('src/components/ChatWidget.jsx');
    assert.match(chat, /const setupRideDiscovery = \(currentUserId\) =>/);
    assert.match(chat, /filter: `user_id=eq\.\$\{currentUserId\}`/);
    assert.match(chat, /filter: `driver_id=eq\.\$\{currentUserId\}`/);
    assert.match(chat, /setupRideDiscovery\(session\.user\.id\)/);
    assert.match(chat, /setupRideDiscovery\(nextUserId\)/);
    assert.match(chat, /window\.setInterval\(\(\) =>/);
    assert.match(chat, /refreshActiveRide/);
});

test('the incoming-message subscription still starts from rideId, not chat visibility', async () => {
    const chat = await read('src/components/ChatWidget.jsx');
    const rideEffect = chat.indexOf('if (!rideId) return undefined;');
    const realtime = chat.indexOf(".channel(`ride-chat:${rideId}`)", rideEffect);
    const effectEnd = chat.indexOf('}, [rideId]);', realtime);
    assert.ok(rideEffect >= 0 && realtime > rideEffect);
    assert.ok(effectEnd > realtime);
});

test('release is Higo 1.5.26 build 58', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 58/);
    assert.match(gradle, /versionName "1\.5\.26"/);
});
