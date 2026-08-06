#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


chat = read('src/components/ChatWidget.jsx')

chat = replace_once(
    chat,
    "    useEffect(() => {\n        let disposed = false;\n\n        const resolveActiveRide = async (currentUserId) => {",
    "    useEffect(() => {\n        let disposed = false;\n        let passengerRideChannel = null;\n        let driverRideChannel = null;\n        let discoveryPollTimer = null;\n        let discoveryUserId = null;\n\n        const resolveActiveRide = async (currentUserId) => {",
    'ride discovery state',
)

chat = replace_once(
    chat,
    "            setRideId(data?.id || null);\n        };\n\n        const fetchUser = async () => {",
    """            const nextRideId = data?.id || null;
            setRideId((currentRideId) => {
                if (String(currentRideId || '') === String(nextRideId || '')) {
                    return currentRideId;
                }
                setMessages([]);
                setUnreadCount(0);
                return nextRideId;
            });
        };

        const teardownRideDiscovery = () => {
            if (passengerRideChannel) {
                void supabase.removeChannel(passengerRideChannel);
                passengerRideChannel = null;
            }
            if (driverRideChannel) {
                void supabase.removeChannel(driverRideChannel);
                driverRideChannel = null;
            }
            if (discoveryPollTimer) {
                window.clearInterval(discoveryPollTimer);
                discoveryPollTimer = null;
            }
            discoveryUserId = null;
        };

        // The widget mounts before a ride is usually accepted. Previously it
        // resolved the active ride only at mount/auth/focus, so no chat channel
        // existed when the first message arrived. Opening the panel supplied the
        // ride id and the 30-second catch-up then played the delayed beep.
        // Listen to both participant columns and keep a small polling fallback so
        // rideId is known before either participant opens the chat.
        const setupRideDiscovery = (currentUserId) => {
            if (!currentUserId || disposed) return;
            if (discoveryUserId === currentUserId
                && passengerRideChannel
                && driverRideChannel) return;

            teardownRideDiscovery();
            discoveryUserId = currentUserId;
            const refreshActiveRide = () => void resolveActiveRide(currentUserId);
            const onDiscoveryStatus = (side) => (status) => {
                if (status === 'SUBSCRIBED') refreshActiveRide();
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`[ride-chat] ${side} ride discovery status:`, status);
                }
            };

            passengerRideChannel = supabase
                .channel(`ride-chat-discovery:passenger:${currentUserId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'rides',
                    filter: `user_id=eq.${currentUserId}`,
                }, refreshActiveRide)
                .subscribe(onDiscoveryStatus('passenger'));

            driverRideChannel = supabase
                .channel(`ride-chat-discovery:driver:${currentUserId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'rides',
                    filter: `driver_id=eq.${currentUserId}`,
                }, refreshActiveRide)
                .subscribe(onDiscoveryStatus('driver'));

            discoveryPollTimer = window.setInterval(() => {
                if (document.visibilityState === 'visible') refreshActiveRide();
            }, 3000);
        };

        const fetchUser = async () => {""",
    'ride discovery implementation',
)

chat = replace_once(
    chat,
    "                userIdRef.current = session.user.id;\n                setUserId(session.user.id);\n                void resolveActiveRide(session.user.id);",
    "                userIdRef.current = session.user.id;\n                setUserId(session.user.id);\n                setupRideDiscovery(session.user.id);\n                void resolveActiveRide(session.user.id);",
    'session discovery setup',
)

chat = replace_once(
    chat,
    "            userIdRef.current = nextUserId;\n            setUserId(nextUserId);\n            if (nextUserId) void resolveActiveRide(nextUserId);",
    "            userIdRef.current = nextUserId;\n            setUserId(nextUserId);\n            if (nextUserId) {\n                setupRideDiscovery(nextUserId);\n                void resolveActiveRide(nextUserId);\n            }",
    'fallback discovery setup',
)

