from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one match, found {count}\n"
            f"--- needle ---\n{old}"
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(
            f"{path}: expected {expected} matches, found {count}\n"
            f"--- needle ---\n{old}"
        )
    file_path.write_text(text.replace(old, new), encoding="utf-8")


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{path}: start marker not found: {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{path}: end marker not found: {end_marker!r}")
    if text.find(start_marker, start + 1) >= 0:
        raise SystemExit(f"{path}: start marker is not unique")
    file_path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


# ---------------------------------------------------------------------------
# Driver dashboard: use the directed-offer contract instead of hydrating every
# globally visible requested ride. This removes stale/assigned rides on login.
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/DriverDashboard.jsx",
    "import { supabase, getUserProfile } from '../services/supabase';\n",
    "import { supabase, getUserProfile } from '../services/supabase';\n"
    "import { acceptRide as acceptRideRequest, areDirectedRideOffersEnabled, listDirectedRideOffers } from '../services/rideApi';\n"
    "import { FEATURES } from '../config/features';\n",
)

replace_once(
    "src/pages/DriverDashboard.jsx",
    "import { getDistanceFromLatLonInKm } from '../utils/geoUtils';\n",
    "import { getDistanceFromLatLonInKm } from '../utils/geoUtils';\n"
    "import { isDriverRideRequestAvailable } from '../utils/driverRideOffer';\n",
)

replace_once(
    "src/pages/DriverDashboard.jsx",
    """        const checkRide = (ride) => {
            const rideType = ride.ride_type ? ride.ride_type.toLowerCase() : 'standard';
""",
    """        const checkRide = (ride) => {
            if (!isDriverRideRequestAvailable(ride)) return false;

            const rideType = ride.ride_type ? ride.ride_type.toLowerCase() : 'standard';
""",
)

legacy_accept = """                                    await supabase.from('rides')
                                        .update({ status: 'accepted', driver_id: user.id })
                                        .eq('id', rideId)
                                        .eq('status', 'requested');
"""
replace_all(
    "src/pages/DriverDashboard.jsx",
    legacy_accept,
    "                                    await acceptRideRequest(rideId);\n",
    expected=2,
)

new_realtime_effect = r'''    // Realtime listener for incoming trip requests. Production dispatch is
    // directed: a driver must only hydrate active rows from ride_offers. The
    // legacy rides channel remains as a guarded rollback path.
    useEffect(() => {
        let channel;
        let reconcileTimer;
        let disposed = false;
        let reconcileRequests = null;

        if (!isOnline || !profile?.id) {
            setRequests([]);
            setSubscriptionStatus('DISCONNECTED');
            return undefined;
        }

        const resyncWhenVisible = () => {
            if (document.visibilityState === 'visible') void reconcileRequests?.();
        };

        const setupRealtime = async () => {
            setSubscriptionStatus('CONNECTING');

            let directedOffersEnabled = FEATURES.directedRideOffers;
            try {
                directedOffersEnabled = await areDirectedRideOffersEnabled();
            } catch (error) {
                console.warn('[driver-offers] runtime flag unavailable; using build flag:', error);
            }
            if (disposed) return;

            if (directedOffersEnabled) {
                const reconcileDirectedOffers = async () => {
                    try {
                        const offers = await listDirectedRideOffers(20);
                        if (!disposed) processRequests(offers, true);
                    } catch (error) {
                        if (!disposed) {
                            console.warn('[driver-offers] reconciliation failed:', error);
                            setRequests([]);
                        }
                    }
                };
                reconcileRequests = reconcileDirectedOffers;

                await reconcileDirectedOffers();
                if (disposed) return;

                channel = supabase
                    .channel(`driver-ride-offers:${profile.id}`)
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'ride_offers',
                        filter: `driver_id=eq.${profile.id}`,
                    }, () => void reconcileDirectedOffers())
                    .subscribe((status) => {
                        setSubscriptionStatus(status);
                        if (status === 'SUBSCRIBED') void reconcileDirectedOffers();
                    });

                // Expirations do not emit UPDATE events, so reconcile against the
                // server periodically and whenever the app returns to foreground.
                reconcileTimer = window.setInterval(reconcileDirectedOffers, 5000);
                return;
            }

            const fetchLegacyRequests = async () => {
                const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
                const { data, error } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('status', 'requested')
                    .is('driver_id', null)
                    .gte('created_at', tenMinAgo)
                    .order('created_at', { ascending: false })
                    .limit(20);

                if (error) {
                    console.warn('[driver-rides] legacy reconciliation failed:', error);
                    if (!disposed) setRequests([]);
                    return;
                }
                if (!disposed) processRequests(data || [], true);
            };
            reconcileRequests = fetchLegacyRequests;

            channel = supabase
                .channel('public:rides')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, (payload) => {
                    if (isDriverRideRequestAvailable(payload.new)) {
                        processRequests([payload.new], false);
                    }
                })
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (payload) => {
                    if (!isDriverRideRequestAvailable(payload.new)) {
                        setRequests((current) => current.filter((ride) => ride.id !== payload.new.id));
                    } else {
                        processRequests([payload.new], false);
                    }
                })
                .subscribe((status) => {
                    setSubscriptionStatus(status);
                    if (status === 'SUBSCRIBED') void fetchLegacyRequests();
                });
        };

        window.addEventListener('focus', resyncWhenVisible);
        document.addEventListener('visibilitychange', resyncWhenVisible);
        void setupRealtime();

        return () => {
            disposed = true;
            window.removeEventListener('focus', resyncWhenVisible);
            document.removeEventListener('visibilitychange', resyncWhenVisible);
            if (reconcileTimer) window.clearInterval(reconcileTimer);
            if (channel) supabase.removeChannel(channel);
        };
    }, [isOnline, profile?.id, processRequests]);

'''
replace_between(
    "src/pages/DriverDashboard.jsx",
    "    // Realtime listener for incoming trip requests\n",
    "    // Expire requests older than 5 mins\n",
    new_realtime_effect,
)

