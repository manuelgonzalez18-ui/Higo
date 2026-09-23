import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function testPhpHttp(php) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const directory = await mkdtemp(path.join(tmpdir(), 'higo-php-http-'));
    const logfile = path.join(directory, 'requests.jsonl');
    const publicPath = path.join(directory, 'public');
    await mkdir(path.join(publicPath, 'api'), { recursive: true });
    for (const file of ['ride-quote.php', '_ride_quote.php', 'tracking-evidence.php', '_ratelimit.php', '_cors.php']) {
        await copyFile(path.join('public/api', file), path.join(publicPath, 'api', file));
    }
    await writeFile(path.join(publicPath, 'banesco-core.php'), '<?php // Transport stubs are defined only in the isolated test router.\n');
    const child = spawn(php, ['-d', `sys_temp_dir=${directory}`, '-S', `127.0.0.1:${port}`, 'tests/php/http-router.php'], {
        windowsHide: true, env: { ...process.env, HIGO_TEST_HTTP_LOG: logfile, HIGO_TEST_PUBLIC_PATH: publicPath }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let diagnostics = '';
    let processError;
    child.stderr.on('data', chunk => { diagnostics += chunk; });
    child.on('error', error => { processError = error; });
    const base = `http://127.0.0.1:${port}`;
    let counter = 0;
    async function request(endpoint, { scenario = 'success', body, auth = true, method = 'POST', headers = {}, raw } = {}) {
        const id = `request-${++counter}`;
        const response = await fetch(base + endpoint, {
            method,
            signal: AbortSignal.timeout(5000),
            headers: { 'X-Test-Case': scenario, 'X-Test-Id': id, ...(auth ? { Authorization: 'Bearer synthetic-jwt' } : {}), 'Content-Type': 'application/json', ...headers },
            body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
        });
        const text = await response.text();
        const entries = (await readFile(logfile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.id === id);
        return { response, text, entries };
    }
    const input = {
        pickupCoords: { lat: 10.46, lng: -65.97 }, dropoffCoords: { lat: 10.48, lng: -65.99 }, vehicleType: 'standard', serviceType: 'delivery',
        stops: [{ lat: 10.461, lng: -65.971, address: 'First' }, { lat: 10.463, lng: -65.972, address: 'Second' }],
        routeDistanceKm: 0.001, routeDurationMin: 0, price: 0, userId: 'forged-user', clientSubtotalFloor: 0,
    };
    const endpoint = '/api/ride-quote.php';
    const token = '00000000-0000-4000-8000-000000000042';
    const evidence = `/api/tracking-evidence.php?token=${token}`;
    try {
        let ready = false;
        for (let attempt = 0; attempt < 80; attempt++) {
            if (processError) throw processError;
            try { if ((await fetch(base + '/ready', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Wait for the bound local server. */ }
            await delay(50);
        }
        assert.ok(ready, `PHP HTTP server failed to start: ${diagnostics}`);
        let result = await request(endpoint, { body: input, auth: false });
        assert.equal(result.response.status, 401, result.text + diagnostics);
        assert.deepEqual(result.entries, [], 'Unauthenticated requests must not contact providers');
        result = await request(endpoint, { body: input, scenario: 'invalid-session' });
        assert.equal(result.response.status, 401, result.text + diagnostics);
        assert.equal(result.entries.length, 1, 'Expired session must stop before routing');
        result = await request(endpoint, { body: input, headers: { Origin: 'https://evil.example' } });
        assert.equal(result.response.status, 403);
        assert.equal(result.entries.length, 0);
        result = await request(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://localhost' } });
        assert.equal(result.response.status, 204);
        assert.equal(result.response.headers.get('access-control-allow-origin'), 'https://localhost');
        result = await request(endpoint, { method: 'GET' });
        assert.equal(result.response.status, 405);
        for (const bad of [{ ...input, pickupCoords: { lat: 91, lng: 0 } }, { ...input, stops: {} }, { ...input, promoCode: ['bad'] }, { ...input, stops: Array(6).fill(input.stops[0]) }]) {
            result = await request(endpoint, { body: bad });
            assert.equal(result.response.status, 422);
            assert.equal(result.entries.length, 1, 'Invalid input must not purchase a route');
        }
        for (const raw of ['[1,2]', '{broken', JSON.stringify({ value: 'x'.repeat(17000) })]) {
            result = await request(endpoint, { raw });
            assert.equal(result.response.status, 422);
            assert.equal(result.entries.length, 1);
        }
        result = await request(endpoint, { body: input });
        assert.equal(result.response.status, 200, result.text);
        assert.equal(JSON.parse(result.text).finalPrice, 7.5);
        assert.equal(result.response.headers.get('cache-control'), 'no-store');
        const route = result.entries.find(entry => entry.url.includes('routes.googleapis.com'));
        assert.deepEqual(route.data.intermediates.map(item => item.location.latLng.latitude), [10.461, 10.463]);
        const stored = result.entries.find(entry => entry.url.endsWith('/higo_store_route_quote')).data;
        assert.equal(stored.p_distance_km, 4.5);
        assert.equal(stored.p_duration_min, 13);
        assert.notEqual(stored.p_user_id, 'forged-user');
        assert.equal(stored.p_service_type, 'delivery');
        for (const scenario of ['provider-failure', 'provider-malformed', 'provider-empty', 'store-failure']) {
            result = await request(endpoint, { body: input, scenario });
            assert.equal(result.response.status, 503);
            assert.equal(JSON.parse(result.text).error, 'quote_unavailable');
            if (scenario !== 'store-failure') assert.equal(result.entries.length, 2, 'Failed routes must never be persisted');
        }
        for (let attempt = 0; attempt < 11; attempt++) {
            result = await request(endpoint, { body: input, headers: { 'X-Test-User': 'one-user-many-ips' } });
            assert.equal(result.response.status, attempt < 10 ? 200 : 429, 'Account limit must survive IP changes');
        }
        assert.equal(result.entries.length, 1, 'Rate limited account must stop before provider request');
        assert.ok(Number(result.response.headers.get('retry-after')) > 0);
        result = await request(evidence, { method: 'GET' });
        assert.equal(result.response.status, 200, result.text);
        const imageUrl = new URL(JSON.parse(result.text).url);
        assert.equal(imageUrl.origin, 'https://evidence.higo.test');
        assert.equal(imageUrl.searchParams.get('content'), '1');
        assert.equal(result.entries.length, 1, 'Metadata must not mint a Storage signed URL');
        result = await request(imageUrl.pathname + imageUrl.search, { method: 'GET' });
        assert.equal(result.response.status, 200);
        assert.equal(result.response.headers.get('content-type'), 'image/png');
        assert.match(result.response.headers.get('cache-control'), /no-store/);
        assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(result.entries[0].url.endsWith('/get_public_tracking'), true, 'Image fetch must recheck token');
        assert.equal(result.entries.length, 2);
        for (const scenario of ['revoked', 'expired', 'completion-expired', 'not-completed']) {
            result = await request(imageUrl.pathname + imageUrl.search, { method: 'GET', scenario });
            assert.equal(result.response.status, 404);
            assert.equal(result.entries.length, 1, 'Inaccessible tokens cannot access Storage');
        }
        result = await request(evidence + '&content=1', { method: 'GET', scenario: 'tracking-failure' });
        assert.equal(result.response.status, 503);
        assert.equal(result.entries.length, 1, 'Database failure cannot access Storage');
        result = await request(evidence + '&content=1&path=other/private.jpg', { method: 'GET' });
        assert.equal(result.response.status, 200);
        assert.ok(result.entries[1].url.endsWith('/42/delivery/00000000-0000-4000-8000-000000000042.png'), 'Path must come exclusively from the token RPC');
        result = await request(evidence + '&content=1', { method: 'GET', scenario: 'unsafe-path' });
        assert.equal(result.response.status, 503);
        assert.equal(result.entries.length, 1);
        result = await request(evidence + '&content=1', { method: 'GET', scenario: 'bad-image' });
        assert.equal(result.response.status, 503);
        assert.ok(!result.text.includes('<svg'));
        result = await request('/api/tracking-evidence.php?token[]=bad', { method: 'GET' });
        assert.equal(result.response.status, 404);
        assert.equal(result.entries.length, 0);
        console.log('PHP HTTP contracts passed: auth, CORS, provider failure, authoritative metrics, ordered stops, token expiry/revocation, private images');
    } finally {
        const stopped = new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
        child.kill();
        await stopped;
        if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('higo-php-http-')) throw new Error('Unsafe test cleanup path');
        await rm(directory, { recursive: true, force: true });
    }
}
