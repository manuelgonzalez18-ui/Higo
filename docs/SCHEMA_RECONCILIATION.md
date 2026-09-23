# Conciliación del esquema y staging

## Entorno creado

Se creó **Higo Staging**, proyecto `oiszcfmuxfihcullioou`, en la organización
ManuDeveloper (`kbahrsyankldrjzgfzyw`), región `us-east-1`. El usuario autorizó
el coste de US$10 al mes informado por el conector. La comprobación posterior
devolvió `ACTIVE_HEALTHY`, PostgreSQL 17.6. El 20 de septiembre se restauró el
esquema revisado y se aplicaron las dos migraciones iniciales de lanzamiento.
El 23 se aplicó el endurecimiento de accesos heredados. El corte
`higo_finalize_launch()` sigue sin activarse en el proyecto compartido.

Origen: Higo Project (`yfgomicdcwifgeumqsvv`), PostgreSQL 17.6, activo. No se han
aplicado las migraciones del PR en producción ni reparado su historial.

## Inventario reproducible

`scripts/schema-inventory.sql` consulta únicamente catálogos. Incluye relaciones,
columnas, constraints, índices, funciones propias, secuencias, permisos, RLS y
triggers personalizados de Auth/Storage. Guarda hashes de cuerpos y expresiones;
no extrae filas de usuarios, archivos, contraseñas ni cuerpos de funciones.

CI conserva el inventario del contrato desechable como artefacto identificado
por SHA. Para comparar dos capturas de la misma consulta:

```sh
node scripts/compare-schema-inventory.mjs referencia.json candidato.json informe.json
```

El código de salida es 0 si coincide el ámbito inspeccionado, 2 si hay diferencias
y 1 si el formato es inválido. Rechaza capturas vacías, duplicadas o de distinto
ámbito. **Nunca modifica el historial de migraciones ni certifica un baseline.**

Los hashes son exactos: saltos de línea, formato SQL, orden de opciones y permisos
explícitos frente a implícitos pueden producir diferencias sin un cambio funcional.
Las posiciones de columnas también se conservan. Las diferencias requieren revisión;
no son un recuento de vulnerabilidades. La consulta no cubre datos de configuración,
archivos de Storage, secretos, servicios externos ni todos los objetos administrados
por Supabase. La restauración del baseline se comprueba por separado; la comparación
de catálogos no demuestra por sí sola que los flujos del producto funcionen.

## Resultado observado

Captura inicial del 19 de septiembre de 2026, revisada el día 20. Se compara el
fixture con las **39 migraciones históricas**, antes de las dos nuevas del PR,
contra producción. PostgreSQL local: 17.10; remoto: 17.6.

| Categoría | Objetos |
|---|---:|
| Inventario de producción | 1.563 |
| Inventario histórico del fixture | 808 |
| Coincidentes | 545 |
| Presentes en ambos con diferencias | 250 |
| Solo en producción | 768 |
| Solo en el fixture | 13 |

Entre las diferencias hay 40 relaciones adicionales en producción, 120 políticas
adicionales y cinco columnas del fixture ausentes en producción:
`pricing_config.id`, `promo_codes.updated_at`, `rides.delivery_instructions`,
`rides.updated_at` y `support_threads.updated_at`. Las relaciones incluyen tablas,
vistas y secuencias; no deben interpretarse como 40 tablas ausentes.

De nueve funciones con hash de cuerpo distinto, seis difieren únicamente en saltos
de línea: `admin_set_fair_dispatch_flags`, `admin_set_platform_runtime_flags`,
`higo_public_driver_application_status`, `higo_quote_ride_v4`,
`higo_sync_driver_membership` y `register_membership_payment_v3`.
`admin_business_analytics` y `admin_get_fraud_signals_v2` muestran cambios de formato.
`is_within_coverage` usa la misma comprobación de distancia, con otra presentación
SQL y `search_path=public,extensions` en producción frente a `public` en el fixture.
Esta revisión no certifica todas las dependencias ni los permisos efectivos.

