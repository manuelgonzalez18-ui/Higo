import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canonicalVehicleType,
    computeFallbackQuote,
    computeWaitFee,
    haversineKm,
    safeRouteDistanceKm,
} from '../src/utils/ridePricing.js';

const origin = { lat: 10.482, lng: -66.102 };
const destination = { lat: 10.474, lng: -66.094 };

test('canonicalVehicleType normalizes known aliases', () => {
    assert.equal(canonicalVehicleType('Moto'), 'moto');
    assert.equal(canonicalVehicleType('camioneta'), 'van');
    assert.equal(canonicalVehicleType('carro'), 'standard');
    assert.equal(canonicalVehicleType('Corolla'), 'standard');
    assert.equal(canonicalVehicleType(null), 'standard');
});

test('route distance never falls below haversine', () => {
    const minimum = haversineKm(origin, destination);
    const distance = safeRouteDistanceKm({ origin, destination, routeDistanceKm: 0.01 });
    assert.ok(distance >= minimum);
});

test('route distance caps implausible inflation', () => {
    const minimum = haversineKm(origin, destination);
    const distance = safeRouteDistanceKm({ origin, destination, routeDistanceKm: 999 });
    assert.ok(distance <= Math.max(minimum * 4, minimum + 5));
});

test('delivery and stops raise the deterministic quote', () => {
    const ride = computeFallbackQuote({ origin, destination, vehicleType: 'moto', serviceType: 'ride' });
    const delivery = computeFallbackQuote({
        origin,
        destination,
        vehicleType: 'moto',
        serviceType: 'delivery',
        stopsCount: 2,
    });
    assert.ok(delivery.subtotal > ride.subtotal);
    assert.equal(delivery.stopsCount, 2);
});

test('quote bounds surge and stops', () => {
    const quote = computeFallbackQuote({
        origin,
        destination,
        vehicleType: 'standard',
        stopsCount: 100,
        surgeMultiplier: 100,
    });
    assert.equal(quote.stopsCount, 5);
    assert.equal(quote.surgeMultiplier, 5);
});

test('wait fee keeps three minutes free and charges the rest', () => {
    assert.equal(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 180 }), 0);
    assert.equal(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 480 }), 0.4);
});
