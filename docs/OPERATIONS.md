# Higo — Runbook operacional

Documento corto y accionable para los procedimientos de ops más comunes.
Cualquier cosa que se haga >2 veces termina acá.

---

## Cambiar motor de mapas (Mapbox ↔ Google)

El motor visual se controla con la env var `VITE_MAP_ENGINE`:

- `google` (default, legacy): usa `InteractiveMapGoogle.jsx` + `@vis.gl/react-google-maps`.
- `mapbox`: usa `InteractiveMapMapbox.jsx` + `mapbox-gl`. Requiere `VITE_MAPBOX_TOKEN`.

**Cambiar en producción:**

1. GitHub → Settings → Secrets → `VITE_MAP_ENGINE` = `mapbox` (o viceversa).
2. Push commit vacío en `main`: `git commit --allow-empty -m "chore: switch map engine" && git push`.
3. Workflow `Deploy to Hostinger` rehidrata el build con la nueva flag.
4. Smoke test (workflow lo hace solo): curl + `grep "Higo - Tecnología"`.

**Si Mapbox falla en producción** (errores en `client_errors` con route `/`, `/ride/`, `/driver`):

```bash
# Rollback inmediato — sin tocar código.
gh secret set VITE_MAP_ENGINE -b "google"
git commit --allow-empty -m "rollback: map engine back to google"
git push origin main
```

**Restricciones de tokens** (importante para no leak):

