import test from 'node:test';
import assert from 'node:assert/strict';
import { compareInventories } from '../scripts/compare-schema-inventory.mjs';

const object = (key, signature = { rls: true, acl: ['authenticated=r/postgres'] }) => ({ kind: 'relation', key, signature });
const inventory = objects => ({ formatVersion: 1, scope: 'test catalog', serverVersion: '17.6', objects });

test('schema comparison distinguishes missing, additional and changed objects', () => {
    const report = compareInventories(
        inventory([object('public.rides'), object('public.quotes'), object('public.profiles')]),
        inventory([object('public.rides', { rls: false, acl: ['authenticated=rw/postgres'] }), object('public.extra'), object('public.profiles')]),
    );
    assert.equal(report.matched, 1);
    assert.deepEqual(report.changes.find(change => change.key === 'public.rides').fields, ['acl', 'rls']);
    assert.equal(report.changes.find(change => change.key === 'public.quotes').status, 'missing_in_candidate');
    assert.equal(report.changes.find(change => change.key === 'public.extra').status, 'extra_in_candidate');
    assert.equal(report.restorableBaselineVerified, false);
});

test('object ordering and JSON property ordering do not create false differences', () => {
    const report = compareInventories(inventory([object('a', { rls: true, acl: [] }), object('b')]),
        inventory([object('b'), object('a', { acl: [], rls: true })]));
    assert.equal(report.matched, 2);
    assert.deepEqual(report.changes, []);
    assert.equal(report.restorableBaselineVerified, false);
});

test('incompatible scopes, malformed, duplicate and empty inventories fail closed', () => {
    const good = inventory([object('a')]);
    for (const invalid of [inventory([]), inventory([object('a'), object('a')]), { ...good, formatVersion: 2 }, inventory([{ kind: 'relation' }])]) {
        assert.throws(() => compareInventories(good, invalid));
    }
    assert.throws(() => compareInventories(good, { ...good, scope: 'different scope' }), /scopes must match/);
});

test('function body, ownership and grant changes are reported independently', () => {
    const fn = signature => inventory([{ kind: 'function', key: 'public.action()', signature }]);
    const report = compareInventories(fn({ bodyHash: 'old', owner: 'postgres', acl: [] }),
        fn({ bodyHash: 'new', owner: 'authenticated', acl: ['PUBLIC=X/postgres'] }));
    assert.deepEqual(report.changes[0].fields, ['acl', 'bodyHash', 'owner']);
});
