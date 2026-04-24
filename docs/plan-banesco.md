# Integración Banesco → Activación automática de drivers en Higo

> Última revisión: 2026-04-24. Cambios respecto a la versión anterior marcados con **[v2]**.

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

## Arquitectura

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
          │ 3. Banesco → POST higoapp.com/banesco-webhook │
          │    - Valida shared-secret / HMAC              │
          │    - Normaliza payload (4 shapes → 1)         │
          │    - Llama RPC register_membership_from_payment│
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

- El PHP vive en `public/banesco-webhook.php`. Vite lo copia a `dist/` durante build; el workflow `lftp mirror` ya existente lo sube a la raíz de Hostinger. No hay cambios en CI/CD.
- El `.htaccess` actual (`public/.htaccess:9-12`) deja pasar archivos que existen físicamente, así que el `.php` se sirve directo sin que el rewrite lo mande a `index.html`.
- Los secretos (Banesco API + Supabase service_role + BCV API key si aplica) viven en `/home/<hostinger-user>/private/higo-banesco.php`, **fuera de `public_html/`, fuera del repo**. El webhook hace `require_once '/.../private/higo-banesco.php'` por ruta absoluta.

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

- **`public/banesco-webhook.php`** — receptor del callback. Valida firma/shared-secret, llama al normalizador, llama al RPC vía REST.
- **`public/banesco-lib/BanescoClient.php`** — helpers portados desde `wifirapidito/Banesco-validation.php` (auth, verify signature, parse).
- **`public/banesco-lib/BanescoPayloadNormalizer.php`** — normaliza las 4 variantes al shape común. **[v2]**
- **`public/banesco-lib/BcvRateClient.php`** — fetch + cache de la tasa BCV. **[v2]**
- **`public/banesco-lib/SupabaseClient.php`** — wrapper mínimo sobre cURL para llamar a `${SUPABASE_URL}/rest/v1/rpc/register_membership_from_payment` con `Authorization: Bearer ${SERVICE_ROLE_KEY}`.
- **`public/banesco-lib/.htaccess`** — `Deny from all` para impedir que alguien liste o invoque los helpers desde web.

- **`src/pages/DriverMembershipPaymentPage.jsx`** — página logueada en `/driver/membresia`. **[v2]**
  - Muestra el `phone` del profile del driver (read-only, con nota "debes pagar desde este número").
  - Muestra plan derivado de `vehicle_type` (moto/carro/van) + precio USD + precio Bs calculado en vivo.
  - Instrucciones paso a paso: a qué teléfono/cuenta/cédula Banesco de Higo pagar, con botones "copiar al portapapeles".
  - Estado en vivo: "Esperando confirmación…" / "¡Activado!" (poll a `profiles.subscription_status` cada 10s).

- **`migrations/16_banesco_webhook_rpc.sql`** — nueva migración que:
  - Añade `CONSTRAINT uq_memberships_method_reference UNIQUE (payment_method, reference)` a `driver_memberships` (idempotencia).
  - Crea tabla `banesco_unmatched_payments (id, phone, amount_bs, amount_usd_expected, reference, paid_at, channel, raw_payload jsonb, status TEXT CHECK IN ('pending','amount_mismatch','normalize_error','resolved'), created_at, resolved_by, resolved_at, resolved_membership_id)`. **[v2: columnas ampliadas]**
  - Crea tabla `bcv_rate_cache (id INT PRIMARY KEY DEFAULT 1, rate NUMERIC NOT NULL, fetched_at TIMESTAMPTZ NOT NULL)` con `CHECK (id = 1)` para forzar fila única. **[v2]**
  - Crea la función `register_membership_from_payment(p_phone TEXT, p_amount_bs NUMERIC, p_reference TEXT, p_paid_at TIMESTAMPTZ, p_channel TEXT, p_bcv_rate NUMERIC, p_tolerance_pct NUMERIC DEFAULT 1.0, p_raw_payload JSONB DEFAULT NULL)` con `SECURITY DEFINER`: **[v2: firma actualizada]**
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

Sin cambios:
- `.github/workflows/deploy.yml` — `public/banesco-webhook.php` fluye solo a través del pipeline existente.
- `vite.config.js` — Vite copia `public/*` tal cual.
- `driver_memberships` + trigger `trg_sync_subscription_status` → se reusan sin tocar.

## Secretos (NO en el repo)

