# Integración Banesco → Activación automática de drivers en Higo

> Última revisión: 2026-04-24 (v3). Cambios respecto a versiones anteriores marcados con **[v2]** o **[v3]**.

## Contexto

Hoy en Higo, cuando un driver paga su membresía mensual, un admin debe entrar a `/admin/drivers`, abrir el modal de acciones y clicar "pago + activar". Eso inserta una fila en `driver_memberships` (con `status='active'`, `paid_at=NOW()`, `expires_at=+30d`) y un trigger de Postgres (`trg_sync_subscription_status` en `migrations/13_add_payment_and_membership.sql:110-124`) flipea `profiles.subscription_status` a `'active'`. El driver ya puede conectarse.

El usuario tiene un validador de Banesco ya funcionando en PHP en otro proyecto suyo (`wifirapidito.com/Banesco-validation.php`) que confirma pagos y activa clientes automáticamente en Wisphub. El objetivo: portar esa lógica a higoapp.com para que la acción "pago + activar" se dispare sola en cuanto Banesco confirma el depósito, sin intervención del admin.

## Decisiones confirmadas

- **Hosting:** PHP en el propio Hostinger de higoapp.com (junto a la SPA).
- **Matching pago→driver:** exclusivamente por `profiles.phone` del driver registrado. No se soportan teléfonos adicionales (cónyuge, etc.); el driver debe pagar desde el mismo número con el que se registró en Higo. **[v2]**
- **Moneda:** los planes están en USD ($10 moto / $20 carro / $25 van) pero el pago se recibe en **VES**. Se consulta la tasa BCV (mismo endpoint que usa `wifirapidito`) y se multiplica por el USD del plan. El webhook valida el monto recibido contra el esperado con **±1% de tolerancia** (configurable, igual que en wifirapidito). **[v2]**
- **Canales de pago soportados:** cuatro variantes que Banesco entrega con payloads distintos (ver sección "Normalización del payload"). **[v2]**
  1. Pago móvil Banesco → Banesco
  2. Pago móvil otros bancos → Banesco
  3. Transferencia Banesco → Banesco
  4. Transferencia otros bancos → Banesco
- **Bancos de origen:** no requieren integraciones adicionales. Como la cuenta destino es Banesco, la API de Banesco valida pagos originados en cualquier banco (Mercantil, BDV, Provincial, etc.) de forma transparente. **[v2]** *(reemplaza la idea anterior de extender `payment_method` por banco.)*
- **Modelo de integración: PULL vía cron (NO webhook push).** **[v3]** Banesco expone una API "Confirmación de Transacciones" autenticada con OAuth2 client credentials (Keycloak). Hostinger corre un cron cada 2 minutos que pide un token, consulta las transacciones nuevas del período, y procesa cada una. Banesco **no** llama a Higo.
- **Autenticación Banesco:** OAuth2 client_credentials grant. **[v3]**
  - Token endpoint (SSO Keycloak): `https://sso-sso-project.apps.proplakur.banesco.com/auth/realms/realm-api-prd/protocol/openid-connect/token`
  - Resource endpoint (transacciones): `https://sid-validador-consulta-de-transacciones-3scale-apicast-61e25ec.apps.proplakur.banesco.com/financial-account/transactions`
  - Credenciales (`CLIENT_ID`, `CLIENT_SECRET`, `RIF`) viven SOLO en `/home/<user>/private/higo-banesco.php`. **Nunca en el repo, ni en commits, ni en logs.**

## Arquitectura **[v3: cambio mayor — push → pull]**

