import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVehicleMarkerRotation } from '../src/utils/vehicleMarkerRotation.js';
import { getRideMessageKey, isRideMessageAtOrAfter } from '../src/utils/rideMessageSync.js';

test('side-profile motorcycle marker remains upright regardless of GPS bearing', () => {
    assert.equal(resolveVehicleMarkerRotation({ heading: 0, type: 'moto' }), 0);
    assert.equal(resolveVehicleMarkerRotation({ heading: 135, type: 'moto' }), 0);
    assert.equal(resolveVehicleMarkerRotation({ heading: 270, type: 'motorcycle' }), 0);
});

test('directional car and van markers preserve their heading correction', () => {
    assert.equal(resolveVehicleMarkerRotation({ heading: 90, type: 'standard' }), 0);
    assert.equal(resolveVehicleMarkerRotation({ heading: 180, type: 'van' }), 90);
    assert.equal(resolveVehicleMarkerRotation({ heading: -90, type: 'standard' }), 180);
});

test('chat synchronization identifies messages inserted during subscription startup', () => {
    const cutoff = '2026-08-05T01:40:00.000Z';
    const firstMessage = {
        id: 501,
        sender_id: 'driver-1',
        content: 'Ya voy en camino',
        created_at: '2026-08-05T01:40:00.150Z',
    };

    assert.equal(getRideMessageKey(firstMessage), '501');
    assert.equal(isRideMessageAtOrAfter(firstMessage, cutoff), true);
    assert.equal(isRideMessageAtOrAfter({ ...firstMessage, created_at: '2026-08-05T01:39:59.999Z' }, cutoff), false);
});

test('chat synchronization has a stable fallback key for rows without an id', () => {
    assert.equal(getRideMessageKey({
        sender_id: 'passenger-1',
        created_at: '2026-08-05T01:40:01.000Z',
        content: 'Hola',
    }), 'passenger-1:2026-08-05T01:40:01.000Z:Hola');
});
