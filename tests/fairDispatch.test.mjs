import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/20260803150000_fair_progressive_dispatch.sql', import.meta.url);
const raceGuardPath = new URL('../supabase/migrations/20260803150100_fair_dispatch_acceptance_race_guard.sql', import.meta.url);
const hookPath = new URL('../src/hooks/useBackgroundLocation.js', import.meta.url);
const pushPath = new URL('../public/api/send-ride-offer-push.php', import.meta.url);

const [migration, raceGuard, hook, push] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(raceGuardPath, 'utf8'),
    readFile(hookPath, 'utf8'),
    readFile(pushPath, 'utf8'),
]);

test('fair dispatch is off by default and gated behind directed offers', () => {
    assert.match(migration, /fair_progressive_dispatch boolean not null default false/i);
    assert.match(migration, /directed_ride_offers and fair_progressive_dispatch/i);
    assert.match(migration, /fair_dispatch_shadow boolean not null default false/i);
});

test('dispatch expands through four configured waves', () => {
    for (const wave of [1, 2, 3, 4]) {
        assert.match(migration, new RegExp(`\\(${wave},\\s*\\d+`, 'i'));
    }
    assert.match(migration, /higo_dispatch_wave\(/i);
    assert.match(migration, /higo_expand_due_dispatches\(/i);
    assert.match(migration, /for update of d skip locked/i);
    assert.match(migration, /5 seconds/i);
});

test('candidate scoring balances distance, waiting and recent opportunity deficit', () => {
    assert.match(migration, /distance_score/i);
    assert.match(migration, /wait_score/i);
    assert.match(migration, /trip_deficit_score/i);
    assert.match(migration, /offer_deficit_score/i);
    assert.match(migration, /ignored_30m < 5/i);
    assert.match(migration, /not exists \([\s\S]*active_ride[\s\S]*accepted','in_progress','arrived_at_dropoff'/i);
});

test('wave expansion locks the ride before inserting late offers', () => {
    assert.match(raceGuard, /from public\.rides r[\s\S]*for update;/i);
    assert.match(raceGuard, /r\.status = 'requested'/i);
    assert.match(raceGuard, /r\.driver_id is null/i);
});

test('driver client treats directed offers as authoritative and listens in realtime', () => {
    assert.match(hook, /table:\s*'ride_offers'/);
    assert.match(hook, /filter:\s*`driver_id=eq\.\$\{profile\.id\}`/);
    assert.match(hook, /processRequests\(activeOffers, true\)/);
    assert.match(hook, /NEARBY_POLL_MIN_MS = 30000/);
});

test('offer push validates the rollout and targets exactly one driver token', () => {
    assert.match(push, /hash_equals/);
    assert.match(push, /fair_progressive_dispatch/);
    assert.match(push, /ride_offers\?id=eq\./);
    assert.match(push, /profiles\?id=eq\./);
    assert.match(push, /'token' => \$token/);
    assert.doesNotMatch(push, /foreach\s*\(\$drivers/);
});
