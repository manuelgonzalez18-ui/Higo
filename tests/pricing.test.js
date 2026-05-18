// tests/pricing.test.js — Tests del flow de cálculo de precio.
//
// El precio es la única lógica de negocio crítica del lado cliente
// (todo lo demás pasa por RLS/RPC). Regresión acá = pasajero cobrado
// mal = ticket de soporte y refund con wallet_movements.
//
// Replicamos acá la fórmula de RequestRidePage:
//   final = max(base, base + max(0, distKm - 1) * perKm
//                       + stops * stopFee
//                       + (serviceType === 'delivery' ? deliveryFee : 0))
//         * surgeMultiplier

import { describe, it, expect } from 'vitest';

const RATES = {
    moto:     { base: 1.00, perKm: 0.25, deliveryFee: 0.50, stopFee: 0.50 },
    standard: { base: 1.50, perKm: 0.40, deliveryFee: 1.50, stopFee: 1.00 },
    van:      { base: 1.70, perKm: 0.60, deliveryFee: 2.00, stopFee: 1.00 },
};
const INCLUDED_KM = 1;

const calcPrice = ({
    type, distKm = 0, stops = 0, serviceType = 'ride', surge = 1.0,
}) => {
    const r = RATES[type];
    const base = r.base;
    const km = Math.max(0, distKm - INCLUDED_KM) * r.perKm;
    const stopsCost = stops * r.stopFee;
    const svc = serviceType === 'delivery' ? r.deliveryFee : 0;
    let total = base + km + stopsCost + svc;
    if (total < base) total = base;
    return parseFloat((total * surge).toFixed(2));
};

describe('calcPrice', () => {
    it('viaje dentro de 1km cobra solo base', () => {
        expect(calcPrice({ type: 'moto', distKm: 0.5 })).toBe(1.00);
        expect(calcPrice({ type: 'standard', distKm: 0.8 })).toBe(1.50);
    });

    it('viaje de 5km en moto: 1.00 + (4 * 0.25) = 2.00', () => {
        expect(calcPrice({ type: 'moto', distKm: 5 })).toBe(2.00);
    });

    it('viaje de 5km en standard: 1.50 + (4 * 0.40) = 3.10', () => {
        expect(calcPrice({ type: 'standard', distKm: 5 })).toBe(3.10);
    });

    it('paradas suman stopFee por cada una', () => {
        // standard, 5km, 2 paradas → 1.5 + 1.6 + 2.0 = 5.10
        expect(calcPrice({ type: 'standard', distKm: 5, stops: 2 })).toBe(5.10);
    });

    it('servicio delivery suma deliveryFee', () => {
        // moto, 5km, sin paradas, delivery → 1.0 + 1.0 + 0.5 = 2.50
        expect(calcPrice({ type: 'moto', distKm: 5, serviceType: 'delivery' })).toBe(2.50);
    });

    it('surge multiplier multiplica el total final', () => {
        // standard 5km a 1.5x → 3.10 * 1.5 = 4.65
        expect(calcPrice({ type: 'standard', distKm: 5, surge: 1.5 })).toBe(4.65);
    });

    it('precio mínimo NO puede ser menor que base', () => {
        // Aunque distKm < 1 y otros 0, el mínimo es base.
        expect(calcPrice({ type: 'standard', distKm: 0 })).toBe(1.50);
    });

    it('surge bajo 1.0 (descuento) también funciona', () => {
        expect(calcPrice({ type: 'moto', distKm: 5, surge: 0.8 })).toBe(1.60);
    });

    it('camioneta es la más cara', () => {
        const sameTrip = { distKm: 10 };
        const moto = calcPrice({ type: 'moto', ...sameTrip });
        const std  = calcPrice({ type: 'standard', ...sameTrip });
        const van  = calcPrice({ type: 'van', ...sameTrip });
        expect(van).toBeGreaterThan(std);
        expect(std).toBeGreaterThan(moto);
    });
});

// Tip calc — extracted from RideStatusPage's computeTipAmount.
const calcTip = ({ price, pct, custom }) => {
    if (pct === 'custom') {
        const n = Number(custom);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return +(price * (pct / 100)).toFixed(2);
};

describe('calcTip', () => {
    it('0% = 0', () => {
        expect(calcTip({ price: 10, pct: 0 })).toBe(0);
    });
    it('10% de $10 = $1', () => {
        expect(calcTip({ price: 10, pct: 10 })).toBe(1);
    });
    it('15% de $7.50 ≈ $1.13 (redondeo)', () => {
        expect(calcTip({ price: 7.5, pct: 15 })).toBe(1.13);
    });
    it('custom acepta monto numérico', () => {
        expect(calcTip({ price: 10, pct: 'custom', custom: '2.50' })).toBe(2.50);
    });
    it('custom inválido cae a 0', () => {
        expect(calcTip({ price: 10, pct: 'custom', custom: 'abc' })).toBe(0);
        expect(calcTip({ price: 10, pct: 'custom', custom: -5 })).toBe(0);
        expect(calcTip({ price: 10, pct: 'custom', custom: '' })).toBe(0);
    });
});
