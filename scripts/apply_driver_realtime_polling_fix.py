from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f'{path}: expected exactly one match, found {count}\n'
            f'--- needle ---\n{old}'
        )
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


# The driver can already be online while the optional Supabase Realtime
# WebSocket remains in CONNECTING on some Android networks. RPC polling is the
# authoritative fallback, so the UI must not report the driver as disconnected
# after a successful reconciliation.
dashboard_path = 'src/pages/DriverDashboard.jsx'

replace_once(
    dashboard_path,
    """            let directedOffersEnabled = FEATURES.directedRideOffers;
            try {
                directedOffersEnabled = await areDirectedRideOffersEnabled();
            } catch (error) {
""",
    """            let directedOffersEnabled = FEATURES.directedRideOffers;
            try {
                directedOffersEnabled = await Promise.race([
                    areDirectedRideOffersEnabled(),
                    new Promise((_, reject) => {
                        window.setTimeout(() => reject(new Error('directed offers flag timeout')), 5000);
                    }),
                ]);
            } catch (error) {
""",
)

replace_once(
    dashboard_path,
    """                        const offers = await listDirectedRideOffers(20);
                        if (!disposed) processRequests(offers, true, true);
""",
    """                        const offers = await listDirectedRideOffers(20);
                        if (!disposed) {
                            processRequests(offers, true, true);
                            setSubscriptionStatus((current) => (
                                current === 'SUBSCRIBED' ? current : 'POLLING'
                            ));
                        }
""",
)

replace_once(
    dashboard_path,
    """                    .subscribe((status) => {
                        setSubscriptionStatus(status);
                        if (status === 'SUBSCRIBED') void reconcileDirectedOffers();
                    });
""",
    """                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            setSubscriptionStatus('SUBSCRIBED');
                            void reconcileDirectedOffers();
                            return;
                        }
                        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
                            setSubscriptionStatus('POLLING');
                            return;
                        }
                        if (status === 'CONNECTING') {
                            setSubscriptionStatus((current) => (
                                current === 'POLLING' ? current : 'CONNECTING'
                            ));
                            return;
                        }
                        setSubscriptionStatus(status);
                    });
""",
)

replace_once(
    dashboard_path,
    """                if (!disposed) processRequests(data || [], true);
            };
""",
    """                if (!disposed) {
                    processRequests(data || [], true);
                    setSubscriptionStatus((current) => (
                        current === 'SUBSCRIBED' ? current : 'POLLING'
                    ));
                }
            };
""",
)

replace_once(
    dashboard_path,
    """                .subscribe((status) => {
                    setSubscriptionStatus(status);
                    if (status === 'SUBSCRIBED') void fetchLegacyRequests();
                });
""",
    """                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        setSubscriptionStatus('SUBSCRIBED');
                        void fetchLegacyRequests();
                        return;
                    }
                    if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
                        setSubscriptionStatus('POLLING');
                        return;
                    }
                    if (status === 'CONNECTING') {
                        setSubscriptionStatus((current) => (
                            current === 'POLLING' ? current : 'CONNECTING'
                        ));
                        return;
                    }
                    setSubscriptionStatus(status);
                });
""",
)

replace_once(
    dashboard_path,
    """                            <div className={`w-2.5 h-2.5 rounded-full ${isOnline && subscriptionStatus === 'SUBSCRIBED' ? 'bg-emerald-500 animate-pulse' : isOnline ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`}></div>
                            <span className="font-bold text-xs tracking-wider uppercase">
                                {!isOnline ? 'Desconectado' :
                                    subscriptionStatus === 'SUBSCRIBED' ? 'En línea' :
                                        subscriptionStatus === 'CONNECTING' ? 'Conectando...' :
                                            'Reconectando...'}
                            </span>
""",
    """                            <div className={`w-2.5 h-2.5 rounded-full ${isOnline && (subscriptionStatus === 'SUBSCRIBED' || subscriptionStatus === 'POLLING') ? 'bg-emerald-500 animate-pulse' : isOnline ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`}></div>
                            <span className="font-bold text-xs tracking-wider uppercase">
                                {!isOnline ? 'Desconectado' :
                                    (subscriptionStatus === 'SUBSCRIBED' || subscriptionStatus === 'POLLING') ? 'En línea' :
                                        subscriptionStatus === 'CONNECTING' ? 'Conectando...' :
                                            'Reconectando...'}
                            </span>
""",
)

# Permanent regression proving that a successful RPC reconciliation is enough
# to keep the driver operational even if the WebSocket never reaches SUBSCRIBED.
test_path = Path('tests/nativeDriverChatGhostRegression.test.mjs')
test_source = test_path.read_text(encoding='utf-8')
contract_test = r'''

test('driver remains online when Realtime falls back to RPC polling', async () => {
    const dashboard = await read('src/pages/DriverDashboard.jsx');
    assert.match(dashboard, /current === 'SUBSCRIBED' \? current : 'POLLING'/);
    assert.match(dashboard, /\['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'\]/);
    assert.match(dashboard, /subscriptionStatus === 'POLLING'/);
    assert.match(dashboard, /directed offers flag timeout/);
});
'''
if "driver remains online when Realtime falls back to RPC polling" not in test_source:
    test_path.write_text(test_source + contract_test, encoding='utf-8')

# Advance the Android release because Play Console requires a new versionCode.
replace_once(
    'android/app/build.gradle',
    '        versionCode 52\n        versionName "1.5.20"\n',
    '        versionCode 53\n        versionName "1.5.21"\n',
)

for path in (
    'tests/driverGhostOfferRegression.test.mjs',
    'tests/passengerRideVoice.test.mjs',
    'tests/routeWaypoints.test.mjs',
):
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8')
    source = source.replace('/versionCode 52/', '/versionCode 53/')
    source = source.replace('/versionName "1\\.5\\.20"/', '/versionName "1\\.5\\.21"/')
    file_path.write_text(source, encoding='utf-8')