chat = replace_once(
    chat,
    "            if (nextUserId) {\n                void resolveActiveRide(nextUserId);\n            } else {",
    "            if (nextUserId) {\n                setupRideDiscovery(nextUserId);\n                void resolveActiveRide(nextUserId);\n            } else {\n                teardownRideDiscovery();",
    'auth discovery setup',
)

chat = replace_once(
    chat,
    "            document.removeEventListener('visibilitychange', handleVisibility);\n            subscription.unsubscribe();",
    "            document.removeEventListener('visibilitychange', handleVisibility);\n            teardownRideDiscovery();\n            subscription.unsubscribe();",
    'ride discovery cleanup',
)

write('src/components/ChatWidget.jsx', chat)

# Android release: JS bundle change requires a new signed APK/AAB.
gradle = read('android/app/build.gradle')
gradle = gradle.replace(
    '// Higo 1.5.23: immediate driver and chat notifications.',
    '// Higo 1.5.24: chat discovers the active ride before the panel opens.',
)
gradle = replace_once(gradle, 'versionCode 55', 'versionCode 56', 'version code')
gradle = replace_once(gradle, 'versionName "1.5.23"', 'versionName "1.5.24"', 'version name')
write('android/app/build.gradle', gradle)

# Keep release assertions aligned, including any other version-specific test.
for test_path in (ROOT / 'tests').glob('*.mjs'):
    source = test_path.read_text(encoding='utf-8')
    source = source.replace('versionCode 55', 'versionCode 56')
    source = source.replace('versionName "1\\.5\\.23"', 'versionName "1\\.5\\.24"')
    source = source.replace('release is Higo 1.5.23 build 55', 'release is Higo 1.5.24 build 56')
    test_path.write_text(source, encoding='utf-8')

regression = r'''import test from 'node:test';
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
    const openGuard = chat.indexOf('if (chatIsOpen) return;', rideEffect);
    assert.ok(rideEffect >= 0 && realtime > rideEffect);
    assert.ok(openGuard > realtime);
});

test('release is Higo 1.5.24 build 56', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 56/);
    assert.match(gradle, /versionName "1\.5\.24"/);
});
'''
write('tests/chatDiscoveryRegression.test.mjs', regression)

# Update the canonical Android build workflow so the post-fix commit does not
# trigger an obsolete 1.5.22 version assertion.
workflow_path = '.github/workflows/build-higo-1.5.22-aab.yml'
workflow = read(workflow_path)
workflow = workflow.replace('Higo 1.5.22', 'Higo 1.5.24')
workflow = workflow.replace('1.5.22', '1.5.24')
workflow = workflow.replace('versionCode 54', 'versionCode 56')
workflow = workflow.replace('versionName "1.5.22"', 'versionName "1.5.24"')
workflow = workflow.replace('higo-1.5.22-54', 'higo-1.5.24-56')
workflow = replace_once(
    workflow,
    "      - tests/nativeDriverChatGhostRegression.test.mjs\n",
    "      - tests/nativeDriverChatGhostRegression.test.mjs\n      - tests/chatDiscoveryRegression.test.mjs\n",
    'canonical workflow test path',
)
workflow = replace_once(
    workflow,
    "run: node --test tests/passengerRideVoice.test.mjs tests/nativeDriverChatGhostRegression.test.mjs tests/driverGhostOfferRegression.test.mjs tests/routeWaypoints.test.mjs",
    "run: node --test tests/passengerRideVoice.test.mjs tests/nativeDriverChatGhostRegression.test.mjs tests/chatDiscoveryRegression.test.mjs tests/notificationLatencyRegression.test.mjs tests/driverGhostOfferRegression.test.mjs tests/routeWaypoints.test.mjs",
    'canonical workflow regression command',
)
write(workflow_path, workflow)

print('Applied Higo 1.5.24 active-ride chat discovery fix.')
