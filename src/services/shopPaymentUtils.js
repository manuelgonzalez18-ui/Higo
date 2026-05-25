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
 * Generate a random 8-digit reference number for payment tracking.
 * @returns {string} e.g. '48192736'
 */
export function generateReference() {
  const min = 10000000;
  const max = 99999999;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
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
