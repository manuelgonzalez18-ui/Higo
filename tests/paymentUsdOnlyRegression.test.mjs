import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pago Móvil keeps the trip fare in USD and defers the Bs equivalent', async () => {
    const modal = await read('src/components/driver/PaymentReceiptModal.jsx');

    assert.match(modal, /const BOLIVAR_PAYMENT_NOTE = 'El equivalente en bolívares se determina al momento del pago\.'/);
    assert.match(modal, /activeRide\?\.payment_method === 'pago_movil'/);
    assert.match(modal, /\$\{priceUsd\.toFixed\(2\)\}/);
    assert.doesNotMatch(modal, /getOfficialBcvRate/);
    assert.doesNotMatch(modal, /priceBs/);
    assert.doesNotMatch(modal, /Tasa oficial BCV/);
    assert.doesNotMatch(modal, /Calculando tasa BCV/);
});

test('release is Higo 1.5.28 build 60', async () => {
    const gradle = await read('android/app/build.gradle');
    assert.match(gradle, /versionCode 60/);
    assert.match(gradle, /versionName "1\.5\.28"/);
});
