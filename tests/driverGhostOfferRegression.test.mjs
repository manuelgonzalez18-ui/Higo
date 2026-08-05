import test from 'node:test';
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
    assert.match(gradle, /versionCode 53/);
    assert.match(gradle, /versionName "1\.5\.21"/);
});
