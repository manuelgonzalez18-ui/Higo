import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isGenericCurrentLocationLabel,
    nearestPricingLocation,
    pricingDistanceKm,
} from '../src/utils/pricingLocation.js';

test('current-location labels are recognized for pricing resolution', () => {
    assert.equal(isGenericCurrentLocationLabel('Ubicación Actual'), true);
    assert.equal(isGenericCurrentLocationLabel('Mi ubicación'), true);
    assert.equal(isGenericCurrentLocationLabel('Curiepe'), false);
});

test('nearest pricing location resolves a nearby known sector', () => {
    const sotillo = { title: 'Sotillo', lat: 10.400214403419566, lng: -66.08456610041378 };
    const curiepe = { title: 'Curiepe', lat: 10.474252096311538, lng: -66.16559159635693 };
    const current = { lat: 10.401, lng: -66.085 };
    const nearest = nearestPricingLocation(current, [curiepe, sotillo], 2.5);
    assert.equal(nearest?.title, 'Sotillo');
    assert.ok(nearest.distanceKm < 1);
});

test('pricing location does not guess when the user is too far from known points', () => {
    const location = { title: 'Sotillo', lat: 10.400214403419566, lng: -66.08456610041378 };
    assert.equal(nearestPricingLocation({ lat: 11.0, lng: -67.0 }, [location], 2.5), null);
});

test('pricing distance is symmetric', () => {
    const a = { lat: 10.4002, lng: -66.0846 };
    const b = { lat: 10.4848, lng: -66.0980 };
    assert.ok(Math.abs(pricingDistanceKm(a, b) - pricingDistanceKm(b, a)) < 1e-9);
});
