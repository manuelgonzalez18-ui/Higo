import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { normalizeRouteWaypoints, routePoints } from '../src/utils/routeWaypoints.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('normalizes RequestRidePage stop objects in their selected order', () => {
    assert.deepEqual(normalizeRouteWaypoints([
        { id: 10, address: 'Parada A', coords: { lat: 10.48, lng: -66.10 } },
        { id: 11, address: 'Parada B', coords: { lat: '10.49', lng: '-66.11' } },
        { id: 12, address: 'Vacía', coords: null },
    ]), [
        { id: 10, address: 'Parada A', lat: 10.48, lng: -66.10 },
        { id: 11, address: 'Parada B', lat: 10.49, lng: -66.11 },
    ]);
});

test('builds origin → stops → final destination without optimizing order', () => {
    assert.deepEqual(routePoints(
        { lat: 1, lng: 2 },
        { lat: 7, lng: 8 },
        [{ coords: { lat: 3, lng: 4 } }, { coords: { lat: 5, lng: 6 } }],
    ), [
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 },
        { lat: 5, lng: 6 },
        { lat: 7, lng: 8 },
    ]);
});

test('both map engines integrate intermediate waypoints', async () => {
    const [google, mapbox, service, gradle] = await Promise.all([
        read('src/components/InteractiveMapGoogle.jsx'),
        read('src/components/InteractiveMapMapbox.jsx'),
        read('src/services/directionsService.js'),
        read('android/app/build.gradle'),
    ]);
    assert.match(google, /waypoints: normalizeRouteWaypoints\(waypoints\)/);
    assert.match(google, /optimizeWaypoints: false/);
    assert.match(google, /legs\.reduce/);
    assert.match(mapbox, /getRoute\(origin, destination, 'driving-traffic', markersProp\)/);
    assert.match(service, /routePoints\(origin, destination/);
    assert.match(gradle, /versionCode 58/);
    assert.match(gradle, /versionName "1\.5\.26"/);
});
