# Setup de notificaciones push de vencimiento

Pipeline end-to-end: **cron Hostinger → PHP → FCM HTTP v1 → SW del browser/Android**.

## Piezas que ya están en el repo

- `migrations/18_push_notifications.sql` — agrega `profiles.fcm_token` + tabla `membership_reminders`.
- `src/services/pushNotifications.js` — registra/refresca el token en el cliente y lo persiste en `profiles`.
- `public/api/send-membership-reminders.php` — el cron en sí. Manda push a memberships que vencen en {7, 3, 1, 0} días.
- `public/firebase-messaging-sw.js` — service worker que muestra la push y abre `/higo-pay` al hacer click.

## Pasos manuales para activar (una sola vez)

### 1. VAPID key (browser web)

Sin esto el cliente nunca obtiene token FCM en la web (no afecta a Android nativo).

1. Firebase Console → Project settings → **Cloud Messaging** → tab "Web configuration".
2. En "Web Push certificates", "Generate key pair" si no hay uno.
3. Copiar el **Key pair** (formato `B...` de ~88 chars).
4. En Hostinger, agregar a las env vars del build:
   ```
   VITE_FCM_VAPID_KEY=BXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
   o setearlo localmente y rebuildear. El cliente ya lo lee de `import.meta.env.VITE_FCM_VAPID_KEY`.

### 2. Service Account de Firebase (server)

El endpoint PHP firma un JWT con la private key del Service Account y lo cambia por un Bearer token de Google.

1. Firebase Console → Project settings → **Service accounts** → "Generate new private key" → descarga JSON.
2. Subir el JSON a Hostinger por SFTP/File Manager a:
   ```
   /home/<TU_USER>/private/firebase-sa.json
   ```
   ⚠️ Mismo nivel que `private/higo-banesco.php`. **Fuera** de `public_html/`.
3. Permisos:
   ```bash
   chmod 600 /home/<TU_USER>/private/firebase-sa.json
   ```

### 3. Config privado

Editar `/home/<TU_USER>/private/higo-banesco.php` y agregar las keys nuevas (ver `docs/higo-banesco.example.php` para template completo):

```php
'SUPABASE_SERVICE_ROLE_KEY' => '<service_role de Supabase, NO el anon>',
'CRON_SECRET'               => '<openssl rand -hex 32>',
'FIREBASE_PROJECT_ID'       => 'higo-app-26a19',
'FIREBASE_SA_PATH'          => '/home/<TU_USER>/private/firebase-sa.json',
'CRON_LOG_PATH'             => '/home/<TU_USER>/private/higo-cron.log', // opcional
```

`SUPABASE_SERVICE_ROLE_KEY` se saca de Supabase → Settings → API → service_role.

### 4. Aplicar migración 18

En Supabase SQL Editor, pegar el contenido de `migrations/18_push_notifications.sql` y correr.

### 5. Cron job en Hostinger

cPanel → "Cron Jobs" → New cron job:

- **Frecuencia:** cada hora (`0 * * * *`)
- **Comando:**
  ```bash
  curl -fsS -X POST -H "X-Cron-Secret: <MISMO_TOKEN_DEL_CONFIG>" https://higoapp.com/api/send-membership-reminders.php
  ```

Notas:
- `-f` hace que curl falle con exit ≠0 si el endpoint devuelve no-2xx, así Hostinger te manda mail si algo se rompe.
- Los duplicados los maneja el índice único `uq_membership_reminders_membership_threshold`, así que correrlo cada hora no manda 24 pushes — sólo entra al `sent` cuando es la primera vez en esa banda.

### 6. Probar

```bash
# desde tu máquina, simulando el cron:
curl -X POST -H "X-Cron-Secret: <TOKEN>" https://higoapp.com/api/send-membership-reminders.php

# debería devolver:
# {"ok":true,"processed":N,"sent":M,"skipped":K,"errors":[]}
```

Verificar:
- Para un driver con membresía a `expires_at` en {7d, 3d, 1d, 0d} y `fcm_token` válido, le llega push.
- Tras el primer envío, segunda corrida del cron retorna `sent: 0` (anti-duplicado).
- En `membership_reminders` aparecen filas con `fcm_status='sent'`.

## Operación

- **Token roto en el dispositivo del driver** (UNREGISTERED, 404): el endpoint hace `fcm_token = NULL` en `profiles`. Cuando el driver vuelva a abrir la app, `ensureFcmRegistration()` registra uno nuevo.
- **Driver sin token** (no aceptó permisos): se inserta el reminder con `fcm_status='no_token'` para no quemar reintentos. Si el threshold ya pasó cuando el driver activa permisos, se pierde ese aviso (acceptable).
- **Click en la push:** el SW abre/foco a `/#/higo-pay`.
- **Logs:** si setiaste `CRON_LOG_PATH`, hay un log por línea con `threshold/driver/status`.
