#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f'Expected block not found in {path}: {old[:160]!r}')
    write(path, content.replace(old, new, 1))


# Passenger screen: resynchronize the authoritative ride row whenever the
# WebView returns to the foreground. Realtime sockets are paused by Android on
# many devices, so relying on the UPDATE event alone leaves stale UI behind.
replace_once(
    'src/pages/RideStatusPage.jsx',
    "import { announcePassengerRideState } from '../utils/passengerRideVoice';",
    "import { announcePassengerRideState } from '../utils/passengerRideVoice';\nimport { Capacitor } from '@capacitor/core';\nimport { App as CapacitorApp } from '@capacitor/app';",
)
replace_once(
    'src/pages/RideStatusPage.jsx',
    '        fetchRide();',
    "        fetchRide('initial');",
)
replace_once(
    'src/pages/RideStatusPage.jsx',
    """    const fetchRide = async () => {
        const { data, error } = await supabase.from('rides').select('*').eq('id', id).single();
        if (data) {
            setRide(data);
            
            const isDel = data.service_type === 'delivery' || !!data.delivery_info;
            arrivedPickupRef.current = !!data.arrived_at_pickup_at;
            void announcePassengerRideState(data);
            if (!statusRef.current) {
                statusRef.current = data.status;
                // If already completed on load, show modal
                if (data.status === 'completed' && isDel) {
                    setShowDeliverySuccessModal(true);
                }
            }
""",
    """    const fetchRide = async (source = 'manual') => {
        const { data, error } = await supabase.from('rides').select('*').eq('id', id).single();
        if (data) {
            const previousStatus = statusRef.current;
            const previousArrived = arrivedPickupRef.current;
            const nextArrived = Boolean(data.arrived_at_pickup_at);

            setRide(data);

            const isDel = data.service_type === 'delivery' || !!data.delivery_info;
            arrivedPickupRef.current = nextArrived;
            statusRef.current = data.status;
            void announcePassengerRideState(data);

            if (data.status === 'completed' && isDel) {
                setShowDeliverySuccessModal(true);
            }

            if (
                source !== 'initial'
                && (previousStatus !== data.status || previousArrived !== nextArrived)
            ) {
                console.debug('[ride-sync] passenger state refreshed', {
                    source,
                    rideId: data.id,
                    previousStatus,
                    nextStatus: data.status,
                    arrivedAtPickup: nextArrived,
                });
            }
""",
)
replace_once(
    'src/pages/RideStatusPage.jsx',
    """        } else {
            setPollingStatus("RideNull");
        }
    };

    // NOTA: el polling cada 3s a profiles para refrescar driver location
""",
    """        } else {
            setPollingStatus(error ? `RideERR: ${error.code || 'unknown'}` : "RideNull");
        }
    };

    // Android suspends the WebView and its realtime socket while the passenger
    // uses another app. On every resume/visibility change we reconnect and
    // fetch the authoritative row. A low-frequency visible-only poll is the
    // final safety net for OEMs that silently drop websocket subscriptions.
    useEffect(() => {
        let nativeListener = null;
        let disposed = false;
        let syncInFlight = false;
        let lastSyncAt = 0;

        const syncRideNow = async (reason) => {
            if (disposed || syncInFlight) return;
            const now = Date.now();
            if (reason !== 'visible-poll' && now - lastSyncAt < 750) return;

            syncInFlight = true;
            try {
                try { supabase.realtime.connect(); } catch { /* already connected */ }
                await fetchRide(reason);
                lastSyncAt = Date.now();
            } catch (syncError) {
                console.warn('[ride-sync] refresh failed:', reason, syncError);
            } finally {
                syncInFlight = false;
            }
        };

        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                void syncRideNow('visibility');
            }
        };
        const onFocus = () => void syncRideNow('focus');
        const onPageShow = () => void syncRideNow('pageshow');
        const onOnline = () => void syncRideNow('online');

        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onFocus);
        window.addEventListener('pageshow', onPageShow);
        window.addEventListener('online', onOnline);

        const visiblePoll = window.setInterval(() => {
            const currentStatus = String(statusRef.current || '').toLowerCase();
            if (document.visibilityState !== 'visible') return;
            if (currentStatus === 'completed' || currentStatus === 'cancelled') return;
            void syncRideNow('visible-poll');
        }, 10000);

        if (Capacitor.isNativePlatform()) {
            void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
                if (isActive) void syncRideNow('native-resume');
            }).then((listener) => {
                nativeListener = listener;
                if (disposed) nativeListener?.remove?.();
            }).catch((listenerError) => {
                console.warn('[ride-sync] native resume listener unavailable:', listenerError);
            });
        }

        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('pageshow', onPageShow);
            window.removeEventListener('online', onOnline);
            window.clearInterval(visiblePoll);
            nativeListener?.remove?.();
        };
    }, [id]); // fetchRide intentionally closes over the current ride id

    // NOTA: el polling cada 3s a profiles para refrescar driver location
""",
)