> ⚠️ **NO usar el "Default public token"** del dashboard de Mapbox. Ese
> token NO soporta URL restrictions ("URL restrictions are not supported
> for default tokens"). Para producción hay que crear un token nuevo:
>
> Mapbox dashboard → Account → Access tokens → **Create a token** →
> Name: `higoapp-prod` → Scopes públicos default (Styles:Read, Fonts:Read,
> Datasets:Read, Vision:Read) → URL restrictions: agregar la lista de
> abajo → **Create token** → copiar el `pk.*` resultante a
> `VITE_MAPBOX_TOKEN` en GitHub Secrets.
>
> Si ya estás usando el default token, generá uno nuevo y rotalo
> reemplazando el secret. El default queda inactivo (no se borra, sirve
> para dev local en `.env`).

- Mapbox token de producción → URL restrictions:
  - `https://higoapp.com/*`
  - `https://www.higoapp.com/*`
  - `https://higodriver.com/*`
  - `capacitor://localhost/*`
  - `http://localhost:*`
- Google Maps Cloud Console → API key → restricciones: misma lista de
  HTTP referrers + SHA-1 del APK Android para builds nativos.

**Verificar billing**:

- Mapbox: dashboard → usage. Free tier = 50K map loads/mes + 50K
  Directions requests/mes. Si el counter se acerca al 80%, escalar
  el plan o reducir uso (cache de tiles via SW).
- Google Cloud → Billing → SKU breakdown:
  - "Places API (New) — Autocomplete Session" debe ser ≪ "Per Request".
  - "Maps JavaScript Map Loads" debe caer ~ a 0 cuando `VITE_MAP_ENGINE=mapbox`.

**WebGL fallback**: el wrapper `InteractiveMap.jsx` detecta automáticamente
si el WebView no tiene WebGL y cae a Google aunque la flag sea `mapbox`.
No requiere intervención.

---

## Rollback de un deploy roto

El deploy a Hostinger se dispara con cada push a `main` (workflow
`.github/workflows/deploy.yml`). Si después de un push notamos que la
app está rota en producción:

```bash
# 1. Identificar el commit roto (typicamente el último).
git log --oneline -5

# 2. Revertir creando un commit nuevo (NO reset --hard, mantenemos historia).
git revert <sha-roto>

# 3. Push: dispara el deploy con la versión previa.
git push origin main
```

El workflow tiene `concurrency: cancel-in-progress: true` así que si
hay un deploy en curso, se cancela y arranca el nuevo. El smoke test
post-deploy (H7.1) verifica que el HTML servido contenga el title
canónico — si falla, el workflow se marca rojo.

**Si el smoke test falla pero el upload completó**: Hostinger a veces
sirve HTML viejo unos segundos. Esperá 1-2 min y refrescá manualmente.
Si persiste, verificá en File Manager de Hostinger que `index.html`
de `public_html/` tenga el contenido correcto.

---

## Rotar la anon key de Supabase

Coordinación crítica con el APK del Play Store: la key vieja vive
embedded en el APK que los choferes ya tienen instalado. Rotar sin
coordinar = romper la app de todos los choferes con APK viejo.

**Proceso correcto (15-30 días):**

1. **Crear nueva key** en Supabase dashboard → Settings → API → "Reveal new anon key".
2. **NO invalidar la vieja todavía**. Supabase soporta múltiples keys
   simultaneas mientras dura la rotación.
3. Actualizar `VITE_SUPABASE_ANON_KEY` en GitHub Settings → Secrets.
4. Subir un APK nuevo al Play Store con la key nueva (workflow
   `build-apk.yml` toma el secret en build time).
5. Esperar **15-30 días** para que el rollout llegue al ≥95% de los devices
   (Play Console → Production → Status of release).
6. **Recién entonces** invalidar la key vieja desde Supabase dashboard.

**Verificación post-rotación**: monitorear `client_errors` (mig 66)
filtrando por mensaje "Invalid API key" o "JWT" durante 48h. Si
aparece spike, hay APKs viejos en circulación que no se actualizaron;
re-activar la key vieja temporalmente o pushear notificacion de update.

---

## Investigar un crash reportado

Los crashes del frontend se loguean en `public.client_errors` (mig 66)
via el ErrorBoundary global + util `reportError()`.

**Queries útiles** (Supabase SQL editor):

```sql
-- Los 50 errores más recientes
SELECT created_at, route, message, app_version, user_id
FROM public.client_errors
ORDER BY created_at DESC
LIMIT 50;

-- Errores por ruta (qué pantallas crashean más)
SELECT route, COUNT(*) AS cnt
FROM public.client_errors
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY route
ORDER BY cnt DESC;

-- Stack completo de un error específico
SELECT id, route, message, stack, context, user_agent, app_version
FROM public.client_errors
WHERE id = '<uuid>';

-- Errores de un user específico
SELECT created_at, route, message
FROM public.client_errors
WHERE user_id = '<uuid>'
ORDER BY created_at DESC;
```

**Cron de purga**: las filas > 30 días se borran automáticamente
(pg_cron job `client_errors_purge_30d`, corre a las 04:00 UTC diario).
Si querés extender el window, modificar el job en mig 66.

**SOS request_id**: si un user reporta "el SOS no llegó", pedile el
`request_id` que mostró la consola. Buscar en `error_log` de Hostinger:

```bash
grep "req=<request_id>" /var/log/apache2/error.log
# o desde cPanel → Error Logs filtrando por ese ID
```

---

## Bloquear un origen abusivo

Si detectamos requests masivos desde un dominio no autorizado (logs
de `_cors.php` con `[CORS] Rejected origin ...`), la whitelist se
mantiene en dos lugares:

1. **`public/api/_cors.php`** — `$hardcodedAllowed` array. Editar y
   commitear. Cubre los endpoints de higoapp.com.
2. **`higodriver/api/_cors.php`** — `$allowed` array. Cubre el endpoint
   de registro de chofer en higodriver.com.

**Para bloquear una IP específica** (no un origin): agregar al
`.htaccess` de Hostinger:

```apache
<RequireAll>
    Require all granted
    Require not ip 1.2.3.4
</RequireAll>
```

---

## Recuperar acceso de un user (sin password reset email)

Si el user no recibe el mail de reset (spam filter agresivo, email
viejo sin acceso, etc.):

1. Supabase dashboard → Authentication → Users → buscar por email.
2. Click en el user → "Send password recovery" (reenvía el mail).
3. Si tampoco llega: editar el user directamente, click "Reset
   password" y elegir una clave temporal. Comunicársela por
   WhatsApp/llamada y pedir que la cambie en /reset-password después
   del login.

**Logs útiles** para diagnosticar: Supabase dashboard → Auth → Logs,
filtrar por `event_type = recovery_email_sent`.

---

## Suspender un chofer (vía claim de delivery)

Hay 2 caminos:

**Vía admin de claims** (preferido): `/admin/disputes` → tab "Envíos"
→ abrir claim → "Probar a favor del remitente". Esto suspende al
chofer automáticamente (mig 58, RPC `resolve_delivery_claim_for_claimant`).

**Manual** (si no hay claim formal): Supabase SQL editor:

```sql
UPDATE public.profiles
SET suspended_at = NOW(),
    suspended_reason = 'manual_admin: <descripción corta>'
WHERE id = '<driver-uuid>';
```

Re-activar:

```sql
UPDATE public.profiles
SET suspended_at = NULL,
    suspended_reason = NULL
WHERE id = '<driver-uuid>';
```

---

## Variables de entorno de build

Las env vars `VITE_*` se inyectan en `vite build`. Si faltan o tienen
formato inválido, el workflow falla en el step "Build Project" antes
de subir nada (validado por regex desde H1.1).

| Secret | Formato | Notas |
|--------|---------|-------|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | regex `^https://[a-z0-9-]+\.supabase\.co$` |
| `VITE_SUPABASE_ANON_KEY` | string len ≥ 20 | Rotación coordinada (ver arriba) |
| `VITE_GOOGLE_MAPS_API_KEY` | `AIza` + 35 chars | regex `^AIza[0-9A-Za-z_-]{35}$` |
| `VITE_GEMINI_API_KEY` | API key Google | sin regex |
| `VITE_FIREBASE_*` | varios | sin regex |
| `VITE_FCM_VAPID_KEY` | string | sin regex |
| `VITE_APP_VERSION` (opcional) | semver string | usado por `reportError` para tag en client_errors |

---

## Contactos

- Soporte usuarios: `admin@higoapp.com`
- Legal: `legal@higoapp.com`
- Issues técnicos urgentes: ver Slack/WhatsApp del equipo.
