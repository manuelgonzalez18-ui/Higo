// Run only against a disposable local database AFTER replaying the migrations.
// DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
// HIGO_DISPOSABLE_DATABASE=1 node scripts/test-db-concurrency.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const route = {
    pickupCoords: { lat: 10.4653, lng: -65.9711 },
    dropoffCoords: { lat: 10.475, lng: -65.98 },
    stops: [],
};

/** connect({user,password}?) must honor login overrides in this isolated DB. */
export async function verifyRideConcurrency(connect) {
    const admin = await connect();
    const blocker = await connect();
    const clients = [];
    const passengers = [randomUUID(), randomUUID(), randomUUID()];
    const drivers = [randomUUID(), randomUUID()];
    const actors = [...passengers, ...drivers];
    let originalDispatch;
    const loginRole = `higo_race_${randomUUID().replaceAll('-', '')}`;
    const loginPassword = randomUUID();
    let loginCreated = false;
    let authUsersCreated = false;

    const actorClient = async (actor, name) => {
        const client = await connect({ user: loginRole, password: loginPassword });
        clients.push(client);
        await client.query("select set_config('application_name',$1,false)", [name]);
        await client.query('set statement_timeout = 12000');
        await client.query('set role authenticated');
        const { rows: identity } = await client.query('select session_user as login, current_user as role, rolsuper, rolbypassrls from pg_roles where rolname=session_user');
        assert.equal(identity[0].login, loginRole, 'actor connection must use its own unprivileged login');
        assert.equal(identity[0].role, 'authenticated');
        assert.equal(identity[0].rolsuper, false);
        assert.equal(identity[0].rolbypassrls, false);
        await client.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
            [actor, JSON.stringify({ sub: actor, role: 'authenticated' })]);
        return client;
    };

    // The owner holds the contested lock until BOTH requests are observed
    // waiting for a lock. This proves overlap instead of relying on timing.
    const race = async (label, identity, lockSql, lockArgs, sql, args) => {
        const names = [0, 1].map(index => `higo-race-${label}-${index}-${randomUUID()}`);
        const peers = await Promise.all(identity.map((actor, index) => actorClient(actor, names[index])));
        await blocker.query('begin');
        await blocker.query(lockSql, lockArgs);
        const pending = peers.map((client, index) => client.query(sql, args[index])
            .then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })));
        try {
            const deadline = Date.now() + 8000;
            let waiting = 0;
            while (Date.now() < deadline) {
                const { rows } = await admin.query(
                    "select count(*)::int as count from pg_stat_activity where application_name=any($1::text[]) and wait_event_type='Lock'",
                    [names],
                );
                waiting = rows[0].count;
                if (waiting === 2) break;
                await delay(30);
            }
            assert.equal(waiting, 2, `${label}: both clients must reach the contested lock`);
            await blocker.query('commit');
            return await Promise.all(pending);
        } finally {
            await blocker.query('rollback');
            await Promise.all(pending);
            await Promise.all(peers.map(client => client.end()));
        }
    };

    const storeQuote = async (passenger) => {
        const { rows } = await admin.query(
            "select public.higo_store_route_quote($1,$2::jsonb,2.5,8,'standard','ride',null) as result",
            [passenger, JSON.stringify(route)],
        );
        return rows[0].result.quoteId;
    };

    try {
        // Both identifiers are generated UUID-derived values, never user input.
        await admin.query(`create role "${loginRole}" login noinherit password '${loginPassword}'`);
        loginCreated = true;
        await admin.query(`grant authenticated to "${loginRole}"`);
        const { rows: flags } = await admin.query('select directed_ride_offers from public.platform_runtime_flags where singleton');
        originalDispatch = flags[0].directed_ride_offers;
        await admin.query('update public.platform_runtime_flags set directed_ride_offers=false where singleton');
        const { rows: authSchema } = await admin.query("select to_regclass('auth.users') is not null as present");
        if (authSchema[0].present) {
            // The restored schema has Auth foreign keys absent from the minimal
            // historical fixture. These identities have no login credentials.
            await admin.query('insert into auth.users(id) select unnest($1::uuid[])', [actors]);
            authUsersCreated = true;
        }
        for (const id of passengers) {
            await admin.query("insert into public.profiles(id,full_name,role,status) values($1,'Concurrency passenger','passenger','offline')", [id]);
        }
        for (const id of drivers) {
            await admin.query(`insert into public.profiles(id,full_name,role,status,vehicle_type,subscription_status,subscription_override_until)
                values($1,'Concurrency driver','driver','online','standard','active',now()+interval '1 hour')`, [id]);
        }
        await admin.query('select public.higo_finalize_launch()');

        const quoteForAccept = await storeQuote(passengers[0]);
        const passenger = await actorClient(passengers[0], `higo-race-setup-${randomUUID()}`);
        const { rows: created } = await passenger.query(
            "select public.create_ride_from_quote($1,$2,'Origin','Destination') as result", [quoteForAccept, randomUUID()],
        );
        await passenger.end();
        const rideId = created[0].result.rideId;
        const accepted = await race('accept', drivers,
            'select id from public.rides where id=$1 for update', [rideId],
            'select public.driver_accept_ride_v2($1) as result', [[rideId], [rideId]]);
        assert.equal(accepted.filter(result => result.status === 'fulfilled').length, 1, 'exactly one driver wins');
        assert.match(accepted.find(result => result.status === 'rejected').reason.message, /ride_unavailable|offer.*unavailable/);
        const { rows: assigned } = await admin.query('select driver_id,status from public.rides where id=$1', [rideId]);
        assert.equal(assigned[0].status, 'accepted');
        assert.equal(assigned[0].driver_id, accepted.find(result => result.status === 'fulfilled').value.rows[0].result.driver_id);
        console.log('PASS concurrent accept: two blocked drivers, exactly one winner');

        const quote = await storeQuote(passengers[1]);
        const requestId = randomUUID();
        const createSql = "select public.create_ride_from_quote($1,$2,'Origin','Destination') as result";
        const createLock = "select pg_advisory_xact_lock(hashtextextended('ride-create:'||$1::text,0))";
        const repeated = await race('idempotency', [passengers[1], passengers[1]], createLock, [passengers[1]],
            createSql, [[quote, requestId], [quote, requestId]]);
        assert(repeated.every(result => result.status === 'fulfilled'), 'both retries must succeed');
        assert.equal(repeated[0].value.rows[0].result.rideId, repeated[1].value.rows[0].result.rideId);
        assert.equal(repeated.filter(result => result.value.rows[0].result.idempotentReplay).length, 1);
        const { rows: count } = await admin.query('select count(*)::int as count from public.rides where user_id=$1', [passengers[1]]);
        assert.equal(count[0].count, 1);
        console.log('PASS concurrent retry: one ride and one idempotent replay');

        const quotes = await Promise.all([storeQuote(passengers[2]), storeQuote(passengers[2])]);
        const distinct = await race('active-ride', [passengers[2], passengers[2]], createLock, [passengers[2]],
            createSql, quotes.map(value => [value, randomUUID()]));
        assert.equal(distinct.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(distinct.find(result => result.status === 'rejected').reason.message, 'active_ride_exists');
        const { rows: consumed } = await admin.query(
            'select count(*)::int as count from public.ride_route_quotes where user_id=$1 and consumed_ride_id is not null', [passengers[2]],
        );
        assert.equal(consumed[0].count, 1);
        console.log('PASS concurrent distinct requests: one active ride and one consumed quote');
    } finally {
        await blocker.query('rollback');
        await Promise.allSettled(clients.map(client => client.end()));
        // IDs are generated by this test. Never remove unrelated records.
        try {
            await admin.query('delete from public.ride_route_quotes where user_id=any($1::uuid[])', [passengers]);
            await admin.query('delete from public.rides where user_id=any($1::uuid[])', [passengers]);
            await admin.query('delete from public.profiles where id=any($1::uuid[])', [actors]);
            if (authUsersCreated) await admin.query('delete from auth.users where id=any($1::uuid[])', [actors]);
            if (originalDispatch !== undefined) {
                await admin.query('update public.platform_runtime_flags set directed_ride_offers=$1 where singleton', [originalDispatch]);
            }
        } finally {
            try {
                if (loginCreated) await admin.query(`drop role "${loginRole}"`);
            } finally {
                await blocker.end();
                await admin.end();
            }
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const connectionString = process.env.DATABASE_URL;
    if (process.env.HIGO_DISPOSABLE_DATABASE !== '1' || !connectionString) {
        throw new Error('Set HIGO_DISPOSABLE_DATABASE=1 and DATABASE_URL for a disposable local database.');
    }
    const target = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(target.protocol)
        || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
        throw new Error('Database concurrency tests are restricted to loopback hosts.');
    }
    const { Client } = await import('pg');
    await verifyRideConcurrency(async (identity = {}) => {
        const loginUrl = new URL(connectionString);
        if (identity.user) {
            loginUrl.username = identity.user;
            loginUrl.password = identity.password;
        }
        const client = new Client({ connectionString: loginUrl.toString(), connectionTimeoutMillis: 5000 });
        await client.connect();
        return client;
    });
}