```
          ┌───────────────────────────────────────────────┐
          │ 1. Driver abre /driver/membresia              │
          │    - App muestra su phone registrado          │
          │    - Fetch tasa BCV (cacheada 10 min)         │
          │    - Calcula Bs = USD_plan × tasa_BCV         │
          │    - Muestra instrucciones de pago + monto Bs │
          └───────────────────────┬───────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────────┐
          │ 2. Driver paga desde su banco a Banesco Higo  │
          │    (cualquier canal de los 4 soportados)      │
          └───────────────────────┬───────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────────┐
          │ 3. Cron Hostinger c/2 min:                    │
          │    banesco-poller.php                         │
          │    ├─ GET token OAuth2 (SSO Keycloak)         │
          │    ├─ GET /financial-account/transactions     │
          │    │       ?from=<last_cursor>&to=NOW         │
          │    ├─ Para cada transacción nueva:            │
          │    │   - Normaliza payload (4 shapes → 1)     │
          │    │   - Llama RPC register_membership_...    │
          │    └─ Guarda max(paid_at) como nuevo cursor   │
          └───────────────────────┬───────────────────────┘
                                  │
                                  ▼
          ┌───────────────────────────────────────────────┐
          │ 4. RPC (Supabase, SECURITY DEFINER):          │
          │    a) Busca driver por phone normalizado      │
          │    b) Calcula expected_bs = USD_plan × tasa   │
          │    c) Valida |recibido - esperado| ≤ 1%       │
          │    d) Inserta en driver_memberships           │
          │       → trigger activa profiles.subscription  │
          └───────────────────────────────────────────────┘
```

- El PHP vive en `public/banesco-poller.php` **[v3]** (antes `banesco-webhook.php`). Vite lo copia a `dist/` durante build; el workflow `lftp mirror` lo sube a la raíz de Hostinger. No hay cambios en CI/CD.
- El `.htaccess` actual (`public/.htaccess:9-12`) deja pasar archivos que existen físicamente, así que el `.php` se sirve directo. Además agregamos una regla que **solo acepta ejecución local** (`RewriteCond %{REMOTE_ADDR} !^127\.0\.0\.1$` → 403) para que nadie pueda dispararlo desde internet — solo el cron de Hostinger vía CLI `php /home/<user>/public_html/banesco-poller.php`. **[v3]**
- Los secretos (credenciales Banesco + Supabase service_role + BCV API) viven en `/home/<hostinger-user>/private/higo-banesco.php`, **fuera de `public_html/`, fuera del repo**. El poller hace `require_once '/.../private/higo-banesco.php'` por ruta absoluta.

## Cursor de polling **[v3]**

Para no re-procesar transacciones y no perder ninguna:
- Tabla `banesco_poll_state (id INT PRIMARY KEY DEFAULT 1, last_cursor TIMESTAMPTZ NOT NULL, last_run_at TIMESTAMPTZ, last_run_result JSONB)`.
- En cada run: `from = last_cursor - 5 min` (overlap de seguridad), `to = NOW()`. Banesco devuelve transacciones en ese rango.
- Idempotencia garantizada por `UNIQUE (payment_method, reference)` en `driver_memberships`: re-procesar la misma tx devuelve `{status:'duplicate'}` y no duplica nada.
- Al terminar: `last_cursor = MAX(paid_at de las tx procesadas)`.
- Si el run falla a mitad: `last_cursor` no se avanza → próximo run reintenta el mismo rango. Como hay idempotencia, es seguro.

## Normalización del payload **[v2]**

Banesco entrega formatos distintos según el canal. `BanescoPayloadNormalizer.php` mapea las 4 variantes a un shape interno común:

```php
[
  'payer_phone'    => string, // E.164 sin prefijo (04141234567)
  'payer_bank'     => string, // código o nombre del banco origen
  'payer_id'       => string, // cédula del pagador si viene
  'amount_bs'      => float,  // monto en VES
  'currency'       => 'VES',  // siempre VES para Banesco
  'reference'      => string, // referencia única del pago
  'paid_at'        => ISO8601 timestamp,
  'channel'        => 'pago_movil_same_bank'
                    | 'pago_movil_other_bank'
                    | 'transfer_same_bank'
                    | 'transfer_other_bank',
  'raw_payload'    => array,  // original para auditoría
]
```

Pendiente confirmar con el usuario los campos exactos de cada variante cuando comparta el código PHP original (`wifirapidito/Banesco-validation.php`), pero la estrategia es:
- El normalizer detecta el canal por presencia/ausencia de campos distintivos.
- Errores de normalización se loguean + se insertan en `banesco_unmatched_payments` con `status='normalize_error'` para debug manual.

## Tasa BCV y tolerancia **[v2]**

