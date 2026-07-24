import test from 'node:test';
import assert from 'node:assert/strict';

import { deferAuthCallback } from '../src/utils/deferAuthCallback.js';
import { isRetryableNetworkError, withRetry } from '../src/utils/withTimeout.js';

test('deferAuthCallback never executes application code synchronously', async () => {
    const scheduled = [];
    const events = [];
    const wrapped = deferAuthCallback(
        (event, session) => events.push([event, session?.user?.id]),
        (task) => scheduled.push(task),
    );

    wrapped('SIGNED_IN', { user: { id: 'user-1' } });

    assert.deepEqual(events, []);
    assert.equal(scheduled.length, 1);

    scheduled.shift()();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(events, [['SIGNED_IN', 'user-1']]);
});

test('deferAuthCallback routes async failures without returning a promise to Supabase', async () => {
    const scheduled = [];
    const errors = [];
    const wrapped = deferAuthCallback(
        async () => { throw new Error('callback failed'); },
        (task) => scheduled.push(task),
        (error) => errors.push(error.message),
    );

    const result = wrapped('TOKEN_REFRESHED', null);
    assert.equal(result, undefined);

    scheduled.shift()();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(errors, ['callback failed']);
});

test('timeout messages are not retryable because the underlying operation is still active', async () => {
    let calls = 0;

    await assert.rejects(
        () => withRetry(async () => {
            calls += 1;
            throw new Error('La conexión tardó demasiado. Probá de nuevo.');
        }, { attempts: 3, baseDelayMs: 0 }),
        /tardó demasiado/,
    );

    assert.equal(calls, 1);
    assert.equal(isRetryableNetworkError(new Error('timed out')), false);
});

test('completed network failures still receive bounded retries', async () => {
    let calls = 0;

    await assert.rejects(
        () => withRetry(async () => {
            calls += 1;
            throw new Error('Failed to fetch');
        }, { attempts: 3, baseDelayMs: 0 }),
        /Failed to fetch/,
    );

    assert.equal(calls, 3);
    assert.equal(isRetryableNetworkError(new Error('Failed to fetch')), true);
    assert.equal(isRetryableNetworkError(new Error('Invalid login credentials')), false);
});
