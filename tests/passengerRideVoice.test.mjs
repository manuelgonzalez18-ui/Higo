import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    PASSENGER_RIDE_VOICE_PHRASES,
    passengerRideVoiceStorageKey,
    resolvePassengerRideMilestone,
} from '../src/utils/passengerRideVoice.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('uses the exact passenger voice phrases requested by product', () => {
    assert.deepEqual(PASSENGER_RIDE_VOICE_PHRASES, {
        searching: 'Buscando Higo Driver',
        accepted: 'Higo Driver encontrado',
        arrived: 'Tu Higo Driver llegó',
        started: 'Tu viaje ha comenzado',
        completed: 'Has llegado a tu destino',
        delivery_searching: 'Buscando Higo Driver',
        delivery_accepted: 'Higo Driver Encontrado',
        delivery_picked_up: 'Tu envío ha sido Recogido',
        delivery_completed: 'Tu Envío ha sido entregado',
    });
});

test('resolves the latest passenger milestone from the authoritative ride row', () => {
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'requested' }), 'searching');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'requested', driver_id: 'driver-1' }), 'accepted');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'accepted', arrived_at_pickup_at: '2026-08-05T04:00:00Z' }), 'arrived');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'in_progress', driver_id: 'driver-1' }), 'started');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'completed', driver_id: 'driver-1' }), 'completed');
});

test('resolves the four Higo Envíos voice milestones', () => {
    assert.equal(
        resolvePassengerRideMilestone({ id: 2, status: 'requested', service_type: 'delivery' }),
        'delivery_searching',
    );
    assert.equal(
        resolvePassengerRideMilestone({ id: 2, status: 'accepted', driver_id: 'driver-2', service_type: 'delivery' }),
        'delivery_accepted',
    );
    assert.equal(
        resolvePassengerRideMilestone({ id: 2, status: 'in_progress', driver_id: 'driver-2', service_type: 'delivery' }),
        'delivery_picked_up',
    );
    assert.equal(
        resolvePassengerRideMilestone({ id: 3, status: 'completed', delivery_info: { receiverName: 'Ana' } }),
        'delivery_completed',
    );
});

test('dedupe key is isolated by ride and milestone', () => {
    assert.notEqual(
        passengerRideVoiceStorageKey(10, 'accepted'),
        passengerRideVoiceStorageKey(10, 'arrived'),
    );
    assert.notEqual(
        passengerRideVoiceStorageKey(10, 'accepted'),
        passengerRideVoiceStorageKey(11, 'accepted'),
    );
});

test('passenger screens integrate the centralized voice contract', async () => {
    const [confirmPage, statusPage, gradle] = await Promise.all([
        read('src/pages/ConfirmTripPage.jsx'),
        read('src/pages/RideStatusPage.jsx'),
        read('android/app/build.gradle'),
    ]);

    assert.match(confirmPage, /announcePassengerRideMilestone/);
    assert.match(confirmPage, /milestone: isDelivery \? 'delivery_searching' : 'searching'/);
    assert.match(statusPage, /announcePassengerRideState/);
    assert.match(statusPage, /announcePassengerRideState\(payload\.new\)/);
    assert.match(statusPage, /announcePassengerRideState\(data\)/);
    assert.match(gradle, /versionCode 60/);
    assert.match(gradle, /versionName "1\.5\.28"/);
});