- **Fuente:** mismo endpoint que usa `wifirapidito` (confirmar URL exacta al portar el código).
- **Cache:** tabla `bcv_rate_cache (rate NUMERIC, fetched_at TIMESTAMPTZ)` o archivo JSON en `/private/bcv-rate.json`. TTL = 10 minutos. La SPA y el webhook consultan la misma cache.
- **Cálculo:** `expected_bs = plan_usd × rate_bcv`.
- **Tolerancia:** `|amount_bs - expected_bs| / expected_bs ≤ 0.01` (1%, configurable en `pricing_config` o en el PHP privado).
- **Si el monto está fuera de rango:** se inserta en `banesco_unmatched_payments` con `status='amount_mismatch'` y `raw_payload` para que el admin revise manualmente desde la UI.

## Archivos nuevos

- **`public/banesco-poller.php`** **[v3]** — script CLI invocado por el cron de Hostinger cada 2 min. Orquesta: carga secretos → obtiene token OAuth2 → consulta transacciones desde `last_cursor` → por cada tx llama al normalizador + RPC → actualiza `last_cursor`. Rechaza ejecución desde HTTP (`if (PHP_SAPI !== 'cli') exit(403)`).
- **`public/banesco-lib/BanescoAuthClient.php`** **[v3]** — cliente OAuth2 client_credentials contra el endpoint SSO Keycloak. Cachea el `access_token` en `/private/banesco-token.json` hasta su `expires_in` para no pedir uno nuevo en cada run.
- **`public/banesco-lib/BanescoTransactionsClient.php`** **[v3]** — cliente del endpoint `/financial-account/transactions`. Paginación, rate limiting respetando headers de Banesco, retry con backoff.
- **`public/banesco-lib/BanescoPayloadNormalizer.php`** — normaliza las 4 variantes del `transaction` al shape común (ver sección "Normalización del payload"). **[v2]**
- **`public/banesco-lib/BcvRateClient.php`** — fetch + cache de la tasa BCV. **[v2]**
- **`public/banesco-lib/SupabaseClient.php`** — wrapper mínimo sobre cURL para llamar a `${SUPABASE_URL}/rest/v1/rpc/register_membership_from_payment` con `Authorization: Bearer ${SERVICE_ROLE_KEY}`.
- **`public/banesco-lib/.htaccess`** — `Deny from all` para impedir que alguien liste o invoque los helpers desde web.

- **`src/pages/DriverMembershipPaymentPage.jsx`** — página logueada en `/driver/membresia`. **[v2]**
  - Muestra el `phone` del profile del driver (read-only, con nota "debes pagar desde este número").
  - Muestra plan derivado de `vehicle_type` (moto/carro/van) + precio USD + precio Bs calculado en vivo.
  - Instrucciones paso a paso: a qué teléfono/cuenta/cédula Banesco de Higo pagar, con botones "copiar al portapapeles".
  - Estado en vivo: "Esperando confirmación…" / "¡Activado!" (poll a `profiles.subscription_status` cada 10s; el próximo run del cron activará la membresía dentro de ~2 min de que el pago llegue a Banesco).

- **`migrations/16_banesco_poller_rpc.sql`** **[v3: renombrado de `16_banesco_webhook_rpc.sql`]** — nueva migración que:
  - Añade `CONSTRAINT uq_memberships_method_reference UNIQUE (payment_method, reference)` a `driver_memberships` (idempotencia).
  - Crea tabla `banesco_unmatched_payments (id, phone, amount_bs, amount_usd_expected, reference, paid_at, channel, raw_payload jsonb, status TEXT CHECK IN ('pending','amount_mismatch','normalize_error','resolved'), created_at, resolved_by, resolved_at, resolved_membership_id)`. **[v2]**
  - Crea tabla `bcv_rate_cache (id INT PRIMARY KEY DEFAULT 1, rate NUMERIC NOT NULL, fetched_at TIMESTAMPTZ NOT NULL)` con `CHECK (id = 1)`. **[v2]**
  - Crea tabla `banesco_poll_state (id INT PRIMARY KEY DEFAULT 1, last_cursor TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_run_at TIMESTAMPTZ, last_run_result JSONB)` con `CHECK (id = 1)`. **[v3]**
  - Crea la función `register_membership_from_payment(p_phone TEXT, p_amount_bs NUMERIC, p_reference TEXT, p_paid_at TIMESTAMPTZ, p_channel TEXT, p_bcv_rate NUMERIC, p_tolerance_pct NUMERIC DEFAULT 1.0, p_raw_payload JSONB DEFAULT NULL)` con `SECURITY DEFINER`:
    - Normaliza el teléfono (quita `+`, `-`, espacios, prefijo `58`).
    - Busca un driver con `role='driver'` y `phone` normalizado igual.
    - Si no existe: inserta en `banesco_unmatched_payments` con `status='pending'` → retorna `{status:'unmatched'}`.
    - Si existe: calcula `expected_bs = plan_usd(vehicle_type) × p_bcv_rate`.
      - Si `|p_amount_bs - expected_bs| / expected_bs > p_tolerance_pct/100`: inserta en `banesco_unmatched_payments` con `status='amount_mismatch'` → retorna `{status:'amount_mismatch', expected_bs, received_bs}`.
      - Si el monto está dentro del rango: inserta en `driver_memberships` (plan derivado de `vehicle_type`, `payment_method='banesco'`, `reference=p_reference`) → trigger existente activa al driver → retorna `{status:'created', membership_id, driver_id}`.
    - Si la `reference` ya existe (violación de UNIQUE): retorna `{status:'duplicate'}`.
  - `GRANT EXECUTE` solo a `service_role`; `REVOKE` de `anon`/`authenticated`.

