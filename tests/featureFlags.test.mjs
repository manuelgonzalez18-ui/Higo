import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoolean } from '../src/config/parseBooleanFlag.js';

test('readBoolean recognizes enabled values', () => {
    for (const value of ['true', '1', 'yes', 'on', 'enabled']) {
        assert.equal(readBoolean(value, false), true);
    }
});

test('readBoolean recognizes disabled values', () => {
    for (const value of ['false', '0', 'no', 'off', 'disabled']) {
        assert.equal(readBoolean(value, true), false);
    }
});

test('readBoolean uses the supplied fallback', () => {
    assert.equal(readBoolean(undefined, true), true);
    assert.equal(readBoolean('', false), false);
    assert.equal(readBoolean('unexpected', true), true);
});
