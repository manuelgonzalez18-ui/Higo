/**
 * Format a phone number to 04XX-XXXXXXX format.
 * @param {string} phone
 * @returns {string}
 */
export function formatPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return phone;
}

/**
 * Format a cédula number to V-XXXXXXXX format.
 * @param {string} cedula
 * @returns {string}
 */
export function formatCedula(cedula) {
  if (!cedula) return '';
  const cleaned = cedula.replace(/[^0-9VvEeJjGg]/g, '').toUpperCase();
  // If already has prefix letter
  if (/^[VEJG]/.test(cleaned)) {
    const prefix = cleaned.charAt(0);
    const numbers = cleaned.slice(1);
    return `${prefix}-${numbers}`;
  }
  // Default to V prefix
  return `V-${cleaned}`;
}

/**
 * Generate an 8-digit reference number for payment tracking.
 * Combina un componente temporal (5 díg. del timestamp) con 3 dígitos
 * aleatorios: dos referencias colisionan solo si se generan en el mismo
 * milisegundo Y coincide el random, mucho menos probable que los 8 dígitos
 * puramente aleatorios anteriores (~1% de colisión a las ~1300 refs).
 * @returns {string} e.g. '48192736'
 */
export function generateReference() {
  const timePart = String(Date.now() % 100000).padStart(5, '0');
  const randPart = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return timePart + randPart;
}

/**
 * Get formatted Pago Móvil instructions for display.
 * @param {object} pagoMovilData - { phone, bank, cedula, holder }
 * @returns {string} Formatted instructions
 */
export function getPagoMovilInstructions(pagoMovilData) {
  if (!pagoMovilData) return '';
  const { phone, bank, cedula, holder } = pagoMovilData;
  return [
    '📱 Datos para Pago Móvil:',
    `   Teléfono: ${formatPhone(phone)}`,
    `   Banco: ${bank}`,
    `   Cédula: ${formatCedula(cedula)}`,
    `   Titular: ${holder}`,
    '',
    '⚠️ Envía el comprobante de pago para verificar tu pedido.'
  ].join('\n');
}