## Archivos modificados

- **`src/App.jsx`** — agregar ruta `/driver/membresia` → `DriverMembershipPaymentPage`.
- **`src/pages/DriverDashboard.jsx`** — el banner ámbar de "Membresía vencida" ahora linkea a `/driver/membresia` en vez de mostrar solo el mensaje.
- **`src/pages/AdminDriversPage.jsx`** (fase posterior) — agregar tab "Pagos sin identificar" que lista `banesco_unmatched_payments` filtrados por `status` y permite:
  - Asignar un `pending` a un driver manualmente (crea membership + marca row como `resolved`).
  - Aprobar un `amount_mismatch` (el admin decide si el pago parcial es aceptable).
  - Ver `normalize_error` con el raw_payload para debug.
- **`public/.htaccess`** — agregar regla para bloquear acceso HTTP a `banesco-poller.php` (solo CLI via cron). **[v3]**

Sin cambios:
- `.github/workflows/deploy.yml` — `public/banesco-poller.php` fluye solo a través del pipeline existente.
- `vite.config.js` — Vite copia `public/*` tal cual.
- `driver_memberships` + trigger `trg_sync_subscription_status` → se reusan sin tocar.

## Cron de Hostinger **[v3]**

En el panel de Hostinger → Advanced → Cron Jobs, agregar:

```
*/2 * * * * /usr/bin/php -f /home/<user>/public_html/banesco-poller.php >> /home/<user>/private/higo-banesco.log 2>&1
```

Cada 2 min. El stdout/stderr se acumula en el log privado. Si un run tarda más de 2 min, el siguiente se salta (nuestro script hace un `flock` sobre `/private/banesco-poller.lock` para evitar dos runs concurrentes).

## Secretos (NO en el repo)

`/home/<user>/private/higo-banesco.php` devuelve un array con: **[v3: actualizado]**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BANESCO_SSO_URL` (ej: `https://sso-sso-project.apps.proplakur.banesco.com/auth/realms/realm-api-prd/protocol/openid-connect/token`)
- `BANESCO_TX_URL` (ej: `https://sid-validador-.../financial-account/transactions`)
- `BANESCO_CLIENT_ID`
- `BANESCO_CLIENT_SECRET`
- `BANESCO_RIF` (el RIF de la empresa que figura en el contrato con Banesco)
- `BCV_RATE_API_URL` (el endpoint que usa wifirapidito)
- `BCV_RATE_TOLERANCE_PCT` (default 1.0)
- `LOG_PATH` (default `/home/<user>/private/higo-banesco.log`)
- `POLL_OVERLAP_MIN` (default 5, minutos de overlap para no perder tx en el borde)

> ⚠️ Las credenciales de producción que compartió el usuario por chat (CLIENT_ID + CLIENT_SECRET del RIF J402638850) **deben rotarse con Banesco** antes del go-live, ya que pueden haber quedado en transcripts del asistente. El plan se diseñó para aceptar cualquier par nuevo sin cambios de código: solo hay que actualizar `/private/higo-banesco.php`. **[v3]**

## Seguridad e idempotencia

