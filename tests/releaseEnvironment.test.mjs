import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment, RELEASE_FLAGS } from '../src/config/releaseProfile.js';
const config = { VITE_APP_ENV: 'test', VITE_API_BASE_URL: 'http://localhost:8080', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'test-key' };
test('test environment accepts only local endpoints', () => {
    assert.equal(validateEnvironment(config), 'test');
    for (const key of ['VITE_API_BASE_URL', 'VITE_SUPABASE_URL']) assert.throws(() => validateEnvironment({ ...config, [key]: 'https://example.com' }), /localhost/);
});
test('missing configuration and staging pointing to production fail closed', () => {
    assert.throws(() => validateEnvironment({}), /Invalid/);
    assert.throws(() => validateEnvironment({ ...config, VITE_APP_ENV: 'staging', VITE_API_BASE_URL: 'https://higoapp.com' }), /production isolation/);
});
test('launch contract cannot disable server state/pricing or enable shop', () => {
    assert.equal(RELEASE_FLAGS.VITE_SHOP_ENABLED, false);
    assert.equal(RELEASE_FLAGS.VITE_SERVER_SIDE_RIDE_PRICING, true);
    assert.equal(RELEASE_FLAGS.VITE_SERVER_SIDE_RIDE_STATE, true);
    assert.equal(RELEASE_FLAGS.VITE_UNIFIED_MEMBERSHIP_CHECKOUT, true);
});
