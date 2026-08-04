import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEffectiveRideMultiplier } from '../src/utils/pricingPresentation.js';

test('uses a snapshot multiplier when the denormalized column is stale', () => {
    assert.deepEqual(
        resolveEffectiveRideMultiplier({
            pricing: { multiplier: 1, multiplierReason: 'tarifa_normal' },
            snapshot: { surgeMultiplier: 1.3, multiplierReason: 'regla_zona_horario' },
        }),
        { value: 1.3, reason: 'regla_zona_horario', source: 'snapshot' },
    );
});

test('recovers the effective multiplier from the charged subtotal', () => {
    assert.deepEqual(
        resolveEffectiveRideMultiplier({
            pricing: {
                multiplier: 1,
                multiplierReason: 'tarifa_normal',
                baseAmount: 1.5,
                distanceAmount: 4.7,
                timeAmount: 0,
                stopsAmount: 0,
                extrasAmount: 0,
                minimumFare: 1.5,
            },
            snapshot: {
                surgeMultiplier: 1,
                chargedSubtotal: 8.06,
                maximumMultiplier: 1.3,
            },
        }),
        { value: 1.3, reason: 'regla_zona_horario', source: 'inferred' },
    );
});

test('does not infer surge when the minimum fare drives the total', () => {
    assert.deepEqual(
        resolveEffectiveRideMultiplier({
            pricing: { multiplier: 1, baseAmount: 1, minimumFare: 2 },
            snapshot: { chargedSubtotal: 2, maximumMultiplier: 1.3 },
        }),
        { value: 1, reason: 'tarifa_normal', source: 'snapshot' },
    );
});
