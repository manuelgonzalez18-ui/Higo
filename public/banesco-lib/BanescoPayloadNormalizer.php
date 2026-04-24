<?php
/**
 * BanescoPayloadNormalizer — mapea la variedad de shapes que Banesco
 * devuelve en /financial-account/transactions a un shape interno común.
 *
 * Banesco entrega formatos distintos según el canal:
 *   - Pago móvil Banesco → Banesco
 *   - Pago móvil otros bancos → Banesco
 *   - Transferencia Banesco → Banesco
 *   - Transferencia otros bancos → Banesco
 *
 * Sin acceso previo al API real, inferimos el canal por campos
 * distintivos y toleramos múltiples aliases por campo. El shape real
 * de cada canal se confirmará con los primeros logs de producción.
 *
 * Shape de salida (array asociativo):
 *   [
 *     'payer_phone' => '04141234567'|null,
 *     'payer_bank'  => 'string'|null,
 *     'payer_id'    => 'V12345678'|null,
 *     'amount_bs'   => float,
 *     'currency'    => 'VES',
 *     'reference'   => string,
 *     'paid_at'     => ISO8601,
 *     'channel'     => 'pago_movil_same_bank'|'pago_movil_other_bank'|
 *                      'transfer_same_bank'|'transfer_other_bank'|'unknown',
 *     'raw'         => (array original),
 *   ]
 *
 * Si falta un campo esencial (reference, amount, paid_at) devuelve null.
 */

final class BanescoPayloadNormalizer
{
    /** @return array|null */
    public static function normalize(array $tx): ?array
    {
        $reference = self::firstOf($tx, ['reference', 'referencia', 'operationId', 'transactionId', 'id', 'numeroOperacion']);
        $amountRaw = self::firstOf($tx, ['amount', 'monto', 'montoBs', 'value', 'importe']);
        $paidAtRaw = self::firstOf($tx, ['paidAt', 'date', 'fecha', 'transactionDate', 'timestamp', 'operationDate']);

        if ($reference === null || $amountRaw === null || $paidAtRaw === null) {
            return null;
        }

        return [
            'payer_phone' => self::normalizePhone(self::firstOf($tx, [
                'payerPhone', 'phone', 'telefono', 'originPhone', 'celular', 'msisdn',
            ])),
            'payer_bank'  => self::firstOf($tx, [
                'payerBank', 'bankCode', 'originBank', 'bancoOrigen', 'bank', 'banco',
            ]),
            'payer_id'    => self::firstOf($tx, [
                'payerId', 'cedula', 'cedulaRif', 'identification', 'documento', 'documentId',
            ]),
            'amount_bs'   => self::toFloat($amountRaw),
            'currency'    => self::firstOf($tx, ['currency', 'moneda']) ?? 'VES',
            'reference'   => (string) $reference,
            'paid_at'     => self::toIso8601($paidAtRaw),
            'channel'     => self::detectChannel($tx),
            'raw'         => $tx,
        ];
    }

    /**
     * Normaliza un número venezolano a "04XXXXXXXXX". Retorna null si
     * no se puede interpretar.
     */
    public static function normalizePhone(?string $raw): ?string
    {
        if ($raw === null) return null;
        $digits = preg_replace('/\D+/', '', $raw);
        if (!$digits) return null;

        // quitar 0058 o 58 prefix
        if (str_starts_with($digits, '0058')) {
            $digits = substr($digits, 4);
        } elseif (str_starts_with($digits, '58') && strlen($digits) >= 12) {
            $digits = substr($digits, 2);
        }

        if (strlen($digits) === 10 && $digits[0] === '4') {
            $digits = '0' . $digits;
        }

        if (strlen($digits) !== 11 || !str_starts_with($digits, '04')) {
            return null;
        }
        return $digits;
    }

    private static function firstOf(array $tx, array $keys): ?string
    {
        foreach ($keys as $k) {
            if (isset($tx[$k]) && $tx[$k] !== '' && $tx[$k] !== null) {
                return (string) $tx[$k];
            }
        }
        return null;
    }

    private static function toFloat($v): float
    {
        if (is_float($v) || is_int($v)) return (float) $v;
        $s = str_replace([',', ' '], ['.', ''], (string) $v);
        return (float) $s;
    }

    private static function toIso8601($v): string
    {
        if (is_numeric($v)) {
            // timestamp epoch (s o ms)
            $ts = (int) $v;
            if ($ts > 10_000_000_000) $ts = intdiv($ts, 1000);
            return gmdate('c', $ts);
        }
        $ts = strtotime((string) $v);
        if ($ts === false) {
            return gmdate('c');
        }
        return gmdate('c', $ts);
    }

    /**
     * Heurística: si el banco origen es Banesco (código 0134 o nombre),
     * es same_bank. Si hay campo de teléfono del pagador, es pago móvil.
     * Sino, es transferencia.
     */
    private static function detectChannel(array $tx): string
    {
        $hasPhone = self::firstOf($tx, ['payerPhone', 'phone', 'telefono', 'celular', 'msisdn']) !== null;
        $bank = strtolower((string) (self::firstOf($tx, ['payerBank', 'bankCode', 'originBank', 'bancoOrigen', 'bank', 'banco']) ?? ''));
        $typeHint = strtolower((string) (self::firstOf($tx, ['type', 'tipo', 'operationType', 'tipoOperacion']) ?? ''));

        $isSameBank = str_contains($bank, 'banesco') || str_contains($bank, '0134');
        $isPagoMovil = $hasPhone || str_contains($typeHint, 'movil') || str_contains($typeHint, 'mobile') || str_contains($typeHint, 'p2p');

        if ($isPagoMovil && $isSameBank) return 'pago_movil_same_bank';
        if ($isPagoMovil && !$isSameBank) return 'pago_movil_other_bank';
        if (!$isPagoMovil && $isSameBank) return 'transfer_same_bank';
        if (!$isPagoMovil && !$isSameBank) return 'transfer_other_bank';
        return 'unknown';
    }
}