# FCM token persistence: use the cached authenticated session instead of a
# network getUser() call, remember the latest native token across auth races,
# and retry persistence every time registration is requested.
replace_once(
    'src/services/pushNotifications.js',
    "let nativeInitialized = false;\nconst nativeHandlers = new Set();",
    "let nativeInitialized = false;\nlet pendingNativeToken = null;\nconst NATIVE_TOKEN_CACHE_KEY = 'higo.pending-fcm-token';\nconst nativeHandlers = new Set();",
)
replace_once(
    'src/services/pushNotifications.js',
    """        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return token;
""",
    """        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) return token;
""",
)
replace_once(
    'src/services/pushNotifications.js',
    """            PushNotifications.addListener('registration', async (token) => {
                await persistToken(token.value);
            });
""",
    """            PushNotifications.addListener('registration', async (token) => {
                pendingNativeToken = token.value || null;
                try {
                    if (pendingNativeToken) window.localStorage.setItem(NATIVE_TOKEN_CACHE_KEY, pendingNativeToken);
                } catch { /* cache is best-effort */ }
                const persisted = await persistToken(pendingNativeToken);
                if (persisted) {
                    try { window.localStorage.removeItem(NATIVE_TOKEN_CACHE_KEY); } catch { /* ignore */ }
                }
            });
""",
)
replace_once(
    'src/services/pushNotifications.js',
    """        // 3. register() → dispara el evento 'registration' con el token FCM.
        await PushNotifications.register();
        return 'native-pending';
""",
    """        // Retry a token captured before the Supabase session was ready.
        if (!pendingNativeToken) {
            try { pendingNativeToken = window.localStorage.getItem(NATIVE_TOKEN_CACHE_KEY); }
            catch { pendingNativeToken = null; }
        }
        if (pendingNativeToken) {
            const persisted = await persistToken(pendingNativeToken);
            if (persisted) {
                try { window.localStorage.removeItem(NATIVE_TOKEN_CACHE_KEY); } catch { /* ignore */ }
            }
        }

        // 3. register() → dispara el evento 'registration' with the current token.
        await PushNotifications.register();
        return 'native-pending';
""",
)

# The app may remain alive for days. Re-register on native resume so token
# rotations and auth/token races are repaired without a reinstall.
replace_once(
    'src/App.jsx',
    """            if (isActive) {
              checkSession();
            }
""",
    """            if (isActive) {
              checkSession();
              ensureFcmRegistration();
            }
""",
)

