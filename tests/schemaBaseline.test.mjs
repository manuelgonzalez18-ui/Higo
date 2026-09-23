import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseline, quoteIdentifier } from '../scripts/build-schema-baseline.mjs';

function capture() {
    return {
        blueprint: {
            tables: [{ name: 'sample', owner: 'postgres', persistence: 'p', replicaIdentity: 'd', rls: true, forceRls: false,
                columns: [{ name: 'id', type: 'bigint', notNull: true, identity: 'd', generated: '', default: null }] }],
            sequences: [{ name: 'sample_id_seq', owner: 'postgres', type: 'bigint', start: '1', increment: '1', min: '1', max: '9223372036854775807', cache: '1', cycle: false, ownership: { table: 'sample', column: 'id', identity: true } }],
            functions: [], views: [], constraints: [], indexes: [], policies: [], triggers: [],
        },
        access: { grants: [{ kind: 'relation', name: 'sample', grantee: 'authenticated', privilege: 'SELECT', grantable: false }], buckets: [], publications: [] },
    };
}

test('identity export preserves the full bigint range without float conversion', () => {
    const { blueprint, access } = capture();
    const result = buildBaseline(blueprint, access);
    assert.match(result.sql, /MAXVALUE 9223372036854775807/);
    assert.doesNotMatch(result.sql, /create sequence public\."sample_id_seq"/);
    blueprint.sequences[0].max = Number(blueprint.sequences[0].max);
    assert.throws(() => buildBaseline(blueprint, access), /decimal strings/);
});

test('external triggers are excluded without retaining their endpoint or credentials', () => {
    const { blueprint, access } = capture();
    blueprint.triggers.push({ name: 'push', schema: 'public', table: 'sample', definition: "CREATE TRIGGER push AFTER INSERT ON public.sample EXECUTE FUNCTION supabase_functions.http_request('https://production.invalid','POST','private-secret')", enabled: 'O' });
    const result = buildBaseline(blueprint, access);
    assert.equal(result.manifest.excludedTriggers.length, 1);
    assert.doesNotMatch(result.sql, /production\.invalid|private-secret|CREATE TRIGGER push/);
    assert.doesNotMatch(JSON.stringify(result.manifest), /production\.invalid|private-secret/);
});

test('a hidden outbound endpoint inside a function rejects the entire baseline', () => {
    const { blueprint, access } = capture();
    blueprint.functions.push({ name: 'unsafe', owner: 'postgres', definition: "CREATE FUNCTION public.unsafe() RETURNS text LANGUAGE sql AS $$SELECT 'https://production.invalid'::text$$;" });
    assert.throws(() => buildBaseline(blueprint, access), /Outbound endpoint/);
});

test('unsupported structures and filtered publications fail instead of silently widening access', () => {
    const { blueprint, access } = capture();
    access.publications.push({ name: 'supabase_realtime', table: 'sample', columns: ['id'], rowfilter: 'id > 10' });
    assert.throws(() => buildBaseline(blueprint, access), /Custom publication/);
    access.publications = [];
    blueprint.tables[0].columns[0].generated = 's';
    assert.throws(() => buildBaseline(blueprint, access), /Generated columns/);
});

test('object and role names are SQL quoted and rights are reset before grants', () => {
    assert.equal(quoteIdentifier('a"; drop schema public;--'), '"a""; drop schema public;--"');
    const { blueprint, access } = capture();
    access.grants[0].grantee = 'role"name';
    const { sql } = buildBaseline(blueprint, access);
    assert.match(sql, /to "role""name";/);
    assert(sql.indexOf('revoke all privileges') < sql.indexOf('grant SELECT'));
    assert.match(sql, /baseline_target_not_empty/);
});

test('functions returning a view row type are created after that view', () => {
    const { blueprint, access } = capture();
    blueprint.views.push({ name: 'summary', owner: 'postgres', definition: 'SELECT id FROM public.sample;', materialized: false, dependencies: [] });
    blueprint.functions.push({ name: 'list_summary', owner: 'postgres', returnView: 'summary', definition: 'CREATE FUNCTION public.list_summary() RETURNS SETOF public.summary LANGUAGE sql AS $$SELECT * FROM public.summary$$;' });
    const { sql } = buildBaseline(blueprint, access);
    assert(sql.indexOf('create view public."summary"') < sql.indexOf('CREATE FUNCTION public.list_summary'));
    blueprint.views = [];
    assert.throws(() => buildBaseline(blueprint, access), /return-view dependency/);
});
