# Migración de Supabase a São Paulo (sa-east-1)

> **Objetivo:** mover el proyecto Supabase de **Oregon (us-west-2)** a **São Paulo
> (sa-east-1)**, mucho más cerca de Venezuela y con mejor ruteo. Esto elimina la
> causa raíz del login intermitente ("La conexión está lenta o inestable"): la
> ruta a Oregon se cuelga desde varias redes/ISP venezolanos, mientras que São
> Paulo responde de forma consistente. También mejora el realtime (viajes en vivo).
>
> **Regla de oro:** NO borres el proyecto viejo hasta que el nuevo esté 100 %
> verificado y con adopción de APK. El viejo es tu red de seguridad / rollback.

Fecha de redacción: 2026-07-23 · Proyecto viejo ref: `yfgomicdcwifgeumqsvv` (us-west-2)

---

## 0. El riesgo crítico del corte (leer primero)

La URL de Supabase (`https://yfgomicdcwifgeumqsvv.supabase.co`) está **compilada
dentro del bundle** — tanto en la web como en **cada APK ya instalado**. Cuando
el proyecto nuevo (São Paulo) tenga otra URL:

- La **web** se arregla con un deploy (cambia al instante para todos).
- Los **APK ya instalados** siguen apuntando al proyecto viejo hasta que el
  usuario **actualice la app** desde Play Store. No se puede redirigir un APK
  viejo (no controlamos el DNS de `supabase.co`).

**Consecuencia:** durante la ventana de adopción del APK nuevo conviven usuarios
en el proyecto viejo y en el nuevo → riesgo de datos partidos ("split-brain").

### Estrategia de corte recomendada (minimiza daño)

1. **Preparar todo el proyecto nuevo y verificarlo** (pasos 1–6) SIN cambiar
   todavía a producción. El viejo sigue siendo el que usa la app.
2. **Ventana de mantenimiento corta** (avisar a usuarios, elegir horario de bajo
   tráfico). Durante la ventana:
   - Congelar escrituras en el viejo (o simplemente asumir la ventana como corte).
   - **Dump final** del viejo → restore al nuevo (para traer lo último).
3. **Cutover:**
   - Deploy web apuntando al nuevo (paso 7–9). La web queda migrada al instante.
   - Publicar **APK 1.3.16** apuntando al nuevo en Play Store.
   - Actualizar los **backends PHP** en Hostinger (paso 8) — estos son
     server-side y migran al instante para todos.
4. **Mantener el proyecto viejo encendido** como respaldo durante la ventana de
   adopción del APK (p. ej. 15–30 días). Opcional: dejar en el viejo un
   mecanismo de "actualizá la app". Los usuarios que no actualicen seguirán
   operando contra el viejo hasta que lo hagan.
5. **Recién cuando la adopción del APK nuevo sea alta**, apagar/borrar el viejo.

> Si tu base de usuarios es todavía chica, el impacto del split-brain es menor y
> podés hacer un corte más agresivo. Igual: **no borres el viejo** hasta confirmar.

---

## 1. Pre-requisitos

- Una terminal con **PostgreSQL client tools v15+** (`pg_dump`, `psql`) y/o la
  **Supabase CLI** (`npm i -g supabase` o binario oficial).
- Los **connection strings** de ambos proyectos (Dashboard → Project Settings →
  Database → Connection string → **URI**). Anotá:
  - `SRC_DB_URL` = connection string del proyecto **viejo** (Oregon).
  - `DST_DB_URL` = connection string del proyecto **nuevo** (São Paulo).
  - Usá la variante **"Session pooler"** o **directa** (puerto 5432/6543 según
    Supabase indique). Contiene la contraseña de la DB.
- Los datos del proyecto **nuevo** (los tendrás tras el paso 1):
  - `NEW_URL` = `https://<NUEVO_REF>.supabase.co`
  - `NEW_ANON_KEY` (Settings → API → anon/public)
  - `NEW_SERVICE_ROLE_KEY` (Settings → API → service_role)

---

## 2. Paso 1 — Crear el proyecto nuevo en São Paulo

1. Dashboard de Supabase → **New project**.
2. Organización: la misma (Pro).
3. **Region: South America (São Paulo) — sa-east-1.**
4. Poné una contraseña de DB fuerte y **guardala** (la vas a necesitar para el
   connection string).
5. Esperá a que provisione. Anotá `NEW_URL`, `NEW_ANON_KEY`, `NEW_SERVICE_ROLE_KEY`.

> Mismo plan Pro. El costo es de otro proyecto Pro mientras convivan; cuando
> apagues el viejo, volvés a un solo Pro.

---

## 3. Paso 2 — Migrar la base de datos (schema + datos + usuarios de auth)

