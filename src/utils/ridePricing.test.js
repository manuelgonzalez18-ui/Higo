import { describe, expect, it } from 'vitest';
import {
    canonicalVehicleType,
    computeFallbackQuote,
    computeWaitFee,
    haversineKm,
    safeRouteDistanceKm,
} from './ridePricing';

describe('canonicalVehicleType', () => {
    it('normalizes known vehicle aliases', () => {
        expect(canonicalVehicleType('Moto')).toBe('moto');
        expect(canonicalVehicleType('camioneta')).toBe('van');
        expect(canonicalVehicleType('carro')).toBe('standard');
    });

    it('falls back to standard for unknown values', () => {
        expect(canonicalVehicleType('Corolla')).toBe('standard');
        expect(canonicalVehicleType(null)).toBe('standard');
    });
});

describe('distance hardening', () => {
    const origin = { lat: 10.482, lng: -66.102 };
    const destination = { lat: 10.474, lng: -66.094 };

    it('never accepts a client route shorter than haversine', () => {
        const minimum = haversineKm(origin, destination);
        const distance = safeRouteDistanceKm({ origin, destination, routeDistanceKm: 0.01 });
        expect(distance).toBeGreaterThanOrEqual(minimum);
    });

    it('caps an implausibly inflated route distance', () => {
        const minimum = haversineKm(origin, destination);
        const distance = safeRouteDistanceKm({ origin, destination, routeDistanceKm: 999 });
        expect(distance).toBeLessThanOrEqual(Math.max(minimum * 4, minimum + 5));
    });
});

describe('computeFallbackQuote', () => {
    const origin = { lat: 10.482, lng: -66.102 };
    const destination = { lat: 10.474, lng: -66.094 };

    it('adds delivery and stop fees deterministically', () => {
        const ride = computeFallbackQuote({ origin, destination, vehicleType: 'moto', serviceType: 'ride' });
        const delivery = computeFallbackQuote({
            origin,
            destination,
            vehicleType: 'moto',
            serviceType: 'delivery',
            stopsCount: 2,
        });
        expect(delivery.subtotal).toBeGreaterThan(ride.subtotal);
        expect(delivery.stopsCount).toBe(2);
    });

    it('bounds surge and stops', () => {
        const quote = computeFallbackQuote({
            origin,
            destination,
            vehicleType: 'standard',
            stopsCount: 100,
            surgeMultiplier: 100,
        });
        expect(quote.stopsCount).toBe(5);
        expect(quote.surgeMultiplier).toBe(5);
    });
});

describe('computeWaitFee', () => {
    it('keeps the first three minutes free', () => {
        expect(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 180 })).toBe(0);
    });

    it('charges only the billable minutes', () => {
        expect(computeWaitFee({ vehicleType: 'standard', elapsedSeconds: 480 })).toBe(0.4);
    });
});