- **Superficie de ataque:** al ser pull via cron, **no hay endpoint público expuesto**. El PHP solo se ejecuta desde CLI local (regla `PHP_SAPI !== 'cli'` + bloqueo en .htaccess). Un atacante externo no puede disparar el flujo. **[v3]**
- **Autenticación Banesco:** OAuth2 client_credentials. Token tiene vida corta (típicamente 5-30 min). Se cachea en `/private/banesco-token.json` con permisos 600. **[v3]**
- **Transport:** todas las llamadas outbound (SSO, transactions, Supabase, BCV) vía HTTPS con verificación de cert (`CURLOPT_SSL_VERIFYPEER=1`).
- **Replay protection:** `UNIQUE (payment_method, reference)` en `driver_memberships`. El RPC captura la violación y devuelve `duplicate` — idempotencia total, el cron puede re-procesar ventanas solapadas sin duplicar membresías.
- **Log:** cada run loguea a `/home/<user>/private/higo-banesco.log` (timestamp, cantidad de tx procesadas, resultados por tx). **Nunca** se loguea `CLIENT_SECRET` ni `access_token`.
- **Service role nunca sale del servidor:** el cliente JS sigue usando anon key; el service_role solo existe en `private/higo-banesco.php`.
- **Tasa BCV:** se guarda con `fetched_at`. Si la cache tiene más de X minutos, se refresca antes de validar. Si BCV está caído, el poller **difiere** la tx (no avanza el cursor sobre esa tx, queda para el próximo run) en vez de usar una tasa vieja. **[v2]**
- **Lock de concurrencia:** `flock` sobre `/private/banesco-poller.lock` para garantizar un solo run activo a la vez. **[v3]**

## Verificación end-to-end **[v3: adaptado al modelo pull]**

**Fase A (desarrollo local):**
1. Aplicar `migrations/16_banesco_poller_rpc.sql` en un Supabase de staging.
2. Obtener el service_role key de Supabase staging.
3. Portar el código de `wifirapidito/Banesco-validation.php` a `banesco-lib/` (lo principal ya está resuelto: OAuth2 + GET transactions).
4. Crear un `/tmp/higo-banesco.php` con credenciales de **sandbox** de Banesco (si Banesco las ofrece) o las de producción bajo condiciones controladas.
5. Correr `php -f public/banesco-poller.php` a mano, leer el log:
   - Token OAuth2 obtenido correctamente.
   - Endpoint de transacciones responde 200 con un JSON de transacciones.
   - El normalizador infiere el canal de cada tx.
   - El RPC retorna `created` / `duplicate` / `unmatched` / `amount_mismatch` según corresponda.
6. Inyectar a mano una transacción simulada en el mock del TransactionsClient para validar cada caso:
   - Happy path (monto exacto) → `driver_memberships` tiene row + `profiles.subscription_status='active'`.
   - Monto con +0.5% desviación → también crea membership (dentro de tolerancia).
   - Monto con +2% desviación → row en `banesco_unmatched_payments` con `status='amount_mismatch'`.
   - Repetir el mismo run → `{status:"duplicate"}`, sin row duplicada.
   - Phone inexistente → row en `banesco_unmatched_payments` con `status='pending'`.
   - Repetir con las 4 variantes de canal (pago móvil / transferencia × mismo banco / otro banco).

**Fase B (deploy a producción):**
1. Subir `/home/<user>/private/higo-banesco.php` por SFTP con las credenciales **rotadas** de Banesco (nuevas, no las que se filtraron en chat).
2. Ajustar permisos: `chmod 600 /home/<user>/private/higo-banesco.php`.
3. Commit + push a `main` → CI sube el PHP automáticamente a `higoapp.com/banesco-poller.php`.
4. Aplicar `migrations/16_banesco_poller_rpc.sql` al Supabase de producción.
5. Configurar el cron job en el panel de Hostinger (ver sección "Cron de Hostinger").
6. Ejecutar el cron una vez a mano desde el panel para validar la primera corrida.
7. Hacer un pago real de mínimo 1 Bs desde un teléfono registrado como driver; esperar hasta 2 min; verificar log + DB.
8. Chequear `/admin/drivers` → el driver debería aparecer como activo sin intervención manual.

**Fase C (rollout):**
- Rotar credenciales sandbox → producción editando solo `/private/higo-banesco.php`. No redeploy.
- Monitorear `last_run_result` en `banesco_poll_state` y el log por ~1 semana.
- Implementar la UI de pagos sin identificar en `AdminDriversPage`.

