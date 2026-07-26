import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canonicalVehicleType,
    computeFallbackQuote,
    computeWaitFee,
    haversineKm,
    safeRouteDistanceKm,
    safeRouteDurationMin,
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

test('route duration caps implausible inflation', () => {
    assert.equal(safeRouteDurationMin({ distanceKm: 5, routeDurationMin: 999 }), 90);
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

test('minimum fare is a floor and is not added twice', () => {
    const quote = computeFallbackQuote({
        origin,
        destination: origin,
        vehicleType: 'standard',
        rates: {
            standard: {
                base: 1,
                minimumFare: 2.5,
                perKm: 0.4,
                perMinute: 0,
                includedKm: 1,
                stopFee: 1,
                deliveryFee: 1,
                maximumMultiplier: 1.3,
            },
        },
    });
    assert.equal(quote.subtotal, 2.5);
});

test('estimated time raises the quote when per-minute pricing is enabled', () => {
    const rates = {
        standard: {
            base: 1.5,
            minimumFare: 1.5,
            perKm: 0.4,
            perMinute: 0.05,
            includedKm: 1,
            stopFee: 1,
            deliveryFee: 1.5,
            maximumMultiplier: 1.3,
        },
    };
    const fast = computeFallbackQuote({ origin, destination, vehicleType: 'standard', routeDurationMin: 10, rates });
    const slow = computeFallbackQuote({ origin, destination, vehicleType: 'standard', routeDurationMin: 30, rates });
    assert.ok(slow.subtotal > fast.subtotal);
    assert.equal(slow.timeAmount - fast.timeAmount, 1);
});

test('quote bounds multiplier and stops', () => {
    const quote = computeFallbackQuote({
        origin,
        destination,
        vehicleType: 'standard',
        stopsCount: 100,
        surgeMultiplier: 100,
    });
    assert.equal(quote.stopsCount, 5);
    assert.equal(quote.surgeMultiplier, 1.3);
});

test('wait fee keeps three minutes free and charges the rest', () => {
    assert.equal(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 180 }), 0);
    assert.equal(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 480 }), 0.4);
});

test('wait fee respects configurable free minutes', () => {
    const rates = {
        standard: {
            base: 1.5,
            waitPerMin: 0.1,
            freeWaitMinutes: 5,
            maximumMultiplier: 1.3,
        },
    };
    assert.equal(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 300, rates }), 0);
    assert.equal(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 600, rates }), 0.5);
});
