// tests/shopMoney.test.js — Tests de la lógica de dinero del Higo Shop.
//
// A diferencia de pricing.test.js (que replica la fórmula), estos tests
// importan el CÓDIGO REAL de src/, así una regresión en el cálculo de la
// tarifa de delivery, el vuelto o el formateo la detecta el CI.

import { describe, it, expect } from 'vitest';
import {
  calculateDeliveryFee,
  calculateChange,
  formatCurrency,
} from '../src/services/shopDeliveryPricing.js';
import {
  formatPhone,
  formatCedula,
  generateReference,
} from '../src/services/shopPaymentUtils.js';
import { DELIVERY_CONFIG } from '../src/utils/shopConstants.js';

describe('calculateDeliveryFee', () => {
  const { baseFee, perKmRate, minFee, maxFee } = DELIVERY_CONFIG;

  it('cobra base + por-km dentro del rango', () => {
    const fee = calculateDeliveryFee(3);
    const expected = Math.min(maxFee, Math.max(minFee, baseFee + 3 * perKmRate));
    expect(fee).toBeCloseTo(expected, 2);
  });

  it('nunca baja del mínimo', () => {
    expect(calculateDeliveryFee(0)).toBeGreaterThanOrEqual(minFee);
  });

  it('nunca supera el máximo', () => {
    expect(calculateDeliveryFee(9999)).toBe(maxFee);
  });

  it('no devuelve NaN con distancia inválida (guard)', () => {
    expect(calculateDeliveryFee(NaN)).toBe(minFee);
    expect(calculateDeliveryFee(undefined)).toBe(minFee);
    expect(calculateDeliveryFee(-5)).toBe(minFee);
  });
});

describe('calculateChange', () => {
  it('devuelve el vuelto correcto cuando el pago alcanza', () => {
    expect(calculateChange(10, 20)).toBe(10);
    expect(calculateChange(3.5, 5)).toBeCloseTo(1.5, 2);
  });

  it('devuelve 0 cuando el cliente paga exacto', () => {
    expect(calculateChange(10, 10)).toBe(0);
  });

  it('devuelve 0 cuando el cliente paga de menos (no negativo)', () => {
    expect(calculateChange(10, 7)).toBe(0);
  });
});

describe('formatCurrency', () => {
  it('formatea con prefijo Bs. y 2 decimales', () => {
    expect(formatCurrency(3.5)).toBe('Bs. 3.50');
  });

  it('maneja valores nulos/NaN', () => {
    expect(formatCurrency(null)).toBe('Bs. 0.00');
    expect(formatCurrency(NaN)).toBe('Bs. 0.00');
  });
});

describe('formatPhone', () => {
  it('formatea 11 dígitos a 04XX-XXXXXXX', () => {
    expect(formatPhone('04121234567')).toBe('0412-1234567');
  });

  it('devuelve el original si no son 11 dígitos', () => {
    expect(formatPhone('123')).toBe('123');
  });

  it('maneja vacío', () => {
    expect(formatPhone('')).toBe('');
  });
});

describe('formatCedula', () => {
  it('agrega prefijo V por defecto', () => {
    expect(formatCedula('12345678')).toBe('V-12345678');
  });

  it('respeta un prefijo existente', () => {
    expect(formatCedula('J-12345678')).toBe('J-12345678');
    expect(formatCedula('E12345678')).toBe('E-12345678');
  });
});

describe('generateReference', () => {
  it('devuelve 8 dígitos numéricos', () => {
    const ref = generateReference();
    expect(ref).toMatch(/^\d{8}$/);
  });

  it('produce referencias distintas en una ráfaga (baja colisión)', () => {
    const refs = new Set();
    for (let i = 0; i < 200; i++) refs.add(generateReference());
    // Con el componente temporal + random, esperamos muy pocas colisiones.
    expect(refs.size).toBeGreaterThan(150);
  });
});