## Preguntas pendientes **[v3: todas resueltas ✅]**

1. ~~Push webhook vs pull/cron~~ → **Resuelto (v3).** Es **PULL**. Banesco expone "Confirmación de Transacciones" como API consumida vía OAuth2. Corre un cron cada 2 min en Hostinger.
2. ~~Formato del payload~~ → **Resuelto (v2).** Depende del canal (4 variantes). Se normaliza en `BanescoPayloadNormalizer.php`. Campos exactos se confirmarán en la primera corrida contra el API real (el JSON que devuelva `/financial-account/transactions`).
3. ~~Mecanismo de firma/auth de Banesco~~ → **Resuelto (v3).** OAuth2 client_credentials (Keycloak). Token endpoint: `/auth/realms/realm-api-prd/protocol/openid-connect/token`. No hay firma HMAC ni webhook — Banesco no nos llama, nosotros firmamos nuestras requests con el Bearer token.
4. ~~Monedas~~ → **Resuelto (v2).** Banesco liquida en VES. El driver paga el equivalente en Bs de su plan USD × tasa BCV, con ±1% de tolerancia. Misma API BCV que usa wifirapidito.
5. ~~Múltiples teléfonos~~ → **Resuelto (v2).** Un solo teléfono: el registrado en `profiles.phone`. El driver debe pagar desde ese número. No se crea tabla `driver_phones`.

**Único ítem remanente (no bloqueante para el diseño, sí para la implementación):** confirmar el shape JSON exacto que devuelve `/financial-account/transactions` de Banesco. Se puede resolver en los primeros 5 min de implementación haciendo un run manual contra el API y loggeando la respuesta cruda. Los nombres de campos en `BanescoPayloadNormalizer.php` quedan como placeholders hasta entonces.

## Trabajo NO incluido en esta fase

- UI en la app para que un driver "reclame" un pago que no matcheó (se resuelve desde admin por ahora).
- Auto-expiración de membresías vencidas (ya lo hace el CHECK de `expires_at > NOW()` en `is_membership_active` de la migración 13).
- Integración explícita con otros bancos — **innecesaria** porque Banesco (como destino) valida pagos de cualquier origen. **[v2]**
- Soporte multi-divisa (USDT, Zelle, efectivo). Esos canales siguen gestionándose manualmente por admin.

## Archivos críticos a consultar/tocar al implementar

**Existentes (solo lectura):**
- `/home/user/Higo/migrations/13_add_payment_and_membership.sql` — schema de `driver_memberships` y trigger de activación
- `/home/user/Higo/src/pages/AdminDriversPage.jsx:142-177` — lógica de `registerMembership` como referencia
- `/home/user/Higo/public/.htaccess` — confirma que `.php` se sirve sin rewrite
- `/home/user/Higo/.github/workflows/deploy.yml:74-84` — pipeline lftp
- `/home/user/Higo/vite.config.js` — confirma que `public/` fluye a `dist/`
- `/home/user/Higo/migrations/15_admin_pricing_config.sql` — los USD por plan viven acá

**Nuevos:**
- `/home/user/Higo/public/banesco-poller.php` **[v3]**
- `/home/user/Higo/public/banesco-lib/BanescoAuthClient.php` **[v3]**
- `/home/user/Higo/public/banesco-lib/BanescoTransactionsClient.php` **[v3]**
- `/home/user/Higo/public/banesco-lib/BanescoPayloadNormalizer.php` **[v2]**
- `/home/user/Higo/public/banesco-lib/BcvRateClient.php` **[v2]**
- `/home/user/Higo/public/banesco-lib/SupabaseClient.php`
- `/home/user/Higo/public/banesco-lib/.htaccess`
- `/home/user/Higo/migrations/16_banesco_poller_rpc.sql` **[v3]**
- `/home/user/Higo/src/pages/DriverMembershipPaymentPage.jsx` **[v2]**

**Fuera del repo (Hostinger SFTP):**
- `/home/<user>/private/higo-banesco.php` — secretos (ver sección "Secretos" para el listado completo)
- `/home/<user>/private/higo-banesco.log` — log del poller
- `/home/<user>/private/banesco-token.json` — cache del access_token OAuth2 **[v3]**
- `/home/<user>/private/banesco-poller.lock` — flock para concurrencia **[v3]**
