import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildGoogleWaypoints,
    buildOrderedRideRoute,
    normalizeRideStops,
    routeDistanceBySegmentsKm,
    routeStopsSignature,
    sumGoogleRouteLegs,
} from '../src/utils/rideRouteStops.js';

test('builds origin, stops in entered order and final destination', () => {
    assert.deepEqual(buildOrderedRideRoute({
        origin: { lat: 10.48, lng: -66.10 },
        stops: [
            { id: 1, address: 'Parada A', coords: { lat: 10.50, lng: -66.12 } },
            { id: 2, address: 'Parada B', coords: { lat: 10.52, lng: -66.14 } },
        ],
        destination: { lat: 10.55, lng: -66.16 },
    }), [
        { lat: 10.48, lng: -66.10 },
        { lat: 10.50, lng: -66.12 },
        { lat: 10.52, lng: -66.14 },
        { lat: 10.55, lng: -66.16 },
    ]);
});

test('supports an out-and-back route when final destination is the origin', () => {
    assert.deepEqual(buildOrderedRideRoute({
        origin: { lat: 10.48, lng: -66.10 },
        stops: [{ coords: { lat: 10.55, lng: -66.16 } }],
        destination: { lat: 10.48, lng: -66.10 },
    }), [
        { lat: 10.48, lng: -66.10 },
        { lat: 10.55, lng: -66.16 },
        { lat: 10.48, lng: -66.10 },
    ]);
});

test('normalizes nested stop coordinates and preserves user order', () => {
    const stops = normalizeRideStops([
        { id: 'a', address: 'Uno', coords: { lat: '10.1', lng: '-66.1' } },
        { id: 'b', name: 'Dos', location: { latitude: 10.2, longitude: -66.2 } },
    ]);
    assert.deepEqual(stops.map(({ id, address, lat, lng }) => ({ id, address, lat, lng })), [
        { id: 'a', address: 'Uno', lat: 10.1, lng: -66.1 },
        { id: 'b', address: 'Dos', lat: 10.2, lng: -66.2 },
    ]);
    assert.equal(buildGoogleWaypoints(stops).length, 2);
    assert.equal(routeStopsSignature(stops), '10.100000,-66.100000;10.200000,-66.200000');
});

test('sums every Google Directions leg instead of only the first', () => {
    const summary = sumGoogleRouteLegs({
        legs: [
            { distance: { value: 4200 }, duration: { value: 600 }, steps: [{ id: 1 }], start_location: 'origin', end_location: 'stop' },
            { distance: { value: 8500 }, duration: { value: 900 }, steps: [{ id: 2 }], start_location: 'stop', end_location: 'destination' },
        ],
    });
    assert.equal(summary.distance.value, 12700);
    assert.equal(summary.distance.text, '12.7 km');
    assert.equal(summary.duration.value, 1500);
    assert.equal(summary.duration.text, '25 min');
    assert.equal(summary.legCount, 2);
    assert.equal(summary.steps.length, 2);
    assert.equal(summary.startLocation, 'origin');
    assert.equal(summary.endLocation, 'destination');
});

test('fallback distance includes every leg including return', () => {
    const points = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 0, lng: 0 },
    ];
    const distance = routeDistanceBySegmentsKm(points, () => 10);
    assert.equal(distance, 20);
});
