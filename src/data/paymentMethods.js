export const PAYMENT_METHODS = {
  PAGO_MOVIL: {
    id: 'pago_movil',
    label: 'Pago Móvil',
    description: 'Transferencia inmediata desde tu banco',
    icon: 'smartphone',
    requiresReference: true
  },
  EFECTIVO: {
    id: 'efectivo',
    label: 'Efectivo',
    description: 'Pago en efectivo al recibir tu pedido',
    icon: 'banknotes',
    requiresReference: false
  },
  TRANSFERENCIA: {
    id: 'transferencia',
    label: 'Transferencia Bancaria',
    description: 'Transferencia directa a cuenta bancaria',
    icon: 'building-library',
    requiresReference: true
  },
  ZELLE: {
    id: 'zelle',
    label: 'Zelle',
    description: 'Pago en dólares vía Zelle',
    icon: 'currency-dollar',
    requiresReference: true
  },
  DIVISAS: {
    id: 'divisas',
    label: 'Efectivo en Divisas',
    description: 'Pago en dólares o euros en efectivo',
    icon: 'globe-americas',
    requiresReference: false
  }
};

export const VENEZUELAN_BANKS = [
  'Banesco',
  'Mercantil',
  'Provincial',
  'Venezuela',
  'BNC (Banco Nacional de Crédito)',
  'Banco del Tesoro',
  'Bicentenario',
  'Banco Exterior',
  'Banco Plaza',
  'Banco Caroní',
  'Bancamiga',
  'Banplus',
  'Banco Activo',
  'BOD (Banco Occidental de Descuento)',
  'BFC (Banco Fondo Común)',
  'Banco Sofitasa',
  'Mi Banco',
  '100% Banco',
  'Banco Internacional de Desarrollo',
  'Bancrecer'
];
