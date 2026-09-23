// Builds a reviewed, data-free staging baseline from PostgreSQL catalog captures.
// It never connects to a database and does not repair production migration history.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

export const quoteIdentifier = value => '"' + String(value).replaceAll('"', '""') + '"';
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const name = value => `public.${quoteIdentifier(value)}`;
const role = value => value === 'PUBLIC' ? 'PUBLIC' : quoteIdentifier(value);
const outbound = /https?:\/\/|http_request|\bnet\.http|\bdblink\b|eyJ[A-Za-z0-9_-]{30,}|sb_secret_/i;
const commands = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' };
const privileges = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'USAGE', 'EXECUTE', 'CREATE']);

function sequenceOptions(sequence) {
    for (const field of ['start', 'increment', 'min', 'max', 'cache']) {
        if (typeof sequence[field] !== 'string' || !/^-?\d+$/.test(sequence[field])) {
            throw new Error('Sequence integers must be exported as decimal strings');
        }
        BigInt(sequence[field]);
    }
    return `START WITH ${sequence.start} INCREMENT BY ${sequence.increment} MINVALUE ${sequence.min} MAXVALUE ${sequence.max} CACHE ${sequence.cache} ${sequence.cycle ? 'CYCLE' : 'NO CYCLE'}`;
}

export function buildBaseline(blueprint, access) {
    for (const field of ['tables', 'sequences', 'functions', 'views', 'constraints', 'indexes', 'policies', 'triggers']) {
        if (!Array.isArray(blueprint[field])) throw new Error(`Missing catalog section: ${field}`);
    }
    if (!blueprint.tables.length || !Array.isArray(access.grants)) throw new Error('Empty baseline or missing grants');
    if ([...blueprint.tables, ...blueprint.sequences, ...blueprint.functions, ...blueprint.views].some(x => x.owner !== 'postgres')) {
        throw new Error('Unexpected object owner; review ownership before restoring');
    }
    if (blueprint.tables.some(t => t.columns.some(c => c.generated) || !['d', 'f'].includes(t.replicaIdentity))) {
        throw new Error('Generated columns or custom replica identity require a reviewed export');
    }
    if (blueprint.indexes.some(i => !i.valid)) throw new Error('Invalid source index requires review');
    const exclusions = blueprint.triggers.filter(t => outbound.test(t.definition));
    const sql = [
        '-- Data-free staging reconstruction. Never run on an existing application database.',
        'begin;',
        "do $$begin if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')) then raise exception 'baseline_target_not_empty'; end if; end$$;",
        'set local search_path = public, extensions;',
        'set local check_function_bodies = false;',
        // These are schema prerequisites only: no Cron job or outbound request is copied.
        'create extension if not exists postgis with schema extensions;',
        'create extension if not exists pg_net with schema extensions;',
        'create extension if not exists pg_cron with schema pg_catalog;',
    ];
    for (const sequence of blueprint.sequences.filter(s => !s.ownership?.identity)) {
        sql.push(`create sequence ${name(sequence.name)} AS ${sequence.type} ${sequenceOptions(sequence)};`);
    }
    for (const table of blueprint.tables) {
        const columns = table.columns.map(column => {
            let definition = `${quoteIdentifier(column.name)} ${column.type}`;
            if (column.collation) definition += ` COLLATE ${column.collation}`;
            if (column.identity) {
                const sequence = blueprint.sequences.find(s => s.ownership?.identity && s.ownership.table === table.name && s.ownership.column === column.name);
                if (!sequence) throw new Error('Missing identity sequence');
                definition += ` GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY (SEQUENCE NAME ${name(sequence.name)} ${sequenceOptions(sequence)})`;
            }
            if (column.notNull) definition += ' NOT NULL';
            return definition;
        });
        sql.push(`create ${table.persistence === 'u' ? 'unlogged ' : ''}table ${name(table.name)} (\n  ${columns.join(',\n  ')}\n);`);
        if (table.options?.length) sql.push(`alter table ${name(table.name)} SET (${table.options.join(', ')});`);
        if (table.replicaIdentity === 'f') sql.push(`alter table ${name(table.name)} replica identity full;`);
    }
    for (const fn of blueprint.functions.filter(f => !f.returnView)) sql.push(fn.definition.replace(/;?\s*$/, ';'));
    for (const table of blueprint.tables) {
        for (const column of table.columns.filter(c => c.default && !c.identity)) {
            sql.push(`alter table ${name(table.name)} alter column ${quoteIdentifier(column.name)} set default ${column.default};`);
        }
    }
    for (const sequence of blueprint.sequences.filter(s => s.ownership && !s.ownership.identity)) {
        sql.push(`alter sequence ${name(sequence.name)} owned by ${name(sequence.ownership.table)}.${quoteIdentifier(sequence.ownership.column)};`);
    }
    // All unique/primary keys must exist before foreign keys referencing them.
    for (const constraint of [...blueprint.constraints.filter(c => c.type !== 'f'), ...blueprint.constraints.filter(c => c.type === 'f')]) {
        sql.push(`alter table ${name(constraint.table)} add constraint ${quoteIdentifier(constraint.name)} ${constraint.definition};`);
    }
    const remaining = [...blueprint.views];
    const created = new Set();
    while (remaining.length) {
        const index = remaining.findIndex(v => (v.dependencies || []).every(d => created.has(d)));
        if (index < 0) throw new Error('Cyclic or missing view dependency');
        const [view] = remaining.splice(index, 1);
        const options = view.options?.length ? ` WITH (${view.options.join(', ')})` : '';
        sql.push(`create ${view.materialized ? 'materialized ' : ''}view ${name(view.name)}${options} as ${view.definition.replace(/;\s*$/, '')}${view.materialized ? ' WITH NO DATA' : ''};`);
        created.add(view.name);
    }
    for (const fn of blueprint.functions.filter(f => f.returnView)) {
        if (!created.has(fn.returnView)) throw new Error('Missing function return-view dependency');
        sql.push(fn.definition.replace(/;?\s*$/, ';'));
    }
    for (const index of blueprint.indexes) sql.push(index.definition + ';');
    for (const policy of blueprint.policies) {
        if (!commands[policy.command] || !['public', 'storage'].includes(policy.schema)) throw new Error('Unsupported policy');
        sql.push(`create policy ${quoteIdentifier(policy.name)} on ${quoteIdentifier(policy.schema)}.${quoteIdentifier(policy.table)} AS ${policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${commands[policy.command]} TO ${policy.roles.map(role).join(', ')}${policy.using ? ` USING (${policy.using})` : ''}${policy.check ? ` WITH CHECK (${policy.check})` : ''};`);
    }
    for (const trigger of blueprint.triggers.filter(t => !exclusions.includes(t))) {
        sql.push(trigger.definition + ';');
        if (trigger.enabled !== 'O') {
            const mode = { D: 'DISABLE', R: 'ENABLE REPLICA', A: 'ENABLE ALWAYS' }[trigger.enabled];
            if (!mode) throw new Error('Unexpected trigger state');
            sql.push(`alter table ${quoteIdentifier(trigger.schema)}.${quoteIdentifier(trigger.table)} ${mode} trigger ${quoteIdentifier(trigger.name)};`);
        }
    }
    for (const table of blueprint.tables) {
        sql.push(`alter table ${name(table.name)} ${table.rls ? 'ENABLE' : 'DISABLE'} row level security;`);
        if (table.forceRls) sql.push(`alter table ${name(table.name)} force row level security;`);
    }
    const grantGroups = new Map();
    for (const grant of access.grants) {
        if (!privileges.has(grant.privilege)) throw new Error('Unsupported privilege');
        let target;
        if (grant.kind === 'relation') target = `${blueprint.sequences.some(s => s.name === grant.name) ? 'SEQUENCE' : 'TABLE'} ${name(grant.name)}`;
        else if (grant.kind === 'function') target = `FUNCTION ${name(grant.name)}(${grant.arguments})`;
        else if (grant.kind === 'schema') target = `SCHEMA ${quoteIdentifier(grant.name)}`;
        else throw new Error('Column grants require a reviewed export');
        const key = JSON.stringify([target, grant.grantee, grant.grantable]);
        if (!grantGroups.has(key)) grantGroups.set(key, { target, grantee: grant.grantee, grantable: grant.grantable, privileges: [] });
        grantGroups.get(key).privileges.push(grant.privilege);
    }
    const resetRoles = [...new Set(['PUBLIC', 'anon', 'authenticated', 'service_role', ...access.grants.map(g => g.grantee)])];
    for (const target of new Set([...grantGroups.values()].map(g => g.target))) {
        sql.push(`revoke all privileges on ${target} from ${resetRoles.map(role).join(', ')};`);
    }
    for (const grant of grantGroups.values()) {
        sql.push(`grant ${grant.privileges.join(', ')} on ${grant.target} to ${role(grant.grantee)}${grant.grantable ? ' WITH GRANT OPTION' : ''};`);
    }
    for (const bucket of access.buckets || []) {
        const mime = bucket.allowedMimeTypes === null ? 'null' : `ARRAY[${bucket.allowedMimeTypes.map(literal).join(',')}]::text[]`;
        if (bucket.fileSizeLimit !== null && !Number.isSafeInteger(bucket.fileSizeLimit)) throw new Error('Unsafe bucket limit');
        sql.push(`insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(${literal(bucket.id)},${literal(bucket.name)},${bucket.public ? 'true' : 'false'},${bucket.fileSizeLimit ?? 'null'},${mime});`);
    }
    for (const publication of access.publications || []) {
        const table = blueprint.tables.find(t => t.name === publication.table);
        if (publication.name !== 'supabase_realtime' || publication.rowfilter || !table
            || [...publication.columns].sort().join('\0') !== table.columns.map(c => c.name).sort().join('\0')) throw new Error('Custom publication requires review');
        sql.push(`alter publication supabase_realtime add table ${name(publication.table)};`);
    }
    sql.push('commit;');
    const result = sql.join('\n\n') + '\n';
    if (outbound.test(result)) throw new Error('Outbound endpoint or potential credential in generated baseline; inspect privately');
    return { sql: result, manifest: {
        formatVersion: 1,
        schemaOnly: true,
        sha256: createHash('sha256').update(result).digest('hex'),
        counts: Object.fromEntries(['tables', 'functions', 'sequences', 'views', 'constraints', 'indexes', 'policies'].map(k => [k, blueprint[k].length])),
        excludedTriggers: exclusions.map(t => ({ schema: t.schema, table: t.table, name: t.name, reason: 'Outbound configuration must be recreated for staging' })),
        limitations: ['Managed Supabase schemas and role defaults remain provider-owned.', 'Cron jobs, secrets, external endpoints, application rows and file bytes are not copied.', 'Catalog equivalence and behavior tests are required before treating this as a reconciled baseline.'],
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [blueprintPath, accessPath, outputDirectory] = process.argv.slice(2);
    if (!blueprintPath || !accessPath || !outputDirectory) throw new Error('Usage: node scripts/build-schema-baseline.mjs blueprint.json access.json output-directory');
    const [blueprint, access] = await Promise.all([blueprintPath, accessPath].map(async file => JSON.parse(await readFile(file, 'utf8'))));
    const result = buildBaseline(blueprint, access);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, 'staging-baseline.sql'), result.sql, { flag: 'wx' });
    await writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(result.manifest, null, 2));
}
