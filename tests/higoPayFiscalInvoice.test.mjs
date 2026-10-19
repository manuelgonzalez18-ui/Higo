import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('monthly catalog prices use $15 for moto and $25 for car/van, without repricing weekly', async () => {
    const sql = await read('supabase/migrations/20261018223000_membership_pricing_fiscal_invoice_queue.sql');
    assert.match(sql, /when 'moto-monthly' then 15/);
    assert.match(sql, /when 'car-monthly' then 25/);
    assert.match(sql, /when 'van-monthly' then 25/);
    assert.match(sql, /when 'moto' then 15 when 'standard' then 25 when 'van' then 25/);
    assert.match(sql, /amount_bs = null/);
    assert.doesNotMatch(sql, /update public\.driver_memberships\s/i);
    assert.doesNotMatch(sql, /when 'moto-weekly' then/);
});

test('fiscal invoice is queued only from a validated membership payment', async () => {
    const sql = await read('supabase/migrations/20261018223000_membership_pricing_fiscal_invoice_queue.sql');
    assert.match(sql, /new\.status <> 'validated'/);
    assert.match(sql, /new\.membership_id is null/);
    assert.match(sql, /new\.amount_real <= 0/);
    assert.match(sql, /on conflict \(payment_report_id\) do nothing/);
    assert.match(sql, /payment_report_id bigint not null unique/);
    assert.match(sql, /membership_id bigint not null unique/);
    assert.match(sql, /status in \('pending','rejected'\)/);
    assert.match(sql, /driver_id = \(select auth\.uid\(\)\)/);
    assert.match(sql, /revoke all on public\.membership_fiscal_invoices from anon, authenticated/);
    assert.match(sql, /storage\.foldername\(name\)/);
});

test('fiscal UI remains disabled until database rollout and issuer setup', async () => {
    const flags = await read('src/config/features.js');
    const page = await read('src/pages/HigoPayPage.jsx');
    const billing = await read('src/components/driver/DriverFiscalBillingPanel.jsx');
    assert.match(flags, /VITE_FISCAL_INVOICES_ENABLED, false/);
    assert.match(page, /FEATURES\.fiscalInvoices && user\?\.id/);
    assert.match(billing, /driver_billing_profiles/);
    assert.match(billing, /membership_fiscal_invoices/);
    assert.match(billing, /from\('membership-invoices'\)\.createSignedUrl/);
    assert.doesNotMatch(billing, /service_role|secret_key|PRIVATE_KEY/);
});