`/home/<user>/private/higo-banesco.php` devuelve un array con:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BANESCO_SHARED_SECRET` (header `X-Higo-Webhook-Token` que debe traer el POST)
- `BANESCO_API_USER` / `BANESCO_API_PASSWORD` (credenciales para la API pull si aplica — depende de pregunta pendiente #1)
- `BCV_RATE_API_URL` (el endpoint que usa wifirapidito)
- `BCV_RATE_TOLERANCE_PCT` (default 1.0)
- `BANESCO_IP_ALLOWLIST` (opcional)
- `LOG_PATH` (default `/home/<user>/private/higo-banesco.log`)

## Seguridad e idempotencia

- **Autenticación del webhook:** header `X-Higo-Webhook-Token` con `hash_equals()` (constant-time). Si Banesco firma con HMAC, verificar además `X-Banesco-Signature` contra `hash_hmac('sha256', raw_body, secret)`.
- **Transport:** rechazar si `$_SERVER['HTTPS'] !== 'on'`.
- **Replay protection:** `UNIQUE (payment_method, reference)` en `driver_memberships`. El RPC captura la violación y devuelve `duplicate` con HTTP 200 para que Banesco deje de reintentar.
- **Log:** cada request se loguea a `/home/<user>/private/higo-banesco.log` (timestamp, IP, referencia, canal, resultado). Nunca en `public_html/`.
- **Service role nunca sale del servidor:** el cliente JS sigue usando anon key; el service_role solo existe en `private/higo-banesco.php`.
- **Tasa BCV:** se guarda con `fetched_at`. Si la cache tiene más de X minutos, se refresca antes de validar. Si la API de BCV está caída, el webhook **rechaza** el pago con HTTP 503 (Banesco reintentará) en vez de usar una tasa vieja — protege contra validaciones con tasas obsoletas. **[v2]**

## Verificación end-to-end

**Fase A (desarrollo local):**
1. Aplicar `migrations/16_banesco_webhook_rpc.sql` en un Supabase de staging.
2. Obtener el service_role key de Supabase staging.
3. Con el código de `wifirapidito/Banesco-validation.php` ya compartido por el usuario, portar a `public/banesco-webhook.php` + `banesco-lib/`.
4. Arrancar `php -S localhost:8080 -t public/` y simular los 4 canales:
   ```bash
   # Pago móvil Banesco→Banesco (happy path)
   curl -X POST http://localhost:8080/banesco-webhook.php \
     -H "X-Higo-Webhook-Token: <shared-secret>" \
     -H "Content-Type: application/json" \
     -d '{"channel":"pago_movil_same_bank","phone":"04141234567","amount_bs":"420.00","reference":"PM001","paid_at":"2026-04-24T10:00:00Z"}'
   # (asumiendo BCV rate ≈ 42 → $10 moto = 420 Bs)
   ```
5. Verificar:
   - Happy path (monto exacto) → `driver_memberships` tiene row + `profiles.subscription_status='active'`.
   - Monto con +0.5% desviación → también crea membership (dentro de tolerancia).
   - Monto con +2% desviación → row en `banesco_unmatched_payments` con `status='amount_mismatch'`.
   - Retry con misma referencia → `{status:"duplicate"}`, sin row duplicada.
   - Phone inexistente → row en `banesco_unmatched_payments` con `status='pending'`, HTTP 200.
   - Sin header `X-Higo-Webhook-Token` → HTTP 401.
   - Repetir tests con las otras 3 variantes de canal para validar el normalizador.

**Fase B (deploy a producción):**
1. Subir `/home/<user>/private/higo-banesco.php` por SFTP con credenciales reales (sandbox de Banesco primero).
2. Commit + push a `main` → CI sube el PHP automáticamente a `higoapp.com/banesco-webhook.php`.
3. Aplicar `migrations/16_banesco_webhook_rpc.sql` al Supabase de producción.
4. Configurar en el panel de Banesco la URL del callback: `https://higoapp.com/banesco-webhook.php`.
5. Hacer un pago real de 1 céntimo desde un teléfono registrado como driver; verificar log + DB.
6. Chequear `/admin/drivers` → el driver debería aparecer como activo sin intervención manual.

**Fase C (rollout):**
- Cambiar credenciales Banesco sandbox → producción editando solo `/private/higo-banesco.php`. No redeploy.
- Monitorear log por ~1 semana.
- Implementar la UI de pagos sin identificar en `AdminDriversPage`.

## Preguntas aún pendientes **[v2: se cerraron 4 de 5]**

1. ¿`wifirapidito/Banesco-validation.php` es invocado por Banesco (push webhook) o corre periódicamente consultando el API de Banesco (pull/cron)? Si es pull, hay que configurar un cron job en Hostinger apuntando al PHP. **(sin respuesta)**
2. ~~Formato del payload~~ → **Resuelto.** Depende del canal (4 variantes). Se normaliza en `BanescoPayloadNormalizer.php`. Campos exactos se confirmarán al portar el código de wifirapidito.
3. ¿Banesco firma los callbacks con HMAC o usa otro mecanismo (IP allowlist, auth básica, token en header)? **(sin respuesta; el diseño ya soporta shared-secret + HMAC opcional)**
4. ~~Monedas~~ → **Resuelto.** Banesco liquida en VES. El driver paga el equivalente en Bs de su plan USD × tasa BCV, con ±1% de tolerancia. Misma API BCV que usa wifirapidito.
5. ~~Múltiples teléfonos~~ → **Resuelto.** Un solo teléfono: el registrado en `profiles.phone`. El driver debe pagar desde ese número. No se crea tabla `driver_phones`.

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
- `/home/user/Higo/public/banesco-webhook.php`
- `/home/user/Higo/public/banesco-lib/BanescoClient.php`
- `/home/user/Higo/public/banesco-lib/BanescoPayloadNormalizer.php` **[v2]**
- `/home/user/Higo/public/banesco-lib/BcvRateClient.php` **[v2]**
- `/home/user/Higo/public/banesco-lib/SupabaseClient.php`
- `/home/user/Higo/public/banesco-lib/.htaccess`
- `/home/user/Higo/migrations/16_banesco_webhook_rpc.sql`
- `/home/user/Higo/src/pages/DriverMembershipPaymentPage.jsx` **[v2]**

**Fuera del repo (Hostinger SFTP):**
- `/home/<user>/private/higo-banesco.php` — secretos
- `/home/<user>/private/higo-banesco.log` — log de webhook
