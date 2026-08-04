export const normalizeBanescoReference = (value) => String(value ?? '')
    .replace(/\D/g, '')
    .slice(-6);

export const normalizeTransferReference = (value) => String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 12);
