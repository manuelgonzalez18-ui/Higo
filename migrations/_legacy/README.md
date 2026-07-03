# migrations/_legacy — NO EJECUTAR

Estos archivos son **scaffolding histórico** del schema inicial de Higo. Se
conservan solo como referencia. **No deben ejecutarse en Supabase.**

## Por qué no ejecutarlos

`setup_complete.sql` (y los `.sql` de root movidos aquí) recrean políticas de
RLS con nombres idénticos a las de producción pero con definiciones **laxas**:

- `profiles` con `SELECT USING (true)` → expone PII de todos los usuarios
  (teléfono, `fcm_token`, ubicación, placa) — revierte la migración 34.
- `profiles UPDATE ... USING (auth.uid()=id)` **sin `WITH CHECK`** → reabre la
  escalada de privilegios `update profiles set role='admin'` — revierte la
  migración 72.
- `rides UPDATE ... USING (is_driver)` sin restricción de fila → reabre el robo
  y edición de rides ajenos — revierte la migración 73.
- `rides INSERT WITH CHECK (true)` → permite insertar rides con `user_id`/
  `driver_id`/`price` arbitrarios.

Ejecutar cualquiera de estos sobre una base ya migrada **reabre
vulnerabilidades críticas de golpe**.

## Fuente de verdad

El estado real de la base se define por las **migraciones numeradas** en
`migrations/` (01 → NN), aplicadas en orden. Para levantar una base nueva,
aplicá esas migraciones en secuencia, no estos archivos.

## Contenido

| Archivo | Era |
|---|---|
| `setup_complete.sql` | Script "global" inicial (profiles, rides, deliveries) |
| `supabase_schema.sql` | Schema base de rides con `INSERT WITH CHECK (true)` |
| `migration.sql` | Fragmento suelto |
| `migration_delivery.sql` | Fragmento de delivery |