send_status_js = """import { supabase } from '../services/supabase';
import { apiUrl } from './apiUrl';

const RETRY_DELAYS_MS = [0, 800, 2500];
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const sendRideStatusPush = async ({ rideId, milestone }) => {
    if (!rideId || !milestone) return { ok: false, skipped: true };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('ride status push: missing session');

    const response = await fetch(apiUrl('/api/send-ride-status-push.php'), {
        method: 'POST',
        keepalive: true,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            ride_id: rideId,
            milestone,
        }),
    });

    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* non-JSON response */ }

    if (!response.ok) {
        throw new Error(`ride status push ${response.status}: ${text.slice(0, 240)}`);
    }
    return payload || { ok: true };
};

export const queueRideStatusPush = (args) => {
    void (async () => {
        let lastError = null;
        for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
            const delay = RETRY_DELAYS_MS[index];
            if (delay > 0) await sleep(delay);
            try {
                const result = await sendRideStatusPush(args);
                if (result?.sent === 0) {
                    console.warn('[ride-status-push] accepted but not delivered:', result);
                }
                return result;
            } catch (error) {
                lastError = error;
                console.warn(`[ride-status-push] attempt ${index + 1} failed:`, error);
            }
        }
        console.error('[ride-status-push] delivery exhausted retries:', args, lastError);
        return null;
    })();
};
"""
write('src/utils/sendRideStatusPush.js', send_status_js)

# Server-side idempotency and longer TTL. Retries no longer generate duplicate
# passenger announcements, and briefly-offline devices still receive the event.
replace_once(
    'public/api/send-ride-status-push.php',
    "catch (Throwable $error) { rsp_send(500, ['ok' => false, 'error' => 'oauth_fail']); }",
    "catch (Throwable $error) { rsp_send(500, ['ok' => false, 'error' => 'oauth_fail', 'detail' => $error->getMessage()]); }",
)
replace_once(
    'public/api/send-ride-status-push.php',
    """$message = $messages[$milestone];
$clickAction = '/#/ride/' . rawurlencode($rideId);

try { $accessToken = rsp_access_token((string) $cfg['FIREBASE_SA_PATH']); }
""",
    """$message = $messages[$milestone];
$clickAction = '/#/ride/' . rawurlencode($rideId);
$dedupePath = sys_get_temp_dir() . '/higo-ride-status-' . hash('sha256', $rideId . '|' . $milestone) . '.json';
if (is_file($dedupePath) && (time() - (int) @filemtime($dedupePath)) < 600) {
    rsp_send(200, [
        'ok' => true,
        'sent' => 1,
        'deduplicated' => true,
        'ride_id' => $rideId,
        'milestone' => $milestone,
    ]);
}

try { $accessToken = rsp_access_token((string) $cfg['FIREBASE_SA_PATH']); }
""",
)
replace_once(
    'public/api/send-ride-status-push.php',
    """        'android' => [
            'priority' => 'HIGH',
            'ttl' => '120s',
            'direct_boot_ok' => true,
        ],
""",
    """        'android' => [
            'priority' => 'HIGH',
            'ttl' => '600s',
            'collapse_key' => 'ride-status-' . $rideId . '-' . $milestone,
            'restricted_package_name' => 'com.higoapp.ve',
            'direct_boot_ok' => true,
        ],
""",
)
replace_once(
    'public/api/send-ride-status-push.php',
    """if ($fcmStatus >= 200 && $fcmStatus < 300) {
    rsp_send(200, ['ok' => true, 'sent' => 1, 'ride_id' => $rideId, 'milestone' => $milestone]);
}
""",
    """if ($fcmStatus >= 200 && $fcmStatus < 300) {
    @file_put_contents($dedupePath, (string) json_encode([
        'ride_id' => $rideId,
        'milestone' => $milestone,
        'sent_at' => gmdate('c'),
    ]), LOCK_EX);
    rsp_send(200, ['ok' => true, 'sent' => 1, 'ride_id' => $rideId, 'milestone' => $milestone]);
}
""",
)

# Track Activity foreground state explicitly. ActivityManager process importance
# can remain FOREGROUND briefly after switching apps and suppress a valid push.
replace_once(
    'android/app/src/main/java/com/higoapp/ve/MainActivity.java',
    'public class MainActivity extends BridgeActivity {',
    """public class MainActivity extends BridgeActivity {
    private static volatile boolean inForeground = false;

    public static boolean isInForeground() {
        return inForeground;
    }

    @Override
    protected void onStart() {
        super.onStart();
        inForeground = true;
    }

    @Override
    protected void onStop() {
        inForeground = false;
        super.onStop();
    }
""",
)

