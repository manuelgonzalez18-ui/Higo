# Higo — Reconciliación del historial de migraciones Supabase

## Por qué es necesaria

Las migraciones administrativas del 23 de julio de 2026 se ejecutaron desde el
SQL Editor. El esquema de producción contiene esos cambios, pero la tabla
`supabase_migrations.schema_migrations` puede no tener sus versiones registradas.

Supabase CLI compara los archivos de `supabase/migrations` con esa tabla. Si el
historial no se repara, un futuro `supabase db push` puede intentar ejecutar de
nuevo SQL que ya existe.

Referencia oficial:
[Database migrations — diagnosing and fixing sync errors](https://supabase.com/docs/guides/deployment/database-migrations#diagnosing-and-fixing-sync-errors).

`migration repair` modifica solamente el historial; no vuelve a ejecutar ni
revierte el SQL.

## Migraciones aplicadas manualmente y verificadas

Antes de marcarlas, confirmar que producción conserva los objetos esperados.

```text
20260723165900  admin_profile_compat
20260723170000  admin_membership_redesign
20260723170100  admin_membership_security_hardening
20260723170200  admin_context_permissions
20260723170300  admin_promo_funding
20260723170400  admin_fraud_batch
20260723170500  admin_zone_archive
```

La migración `20260723170000` debe corresponder a la versión corregida de
`admin_business_analytics()` que quedó guardada en GitHub.

## Verificación SQL previa

Ejecutar en el proyecto remoto:

```sql
select
  to_regclass('public.driver_membership_plans') is not null as membership_plans,
  to_regclass('public.driver_memberships') is not null as memberships,
  to_regclass('public.admin_driver_membership_status') is not null as membership_view,
  to_regclass('public.admin_staff_roles') is not null as staff_roles,
  to_regclass('public.admin_audit_log') is not null as audit_log,
  to_regprocedure('public.admin_get_context()') is not null as admin_context,
  to_regprocedure('public.admin_get_fraud_signals_v2()') is not null as fraud_v2,
  to_regprocedure('public.admin_archive_zone(bigint,text)') is not null as archive_zone,
  to_regprocedure('public.admin_save_promo(bigint,jsonb)') is not null as save_promo,
  to_regprocedure('public.admin_archive_promo(bigint,text)') is not null as archive_promo;
```

Todos los valores deben ser `true`.

## Reparar el historial

Desde un entorno con Supabase CLI autenticado y el repositorio abierto:

```bash
supabase link --project-ref yfgomicdcwifgeumqsvv
supabase migration list

supabase migration repair 20260723165900 --status applied
supabase migration repair 20260723170000 --status applied
supabase migration repair 20260723170100 --status applied
supabase migration repair 20260723170200 --status applied
supabase migration repair 20260723170300 --status applied
supabase migration repair 20260723170400 --status applied
supabase migration repair 20260723170500 --status applied

supabase migration list
```

No ejecutar `supabase db push` hasta que la lista local/remota muestre esas siete
versiones alineadas.

## Comprobación antes de cada push

```bash
supabase migration list
supabase db push --dry-run
```

El `dry-run` debe mostrar únicamente las migraciones realmente pendientes del
nuevo hardening. Si aparecen las siete versiones anteriores, detener el proceso
y revisar la reparación.

## Regla futura

- Staging: aplicar migraciones con Supabase CLI.
- Producción: promover exactamente los mismos archivos y SHA que pasaron staging.
- SQL Editor: reservarlo para diagnósticos o reparaciones explícitas.
- Todo cambio manual permanente debe capturarse luego con `supabase db pull` o
  reconciliarse con `supabase migration repair`, según corresponda.