El historial remoto sigue registrando 23 migraciones hasta `20260724110000`.
La existencia de funciones posteriores no basta para marcar el resto como aplicadas:
hay que comprobar sus permisos, triggers y efectos sobre datos de configuración.

## Baseline restaurado y siguiente paso

La CLI 2.101.0 reconoce la cuenta y vincula el origen. Sin embargo, el pooler de
sesión cierra la conexión del usuario temporal `cli_login_postgres` durante el
protocolo de conexión. La alternativa directa IPv6 tampoco está disponible desde
este entorno. Las consultas de catálogo mediante el conector sí funcionan.

Se utilizó una extracción de catálogos mediante el conector y un generador específico
para Higo (`scripts/build-schema-baseline.mjs`). La restauración transaccional en staging
terminó correctamente. El artefacto revisado está en `supabase/baselines/20260920`;
las capturas privadas originales no se incluyen, porque pueden contener configuración
de webhooks. No es un dump completo de todos los componentes administrados por Supabase.

| Resultado antes de las migraciones nuevas | Cantidad |
|---|---:|
| Tablas de aplicación restauradas | 56 |
| Funciones públicas propias | 139 |
| Secuencias / vistas | 23 / 3 |
| Constraints / índices independientes / políticas | 259 / 83 / 146 |
| Objetos idénticos en inventario origen–staging | 1.561 |
| Diferencias deliberadas | 2 triggers de notificaciones excluidos |

Se restauraron las configuraciones de siete buckets y diez membresías de Realtime,
sin archivos ni filas de usuarios. Los triggers excluidos son
`public.ride_offers."higo-send-directed-ride-offer"` y
`public.rides."ride-request-push"`; sus endpoints y credenciales deben configurarse
para staging. No se copiaron tareas Cron, secretos ni parámetros comerciales.

SHA-256 del SQL revisado:
`9d7c8ba7e0e9904a171412cce7092f2a1dbbfbb1d938c7452cf6c9c6e55ee75e`.

El historial de staging registra `higo_reviewed_catalog_baseline`,
`launch_ride_integrity`, `authoritative_route_quotes` y
`reconciled_schema_access_hardening`. Se verificó que el cliente
autenticado no puede ejecutar `higo_store_route_quote`, que `service_role` sí puede
y que `integrity_enforced` permanece desactivado hasta terminar la validación.

La nueva tarea de CI restaura este artefacto sobre Supabase PostgreSQL 17 y aplica
solo las tres migraciones nuevas. Las pruebas usan identidades Auth sintéticas sin
credenciales y revierten su transacción. Sus resultados deben consultarse en el SHA
correspondiente; añadir la tarea no equivale a haberla aprobado.

Las pruebas de acceso a saldos y fraude también pasaron en staging, mediante
`SET LOCAL ROLE` y JWT sintéticos dentro de una transacción revertida. Se verificó
que no quedaron identidades de prueba ni movimientos. Este modo valida RLS y
permisos de las vistas; no sustituye los tests de viajes con login no privilegiado,
porque algunos triggers históricos distinguen `session_user` administrativo.

El advisor dejó de señalar `wallet_balances`, `fraud_signals` y las 14 funciones con
`search_path` sin fijar. Persisten avisos de funciones SECURITY DEFINER ejecutables
(62 por anon y 111 por authenticated); requieren revisión de autorización interna,
no se consideran vulnerabilidades confirmadas solo por disponer de EXECUTE.
Las dos tablas con RLS sin políticas se reservan deliberadamente al backend/owner.

Pendiente: terminar la validación concurrente de la reconstrucción,
configurar PHP/Firebase y parámetros de negocio aislados, revisar los advisors y
ensayar restauración/reversión antes de habilitar `LAUNCH_DATABASE_READY`.

Referencia del procedimiento de exportación y sus excepciones para Auth/Storage:
[Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
