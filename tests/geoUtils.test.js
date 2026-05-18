// tests/geoUtils.test.js — Haversine + bearing regression tests.
//
// El cálculo de distancia se usa en:
//   - RequestRidePage para calcular precio.
//   - DriverDashboard para detectar "movimiento real" antes de
//     persistir GPS.
//   - InteractiveMap para el indicador "hace X metros".
//   - get_nearby_rides RPC (lado DB usa el mismo algoritmo).
//
// Cualquier regresión acá impacta el precio que paga el pasajero o
// el matching driver/ride. Ergo: baseline de tests.

import { describe, it, expect } from 'vitest';
import {
    toRad,
    toDeg,
    calculateBearing,
    getDistanceFromLatLonInKm,
} from '../src/utils/geoUtils.js';

describe('toRad / toDeg', () => {
    it('roundtrips 0', () => {
        expect(toDeg(toRad(0))).toBe(0);
    });
    it('toRad(180) ≈ π', () => {
        expect(toRad(180)).toBeCloseTo(Math.PI, 10);
    });
    it('toDeg(π) ≈ 180', () => {
        expect(toDeg(Math.PI)).toBeCloseTo(180, 10);
    });
    it('roundtrips arbitrary value', () => {
        const v = 47.3;
        expect(toDeg(toRad(v))).toBeCloseTo(v, 10);
    });
});

describe('getDistanceFromLatLonInKm', () => {
    it('returns 0 for the same point', () => {
        expect(getDistanceFromLatLonInKm(10.5, -66.1, 10.5, -66.1)).toBe(0);
    });

    it('1° lat ≈ 111 km', () => {
        // Aproximación: 1 grado de latitud ≈ 111.13 km en el ecuador.
        const d = getDistanceFromLatLonInKm(0, 0, 1, 0);
        expect(d).toBeGreaterThan(110);
        expect(d).toBeLessThan(112);
    });

    it('Higuerote → Caracas ≈ 90 km', () => {
        // Higuerote (10.4862, -66.0944) → Caracas centro (10.5061, -66.9146).
        // Vuelo de pájaro ≈ 90 km (verificable en Google Maps medir).
        const d = getDistanceFromLatLonInKm(10.4862, -66.0944, 10.5061, -66.9146);
        expect(d).toBeGreaterThan(88);
        expect(d).toBeLessThan(92);
    });

    it('is symmetric (A→B === B→A)', () => {
        const a = getDistanceFromLatLonInKm(10.4862, -66.0944, 10.5061, -66.9146);
        const b = getDistanceFromLatLonInKm(10.5061, -66.9146, 10.4862, -66.0944);
        expect(a).toBeCloseTo(b, 10);
    });

    it('antipodal points ≈ 20015 km (medio mundo)', () => {
        const d = getDistanceFromLatLonInKm(0, 0, 0, 180);
        expect(d).toBeGreaterThan(20010);
        expect(d).toBeLessThan(20020);
    });
});

describe('calculateBearing', () => {
    it('returns ~0° going north', () => {
        // Punto A → punto B al norte (mismo lng, mayor lat).
        const b = calculateBearing(10.0, -66.0, 11.0, -66.0);
        expect(b).toBeCloseTo(0, 1);
    });

    it('returns ~90° going east', () => {
        const b = calculateBearing(10.0, -66.0, 10.0, -65.0);
        expect(b).toBeCloseTo(90, 1);
    });

    it('returns ~180° going south', () => {
        const b = calculateBearing(10.0, -66.0, 9.0, -66.0);
        expect(b).toBeCloseTo(180, 1);
    });

    it('returns ~270° going west', () => {
        const b = calculateBearing(10.0, -66.0, 10.0, -67.0);
        expect(b).toBeCloseTo(270, 1);
    });

    it('normalizes to 0-360 range', () => {
        // Cualquier dirección debe estar en [0, 360).
        const dirs = [
            calculateBearing(0, 0, 1, 1),
            calculateBearing(0, 0, -1, 1),
            calculateBearing(0, 0, -1, -1),
            calculateBearing(0, 0, 1, -1),
        ];
        for (const b of dirs) {
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThan(360);
        }
    });
});