Esto trae **todo**: tablas, RLS, funciones/RPC, y **los usuarios de auth con sus
contraseñas** (se migran los hashes bcrypt → los usuarios NO tienen que resetear
la clave).

### Opción A — Supabase CLI (recomendada, es la que ellos mantienen)

```bash
# 1) Roles (para que los grants de RLS calcen)
supabase db dump --db-url "$SRC_DB_URL" -f roles.sql --role-only

# 2) Esquema completo (tablas, RLS, funciones, triggers)
supabase db dump --db-url "$SRC_DB_URL" -f schema.sql

# 3) Datos (incluye public + auth.users, etc.)
supabase db dump --db-url "$SRC_DB_URL" -f data.sql --data-only --use-copy

# 4) Restaurar en São Paulo, en una sola transacción y parando ante el 1er error
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$DST_DB_URL"
```

> `SET session_replication_role = replica` desactiva triggers/FK durante la carga
> de datos para que el orden de inserción no rompa. La CLI de Supabase ya sabe
> incluir el esquema `auth` en el dump; si tu versión no lo hace, usá la Opción B.

### Opción B — pg_dump/psql manual (si no usás la CLI)

```bash
# Dump del esquema public + datos de public/auth/storage
pg_dump "$SRC_DB_URL" \
  --schema=public \
  --no-owner --no-privileges \
  --file=public_schema_data.sql

# Solo DATOS de auth y storage (el esquema ya existe en el proyecto nuevo)
pg_dump "$SRC_DB_URL" \
  --schema=auth --schema=storage \
  --data-only --no-owner --no-privileges \
  --column-inserts \
  --file=auth_storage_data.sql

# Restaurar
psql --variable ON_ERROR_STOP=1 --dbname "$DST_DB_URL" \
  --command 'SET session_replication_role = replica' \
  --file public_schema_data.sql \
  --file auth_storage_data.sql
```

### Verificación de la carga

```sql
-- Correr en el SQL Editor del proyecto NUEVO
select count(*) as usuarios from auth.users;
select count(*) as perfiles from public.profiles;
select count(*) as viajes  from public.rides;
select count(*) as pedidos from public.orders;
-- Comparar con los mismos counts en el proyecto viejo.
```

> Si algún count no calza, revisá el log del `psql` (algún objeto que ya existía
> en el nuevo pudo chocar). No sigas al corte hasta que calcen.

---

## 4. Paso 3 — Migrar Storage (buckets + policies + archivos)

Buckets en uso por Higo: **`driver-docs`, `payment-receipts`, `delivery-pods`,
`support-attachments`** (y `driver_documents` si aplica).

1. En el proyecto **nuevo** → Storage → crear los **mismos buckets** con la misma
   visibilidad (público/privado) que en el viejo.
2. Recrear las **policies** de cada bucket (Storage → Policies). Si están
   definidas por migración SQL sobre `storage.objects`, ya viajaron en el paso 3;
   si las creaste a mano en el dashboard, recrealas igual.
3. **Copiar los archivos** (los blobs no viajan en el dump SQL). Script sugerido
   con la Supabase CLI o `rclone`. Ejemplo mínimo en Node con las dos service_role
   keys (descarga del viejo, sube al nuevo):

```bash
# Requiere: npm i @supabase/supabase-js
# Variables: SRC_URL, SRC_SERVICE, DST_URL, DST_SERVICE
node scripts/migrate-storage.mjs
```

> Se incluye un script de ejemplo en `scripts/migrate-storage.mjs` (ver paso 12
> de este doc). Copia bucket por bucket, archivo por archivo, idempotente.

---

## 5. Paso 4 — Configurar Auth en el proyecto nuevo

Dashboard del nuevo → **Authentication → Settings/URL Configuration**:

- **Site URL:** `https://higoapp.com`
- **Redirect URLs** (allowlist) — replicar las del viejo, mínimo:
  - `https://higoapp.com/cuenta-confirmada/`
  - `https://higoapp.com/#/reset-password`
  - `https://higoapp.com/**`
- **Email templates:** copiar del viejo (confirmación, reset, invite) — vienen en
  español y con el link a higoapp.com.
- **SMTP:** reconfigurar el SMTP propio (el mismo de Hostinger Mail que usás hoy),
  o los emails de auth saldrán por el SMTP compartido de Supabase (rate-limited).
- **Providers:** confirmar Email habilitado; "Confirm email" en el mismo estado
  que el viejo.
- **JWT expiry / refresh:** dejar igual que el viejo si lo cambiaste.

---

## 6. Paso 5 — Realtime

En el proyecto nuevo → **Database → Replication** (o Publications):

- Asegurar que la publicación `supabase_realtime` incluya las tablas que la app
  escucha en vivo: **`rides`, `orders`, `profiles`** (y cualquier otra que uses
  con `.channel(...).on('postgres_changes', ...)`).
