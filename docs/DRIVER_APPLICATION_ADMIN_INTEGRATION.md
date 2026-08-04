# Integración administrativa de solicitudes Higo Driver

Esta integración conecta el pre-registro público de `higodriver.com` con el panel administrativo de Higo App.

## Alcance

- Las solicitudes nuevas se guardan en Supabase.
- El panel incorpora la ruta `#/admin/driver-applications`.
- Los administradores con permiso `manage_drivers` pueden:
  - iniciar la revisión;
  - solicitar requisitos mediante un enlace seguro con vencimiento;
  - revisar documentos almacenados en un bucket privado;
  - solicitar correcciones;
  - aprobar, colocar en lista de espera o rechazar;
  - convertir una solicitud aprobada en una cuenta Higo Driver.
- Cada cambio sensible exige MFA cuando la política administrativa lo requiere.
- Los cambios quedan registrados en el historial de la solicitud y en `admin_audit_log`.
- La cuenta creada permanece suspendida hasta registrar una membresía vigente.
- El conductor crea su propia contraseña desde un enlace de activación; la contraseña aleatoria interna nunca se envía por correo.

## Migraciones requeridas

Aplicar en este orden y únicamente después de revisar el PR:

```text
supabase/migrations/20260724110100_driver_application_admin_integration.sql
supabase/migrations/20260724110200_driver_application_flow_hardening.sql
supabase/migrations/20260724110300_driver_application_approval_guard.sql
```

Las migraciones crean y protegen:

- `driver_applications`
- `driver_application_documents`
- `driver_application_upload_tokens`
- `driver_application_events`
- bucket privado `driver-applications`
- políticas RLS y funciones RPC administrativas
- reclamos atómicos para cargas y conversiones concurrentes
- bloqueo de aprobación hasta validar los cinco documentos principales

No ejecutar `db push` en producción hasta que el historial local y remoto de migraciones esté reconciliado.

## Secreto compartido

Generar un valor de 32 bytes en PowerShell:

```powershell
[Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

No publicar ni enviar el valor por capturas.

### Configuración de higoapp.com

En el archivo privado de configuración utilizado por `banesco-core.php`, agregar:

```php
'DRIVER_APPLICATION_INGEST_SECRET' => 'SECRETO_COMPARTIDO',
```

El archivo esperado actualmente es `/private/higo-banesco.php`, fuera de `public_html`.

### Configuración de higodriver.com

En `/Private/smtp-config.php`, agregar:

```php
'higo_app_base_url' => 'https://higoapp.com',
'higo_app_ingest_secret' => 'SECRETO_COMPARTIDO',
```

El valor debe ser exactamente el mismo en ambos hostings.

## SMTP autenticado para correos administrativos

Los correos generados desde el panel administrativo —cambios de estado, solicitud de documentos, correcciones, aprobación, rechazo y bienvenida— se envían mediante SMTP autenticado. No se utiliza `mail()`, porque el servidor local puede aceptar un mensaje sin entregarlo y producir un falso `email_sent = true`.

En `/private/higo-banesco.php` de `higoapp.com`, agregar las credenciales del buzón real:

```php
'DRIVER_SMTP_HOST' => 'smtp.hostinger.com',
'DRIVER_SMTP_PORT' => 465,
'DRIVER_SMTP_USERNAME' => 'admin@higodriver.com',
'DRIVER_SMTP_PASSWORD' => 'CONTRASEÑA_REAL_DEL_BUZON',
'DRIVER_SMTP_FROM_EMAIL' => 'admin@higodriver.com',
'DRIVER_SMTP_FROM_NAME' => 'Higo Driver',
'DRIVER_SMTP_EHLO' => 'higoapp.com',
```

También se admite el puerto `587` con STARTTLS. El remitente debe coincidir con el buzón autenticado para evitar rechazos de Hostinger. Nunca versionar ni compartir la contraseña.

Cuando la configuración falta, la autenticación falla o el servidor SMTP rechaza el mensaje, el endpoint mantiene el cambio administrativo pero devuelve `email_sent = false` y registra un error con el prefijo `[driver-email]` sin exponer credenciales.

## Orden seguro de despliegue

1. Fusionar y desplegar Higo App.
2. Aplicar las tres migraciones en Supabase, en el orden indicado.
3. Registrar las versiones como aplicadas en el historial de migraciones solo después de confirmar su ejecución correcta.
4. Configurar `DRIVER_APPLICATION_INGEST_SECRET` en higoapp.com.
5. Confirmar que `https://higoapp.com/api/driver-applications-ingest.php` responde `method_not_allowed` al abrirlo por GET. Esto confirma que el endpoint existe sin revelar información.
6. Configurar `higo_app_ingest_secret` en higodriver.com.
7. Configurar `DRIVER_SMTP_*` en higoapp.com para los correos administrativos.
8. Fusionar y desplegar Higo Driver.
9. Purgar caché de Hostinger.
10. Realizar un único pre-registro de prueba.
11. Confirmar que aparece en `#/admin/driver-applications`.
12. Probar el flujo completo con archivos de prueba no sensibles:
    - iniciar revisión;
    - solicitar documentos;
    - cargar los cinco requisitos principales;
    - aprobar o solicitar corrección;
    - aprobar la solicitud;
    - registrar el driver;
    - confirmar el enlace para crear contraseña, Google Play y la suspensión por membresía.

## Recuperación

La integración conserva temporalmente el registro privado local de Higo Driver como respaldo para solicitudes antiguas y consultas durante una incidencia.

Si la sincronización central falla antes de guardar una solicitud nueva, el formulario devuelve `admin_sync_failed` y no presenta la solicitud como completada. Esto evita solicitudes invisibles para el panel administrativo.

Para detener únicamente el ingreso de nuevas solicitudes sin deshacer la base de datos, retirar temporalmente `higo_app_ingest_secret` de Higo Driver. El portal responderá `admin_integration_not_configured` y no seguirá con el registro.

## Seguridad

- Nunca colocar service-role keys en Higo Driver ni en el navegador.
- Los reintentos del portal no pueden retroceder un estado ya administrado.
- Los documentos se cargan mediante tokens aleatorios, almacenados únicamente como hash y con vencimiento de siete días.
- Al generar un enlace nuevo, los anteriores quedan invalidados.
- Cada carga obtiene un reclamo temporal para impedir el uso simultáneo del mismo token.
- Una carga incompleta intenta eliminar sus objetos y metadatos antes de liberar el token.
- Los archivos se almacenan en un bucket privado.
- La conversión a driver usa un reclamo atómico para evitar cuentas duplicadas.
- El aspirante solo consulta un estado mínimo usando código y correo; no recibe datos internos ni documentos.
- Los administradores necesitan sesión válida, permiso `manage_drivers` y MFA cuando esté exigido.