replace_once(
    "src/pages/DriverDashboard.jsx",
    """    // Expire requests older than 5 mins
    useEffect(() => {
        if (!isOnline) return;
        const id = setInterval(() => {
            const cutoff = Date.now() - 5 * 60 * 1000;
            setRequests(prev => prev.filter(r => new Date(r.created_at).getTime() > cutoff));
        }, 60000);
        return () => clearInterval(id);
    }, [isOnline]);
""",
    """    // Remove an offer as soon as its real server deadline passes. This is a
    // local UX guard; the five-second server reconciliation remains authoritative.
    useEffect(() => {
        if (!isOnline) return undefined;
        const id = window.setInterval(() => {
            setRequests((current) => current.filter((ride) => isDriverRideRequestAvailable(ride)));
        }, 1000);
        return () => window.clearInterval(id);
    }, [isOnline]);
""",
)


# ---------------------------------------------------------------------------
# Ride API and acceptance: use the atomic RPC for directed offers.
# ---------------------------------------------------------------------------
replace_once(
    "src/services/rideApi.js",
    """export const listDirectedRideOffers = async (limit = 20) => {
    const rows = unwrap(await supabase.rpc('driver_list_ride_offers', { p_limit: limit })) || [];
    return rows.map((row) => ({
        offerId: row.offer_id,
        expiresAt: row.expires_at,
        distanceKm: row.distance_km,
        score: row.score,
        ...(row.ride || {}),
    }));
};

""",
    """export const listDirectedRideOffers = async (limit = 20) => {
    const rows = unwrap(await supabase.rpc('driver_list_ride_offers', { p_limit: limit })) || [];
    return rows.map((row) => ({
        offerId: row.offer_id,
        expiresAt: row.expires_at,
        distanceKm: row.distance_km,
        score: row.score,
        ...(row.ride || {}),
    }));
};

export const areDirectedRideOffersEnabled = async () => {
    const value = unwrap(await supabase.rpc('higo_directed_offers_enabled'));
    return value === true || value === 'true' || value === 1;
};

""",
)

replace_once(
    "src/hooks/useDriverActiveTrip.js",
    "            if (FEATURES.serverSideRideState) {\n                accepted = await acceptRide(ride.id);\n",
    "            if (FEATURES.serverSideRideState || ride.offerId || ride.offer_id) {\n                accepted = await acceptRide(ride.id);\n",
)

replace_once(
    "src/hooks/useDriverActiveTrip.js",
    """        } catch (error) {
            if (/unavailable|ride_unavailable/i.test(error?.message || '')) {
                toast.error('Este viaje ya fue tomado por otro conductor.');
""",
    """        } catch (error) {
            const errorText = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
            if (/unavailable|ride_unavailable|invalid_ride_transition|offer.*expired|active offer|42501/i.test(errorText)) {
                toast.error('Esta solicitud ya no está disponible.');
""",
)


# ---------------------------------------------------------------------------
# Request card: count down from the actual offer deadline and do not reset when
# the parent recreates its inline onDecline callback.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/driver/IncomingRequestCard.jsx",
    "import React, { useEffect, useState } from 'react';\n",
    "import React, { useEffect, useRef, useState } from 'react';\n"
    "import { resolveRideRequestDeadline, secondsUntilRideRequestDeadline } from '../../utils/driverRideOffer';\n",
)

