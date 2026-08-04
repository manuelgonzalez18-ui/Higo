import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeBanescoReference,
    normalizeTransferReference,
} from '../src/utils/paymentReference.js';

test('Banesco reference keeps only the last six digits', () => {
    assert.equal(normalizeBanescoReference('000012345678'), '345678');
    assert.equal(normalizeBanescoReference('Ref: 22-9907'), '229907');
    assert.equal(normalizeBanescoReference('1234'), '1234');
});

test('transfer reference keeps the first twelve numeric digits', () => {
    assert.equal(normalizeTransferReference('1234-5678-9012-3456'), '123456789012');
});