replace_once(
    'android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java',
    'import android.os.Build;',
    'import android.os.Build;\nimport android.os.PowerManager;',
)
replace_once(
    'android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java',
    '    private static final String STATUS_CHANNEL_ID = "higo_ride_status_v1";',
    '    private static final String STATUS_CHANNEL_ID = "higo_ride_status_v2";',
)
replace_once(
    'android/app/src/main/java/com/higoapp/ve/MyFirebaseMessagingService.java',
    """    private void speakRideStatus(RemoteMessage remoteMessage) {
        final String text = value(remoteMessage, "voice_text", "body");
        if (text == null || text.trim().isEmpty()) return;

        final TextToSpeech[] engine = new TextToSpeech[1];
        engine[0] = new TextToSpeech(getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS || engine[0] == null) {
                if (engine[0] != null) engine[0].shutdown();
                return;
            }
            engine[0].setLanguage(new Locale("es", "ES"));
            engine[0].setSpeechRate(1.0f);
            engine[0].setPitch(1.0f);
            final String utteranceId = "higo-status-" + System.currentTimeMillis();
            engine[0].setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) {
                    if (engine[0] != null) engine[0].shutdown();
                }
                @Override public void onError(String id) {
                    if (engine[0] != null) engine[0].shutdown();
                }
            });
            engine[0].speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        });
    }

    private boolean isAppInForeground() {
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
""",
    """    private void speakRideStatus(RemoteMessage remoteMessage) {
        final String text = value(remoteMessage, "voice_text", "body");
        if (text == null || text.trim().isEmpty()) return;

        final PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        final PowerManager.WakeLock wakeLock = powerManager != null
                ? powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "higo:ride-status-voice")
                : null;
        if (wakeLock != null) wakeLock.acquire(15000L);

        final TextToSpeech[] engine = new TextToSpeech[1];
        final Runnable cleanup = () -> {
            if (engine[0] != null) engine[0].shutdown();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        };

        engine[0] = new TextToSpeech(getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS || engine[0] == null) {
                cleanup.run();
                return;
            }
            engine[0].setLanguage(new Locale("es", "ES"));
            engine[0].setSpeechRate(1.0f);
            engine[0].setPitch(1.0f);
            final String utteranceId = "higo-status-" + System.currentTimeMillis();
            engine[0].setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { cleanup.run(); }
                @Override public void onError(String id) { cleanup.run(); }
            });
            int result = engine[0].speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
            if (result == TextToSpeech.ERROR) cleanup.run();
        });
    }

    private boolean isAppInForeground() {
        if (MainActivity.isInForeground()) return true;
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
""",
)

replace_once(
    'android/app/build.gradle',
    """        // Higo 1.5.25: background passenger voice/status, reliable chat push and SOS GPS follow-up.
        versionCode 57
        versionName "1.5.25"
""",
    """        // Higo 1.5.26: passenger resume resync and hardened background push/voice.
        versionCode 58
        versionName "1.5.26"
""",
)

regression = r"""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('passenger ride screen resynchronizes after Android background suspension', async () => {
    const page = await read('src/pages/RideStatusPage.jsx');
    assert.match(page, /CapacitorApp\.addListener\('appStateChange'/);
    assert.match(page, /document\.addEventListener\('visibilitychange'/);
    assert.match(page, /window\.addEventListener\('pageshow'/);
    assert.match(page, /window\.addEventListener\('online'/);
    assert.match(page, /fetchRide\('native-resume'\)/);
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
"""
write('tests/passengerResumePushRegression.test.mjs', regression)

print('Applied Higo 1.5.26 passenger resume and background push fixes.')
