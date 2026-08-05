import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    hasActiveDirectedRideOffer,
    isDriverRideRequestAvailable,
} from '../src/utils/driverRideOffer.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('directed mode rejects a ride that has no live offer id', () => {
    const now = Date.parse('2026-08-05T16:00:00Z');
    const ride = {
        id: 900,
        status: 'requested',
        driver_id: null,
        expiresAt: '2026-08-05T16:03:00Z',
    };
    assert.equal(isDriverRideRequestAvailable(ride, now), true);
    assert.equal(hasActiveDirectedRideOffer(ride, now), false);
    assert.equal(hasActiveDirectedRideOffer({ ...ride, offerId: 77 }, now), true);
});

test('native driver presence uses a server-owned RPC and restores status', async () => {
    const [dashboard, locationHook, migration] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/hooks/useBackgroundLocation.js'),
        read('supabase/migrations/20260805123500_driver_presence_and_offer_hardening.sql'),
    ]);

    assert.match(dashboard, /rpc\('driver_set_online_status'/);
    assert.match(dashboard, /setIsOnline\(userProfile\.status === 'online'\)/);
    assert.match(locationHook, /rpc\('update_driver_gps'/);
    assert.match(migration, /create or replace function public\.driver_set_online_status/);
    assert.match(migration, /status = 'online'/);
    assert.match(migration, /status = 'withdrawn'/);
});

test('chat subscribes before opening and supports the native chat event', async () => {
    const chat = await read('src/components/ChatWidget.jsx');
    assert.match(chat, /useState\(\(\) => getRideIdFromHash\(\)\)/);
    assert.match(chat, /'arrived'/);
    assert.match(chat, /addEventListener\('open-chat'/);
    assert.match(chat, /addEventListener\('higo-open-chat'/);
    assert.match(chat, /if \(!rideId\) return undefined/);
});

test('motorcycle cards require a current directed offer and server vehicle match', async () => {
    const [dashboard, app, api, migration] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/App.jsx'),
        read('src/services/rideApi.js'),
        read('supabase/migrations/20260805123500_driver_presence_and_offer_hardening.sql'),
    ]);

    assert.match(dashboard, /hasActiveDirectedRideOffer/);
    assert.match(dashboard, /processRequests\(offers, true, true\)/);
    assert.match(api, /getDirectedRideOfferForRide/);
    assert.match(app, /await getDirectedRideOfferForRide\(rideId\)/);
    assert.match(app, /ignored stale or non-directed offer/);
    assert.match(migration, /higo_canonical_vehicle_type\(p\.vehicle_type\)/);
    assert.match(migration, /higo_canonical_vehicle_type\(r\.ride_type\)/);
});
