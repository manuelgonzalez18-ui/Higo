# Reviewed staging baseline

This is the application schema captured from Higo Project on 20 September 2026,
before the two launch migrations. It was restored to Higo Staging on PostgreSQL
17.6. The catalog comparison matched 1,561 objects, with only two intentionally
excluded outbound notification triggers. `source-comparison.json` records this
comparison; its conservative `restorableBaselineVerified: false` field reflects
the comparator's scope, not a failed SQL restoration.

The SQL contains no application rows, user credentials, files, Cron jobs or
production endpoints. Seven Storage bucket configurations and ten Realtime table
memberships are included. Supabase owns its managed schemas, roles and default
privileges. Configure Auth, external services, secrets and scheduled jobs separately.
Materialized views are created without data and need an explicit refresh.

The artifact preserves source function bodies byte-for-byte, including their line
endings. Verify its SHA-256 against `manifest.json` before use. Do not run a formatter
on it. Raw catalog captures may contain webhook credentials; never commit them.
`scripts/build-schema-baseline.mjs` builds this reviewed artifact from private catalog
captures, rejects unsupported structures and excludes outbound trigger definitions.
It is a Higo-specific reconstruction tool, not a general replacement for `pg_dump`.

## Restore order

Use a fresh Supabase PostgreSQL 17 database. The baseline refuses to run if public
application relations already exist and restores inside one transaction.

1. Apply `staging-baseline.sql` with `psql -v ON_ERROR_STOP=1`.
2. Apply `../../migrations/20260917001153_launch_ride_integrity.sql`.
3. Apply `../../migrations/20260917001201_authoritative_route_quotes.sql`.
4. Configure synthetic business settings and run role/behavior tests. The CI job
   uses `supabase/tests/reconciled_configuration.sql` only on its disposable target.
5. Configure and validate isolated services before any client cutover.

Do not replay the 39 historical migrations over this baseline. Do not place this
artifact in `supabase/migrations`, repair production history automatically, or call
`higo_finalize_launch()` on a shared environment before consumers and tests are ready.
CI invokes the cutover inside a transaction that is rolled back with its fixtures.