- Sin esto, el tracking de viajes/pedidos en vivo no llega.

---

## 7. Paso 6 — Extensiones, cron y webhooks

- **Extensiones:** si usás `pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, etc.,
  habilitarlas en el nuevo (Database → Extensions). El dump de datos de `cron.job`
  puede no viajar limpio; **recrear los jobs de `pg_cron`** a mano si los tenías
  (p. ej. recordatorios de membresía).
- **Database Webhooks / Edge Functions:** si hay, recrearlos apuntando al nuevo.
- Revisar `send-membership-reminders.php` y demás crons server-side: usan
  `CRON_SECRET` + service_role; solo cambia la URL/keys (paso 8).

---

## 8. Paso 7 — Actualizar el frontend (código + secrets)

Cuando tengas `NEW_URL` y `NEW_ANON_KEY`:

1. **GitHub → Settings → Secrets and variables → Actions:**
   - `VITE_SUPABASE_URL` = `NEW_URL`
   - `VITE_SUPABASE_ANON_KEY` = `NEW_ANON_KEY`
2. **`src/services/supabase.js`** — actualizar el fallback hardcoded (red de
   seguridad si faltan los secrets):
   - `FALLBACK_URL = 'NEW_URL'`
   - `FALLBACK_KEY = 'NEW_ANON_KEY'`
   > Este cambio de código lo hago yo apenas me pases `NEW_URL` y `NEW_ANON_KEY`
   > (queda en un PR a `claude/continua-8awogh` → merge → deploy).

---

## 9. Paso 8 — Actualizar los backends PHP en Hostinger

Los endpoints PHP leen la config de un archivo **fuera del webroot** (patrón de
`docs/higo-banesco.example.php`). Editar ese archivo en Hostinger y actualizar:

- `SUPABASE_PROJECT_URL` = `NEW_URL`
- `SUPABASE_ANON_KEY` = `NEW_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` = `NEW_SERVICE_ROLE_KEY`

Archivos que dependen de esa config (no hay que editarlos, solo el config):
`banesco-validate.php`, `notify-payment.php`, `send-emergency.php`,
`send-ride-request-push.php`, `send-delivery-milestone.php`,
`send-delivery-pod-email.php`, `send-support-push.php`,
`send-membership-reminders.php`, `send-claim-resolution-email.php`,
`welcome-driver.php`.

> ⚠️ El **service_role key** es distinto en el proyecto nuevo. Si no lo
> actualizás, la activación de membresías (Banesco) y las notificaciones dejan de
> funcionar.

---

## 10. Paso 9 — Deploy web + APK

1. Merge del PR con la URL/keys nuevas → dispara el deploy a Hostinger (web
   migrada).
2. **Build APK 1.3.16** (Actions → Build Android APK → rama `main`) → subir a
   Play Store. Este APK ya apunta al proyecto nuevo.
3. Comunicar/forzar actualización de la app a los usuarios.

---

## 11. Paso 10 — Verificación post-migración (checklist)

- [ ] Login en la **web** (Chrome) entra sin "conexión lenta".
- [ ] Login en **APK 1.3.16** entra en el Redmi 15.
- [ ] Registro nuevo + email de confirmación llega y el link abre bien.
- [ ] Reset de contraseña funciona.
- [ ] Un viaje de prueba: request → aceptar (driver) → tracking en vivo (realtime).
- [ ] Un pedido Higo Shop de prueba.
- [ ] Pago Banesco de prueba activa la membresía (server-side, service_role nuevo).
- [ ] Notificaciones push llegan (FCM + service_role nuevo).
- [ ] Counts de `auth.users`/`profiles`/`rides`/`orders` calzan con el viejo.
- [ ] Archivos de Storage se ven (foto de licencia, comprobantes, POD).

---

## 12. Rollback

Si algo sale mal en el cutover:

1. Revertir `VITE_SUPABASE_URL`/`ANON_KEY` (secrets) y `FALLBACK_*` al viejo →
   redeploy web.
2. Revertir el config PHP en Hostinger al viejo.
3. Republicar el APK anterior (o no promover el 1.3.16).

Como el **proyecto viejo sigue encendido**, el rollback es inmediato. Por eso NO
se borra hasta confirmar todo.

---

## Estado / próximos pasos

- [ ] Paso 1: crear proyecto São Paulo → pasarme `NEW_URL`, `NEW_ANON_KEY`,
      `NEW_SERVICE_ROLE_KEY` y los dos connection strings.
- [ ] Yo preparo: cambio de `supabase.js` (PR), y el `scripts/migrate-storage.mjs`.
- [ ] Vos ejecutás dump/restore + storage + config Auth/Realtime.
- [ ] Cutover coordinado (web + PHP + APK) en ventana corta.
