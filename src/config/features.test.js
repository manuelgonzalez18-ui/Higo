import { describe, expect, it } from 'vitest';
import { readBoolean } from './parseBooleanFlag';

describe('readBoolean', () => {
    it('recognizes enabled values', () => {
        for (const value of ['true', '1', 'yes', 'on', 'enabled']) {
            expect(readBoolean(value, false)).toBe(true);
        }
    });

    it('recognizes disabled values', () => {
        for (const value of ['false', '0', 'no', 'off', 'disabled']) {
            expect(readBoolean(value, true)).toBe(false);
        }
    });

    it('uses the supplied fallback for missing or invalid values', () => {
        expect(readBoolean(undefined, true)).toBe(true);
        expect(readBoolean('', false)).toBe(false);
        expect(readBoolean('unexpected', true)).toBe(true);
    });
});
