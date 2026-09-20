# Conciliación del esquema y staging

## Entorno creado

Se creó **Higo Staging**, proyecto `oiszcfmuxfihcullioou`, en la organización
ManuDeveloper (`kbahrsyankldrjzgfzyw`), región `us-east-1`. El usuario autorizó
el coste de US$10 al mes informado por el conector. La comprobación posterior
devolvió `ACTIVE_HEALTHY`, PostgreSQL 17.6 y cero relaciones de aplicación en
`public`: el recurso existe, pero aún no tiene el esquema de Higo.

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
por Supabase. El baseline definitivo requiere exportación y restauración independientes.

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

## Exportación pendiente y siguiente paso

La CLI 2.101.0 reconoce la cuenta y vincula el origen. Sin embargo, el pooler de
sesión cierra la conexión del usuario temporal `cli_login_postgres` durante el
protocolo de conexión. La alternativa directa IPv6 tampoco está disponible desde
este entorno. Las consultas de catálogo mediante el conector sí funcionan.

Se prepararon herramientas nativas PostgreSQL 17.11 para exportar el esquema,
pero **no se obtuvo aún un dump completo y restaurable**. No sustituirlo por el
fixture ni copiar datos reales a staging para superar este punto.

1. Obtener una conexión de exportación funcional desde un entorno con acceso a
   la base: pooler de sesión con credencial configurada de forma privada o conexión
   directa IPv6 desde un runner compatible. No escribir contraseñas en Git ni chat.
2. Exportar solo esquema y permisos; revisar por separado cambios personalizados
   de Auth/Storage, extensiones, publicaciones, buckets, webhooks y Cron. Revisar
   literales de funciones para excluir secretos y endpoints de producción.
3. Restaurar en el proyecto de staging vacío con notificaciones y pagos aislados;
   repetir inventario y pruebas por rol. Resolver diferencias, sin `migration repair`
   automático. Configurar datos sintéticos y los parámetros del negocio por separado.
4. Aplicar los cambios de lanzamiento que correspondan, ensayar restauración y
   probar servicios reales de staging antes de habilitar `LAUNCH_DATABASE_READY`.

Referencia del procedimiento de exportación y sus excepciones para Auth/Storage:
[Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
