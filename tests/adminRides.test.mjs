import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Higo Viajes exposes a protected admin entry, navigation and operational UI', async () => {
    const [index, entry, guard, nav, page, api] = await Promise.all([
        read('index.html'),
        read('src/adminRidesEntry.jsx'),
        read('src/components/AdminGuard.jsx'),
        read('src/components/AdminNav.jsx'),
        read('src/pages/AdminRidesPage.jsx'),
        read('src/services/adminApi.js'),
    ]);

    assert.match(index, /#\/admin\/rides/);
    assert.match(index, /adminRidesEntry\.jsx/);
    assert.match(entry, /path="\/admin\/rides"/);
    assert.match(entry, /AdminGuard><AdminRidesPage/);
    assert.match(guard, /\['\/admin\/rides', \['manage_operations'\]\]/);
    assert.match(nav, /to: '\/admin\/rides'/);
    assert.match(nav, /label: 'Viajes'/);
    assert.match(nav, /hardReload: true/);
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