replace_between(
    "src/components/driver/IncomingRequestCard.jsx",
    "const IncomingRequestCard = ({ request, onAccept, onDecline }) => {\n",
    "    if (!request) return null;\n",
    r'''const IncomingRequestCard = ({ request, onAccept, onDecline }) => {
    const onDeclineRef = useRef(onDecline);
    const [deadlineMs, setDeadlineMs] = useState(() => resolveRideRequestDeadline(request));
    const [initialSeconds, setInitialSeconds] = useState(() => (
        secondsUntilRideRequestDeadline(resolveRideRequestDeadline(request)) || 25
    ));
    const [timeLeft, setTimeLeft] = useState(initialSeconds);

    useEffect(() => {
        onDeclineRef.current = onDecline;
    }, [onDecline]);

    useEffect(() => {
        const deadline = resolveRideRequestDeadline(request);
        const initial = secondsUntilRideRequestDeadline(deadline);
        setDeadlineMs(deadline);
        setInitialSeconds(Math.max(1, initial));
        setTimeLeft(initial);

        let expired = false;
        const tick = () => {
            const remaining = secondsUntilRideRequestDeadline(deadline);
            setTimeLeft(remaining);
            if (remaining <= 0 && !expired) {
                expired = true;
                stopLoopingRequestAlert();
                onDeclineRef.current?.(request.id);
            }
        };

        tick();
        const timer = window.setInterval(tick, 250);
        return () => window.clearInterval(timer);
    }, [request.id, request.expiresAt, request.expires_at, request.offer_expires_at]);

''',
)

replace_once(
    "src/components/driver/IncomingRequestCard.jsx",
    "    const progressWidth = `${(timeLeft / 25) * 100}%`;\n",
    "    const progressWidth = `${Math.max(0, Math.min(100, (timeLeft / Math.max(1, initialSeconds)) * 100))}%`;\n",
)


# Android release containing the installed-app fix.
replace_once(
    "android/app/build.gradle",
    "        versionCode 48\n        versionName \"1.5.16\"\n",
    "        versionCode 49\n        versionName \"1.5.17\"\n",
)


# Persistent regression tests are created only after the source patch is
# applied, so the regular PR Quality Gate can still evaluate the staging branch.
Path("tests/driverGhostOfferRegression.test.mjs").write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    isDriverRideRequestAvailable,
    resolveRideRequestDeadline,
    secondsUntilRideRequestDeadline,
} from '../src/utils/driverRideOffer.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('driver request availability rejects assigned, completed and expired rows', () => {
    const now = Date.parse('2026-08-05T03:00:00.000Z');
    assert.equal(isDriverRideRequestAvailable({ id: 1, status: 'accepted', driver_id: null }, now), false);
    assert.equal(isDriverRideRequestAvailable({ id: 2, status: 'requested', driver_id: 'other-driver' }, now), false);
    assert.equal(isDriverRideRequestAvailable({
        id: 3,
        status: 'requested',
        driver_id: null,
        expiresAt: '2026-08-05T02:59:59.000Z',
    }, now), false);
});

test('driver request availability accepts only an active unassigned offer', () => {
    const now = Date.parse('2026-08-05T03:00:00.000Z');
    assert.equal(isDriverRideRequestAvailable({
        id: 4,
        status: 'requested',
        driver_id: null,
        expiresAt: '2026-08-05T03:00:25.000Z',
    }, now), true);
});

test('countdown is derived from the server offer deadline', () => {
    const now = Date.parse('2026-08-05T03:00:00.000Z');
    const deadline = resolveRideRequestDeadline({ expiresAt: '2026-08-05T03:00:24.200Z' }, now);
    assert.equal(deadline, Date.parse('2026-08-05T03:00:24.200Z'));
    assert.equal(secondsUntilRideRequestDeadline(deadline, now), 25);
});

test('driver dashboard consumes directed offers and preserves a guarded legacy fallback', async () => {
    const [dashboard, card, hook, api, gradle] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/components/driver/IncomingRequestCard.jsx'),
        read('src/hooks/useDriverActiveTrip.js'),
        read('src/services/rideApi.js'),
        read('android/app/build.gradle'),
    ]);

    assert.match(dashboard, /areDirectedRideOffersEnabled/);
    assert.match(dashboard, /listDirectedRideOffers\(20\)/);
    assert.match(dashboard, /table: 'ride_offers'/);
    assert.match(dashboard, /driver_id=eq\.\$\{profile\.id\}/);
    assert.match(dashboard, /\.is\('driver_id', null\)/);
    assert.match(dashboard, /isDriverRideRequestAvailable/);
    assert.match(card, /resolveRideRequestDeadline/);
    assert.match(card, /onDeclineRef/);
    assert.match(hook, /ride\.offerId \|\| ride\.offer_id/);
    assert.match(api, /higo_directed_offers_enabled/);
    assert.match(gradle, /versionCode 49/);
    assert.match(gradle, /versionName "1\.5\.17"/);
});
''', encoding="utf-8")
