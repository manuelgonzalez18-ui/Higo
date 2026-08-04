import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Higo Viajes exposes admin route, navigation and operational UI', async () => {
    const [app, nav, page, api] = await Promise.all([
        read('src/App.jsx'),
        read('src/components/AdminNav.jsx'),
        read('src/pages/AdminRidesPage.jsx'),
        read('src/services/adminApi.js'),
    ]);

    assert.match(app, /AdminRidesPage/);
    assert.match(app, /path="\/admin\/rides"/);
    assert.match(nav, /to: '\/admin\/rides'/);
    assert.match(nav, /label: 'Viajes'/);
    assert.match(page, /Higo Viajes/);
    assert.match(page, /Exportar CSV/);
    assert.match(page, /admin-rides-operations/);
    assert.match(page, /Despacho progresivo/);
    assert.match(page, /Override administrativo auditado/);
    assert.match(api, /admin_list_rides/);
    assert.match(api, /admin_get_ride_detail/);
    assert.match(api, /admin_ride_operations_metrics/);
    assert.match(api, /admin_override_ride_status/);
});

test('Higo Viajes migration is permissioned, paginated and auditable', async () => {
    const sql = await read('supabase/migrations/20260804173000_admin_rides_operations.sql');

    for (const required of [
        'admin_list_rides',
        'admin_get_ride_detail',
        'admin_ride_operations_metrics',
        'admin_override_ride_status',
        "higo_assert_admin('manage_operations'",
        "coalesce(r.service_type, 'ride') <> 'delivery'",
        'ride_offers',
        'ride_state_events',
        'admin_audit_log',
        'p_cursor_created_at',
        'transactedVolume',
    ]) {
        assert.ok(sql.includes(required), `missing ${required}`);
    }

    assert.match(sql, /grant execute on function public\.admin_list_rides[\s\S]*to authenticated;/);
    assert.match(sql, /notify pgrst, 'reload schema';/);
});
