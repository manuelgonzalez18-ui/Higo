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

## Migración requerida

Aplicar únicamente después de revisar el PR:

```text
supabase/migrations/20260724110000_driver_application_admin_integration.sql
```

La migración crea:

- `driver_applications`
- `driver_application_documents`
- `driver_application_upload_tokens`
- `driver_application_events`
- bucket privado `driver-applications`
- políticas RLS y funciones RPC administrativas

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

## Orden seguro de despliegue

1. Fusionar y desplegar Higo App.
2. Aplicar `20260724110000_driver_application_admin_integration.sql` en Supabase.
3. Configurar `DRIVER_APPLICATION_INGEST_SECRET` en higoapp.com.
4. Confirmar que `https://higoapp.com/api/driver-applications-ingest.php` responde `method_not_allowed` al abrirlo por GET. Esto confirma que el endpoint existe sin revelar información.
5. Configurar `higo_app_ingest_secret` en higodriver.com.
6. Fusionar y desplegar Higo Driver.
7. Purgar caché de Hostinger.
8. Realizar un único pre-registro de prueba.
9. Confirmar que aparece en `#/admin/driver-applications`.
10. Probar el flujo completo con datos de prueba controlados:
    - iniciar revisión;
    - solicitar documentos;
    - cargar archivos no sensibles de prueba;
    - aprobar o solicitar corrección;
    - aprobar la solicitud;
    - registrar el driver;
    - confirmar el correo de bienvenida y la suspensión por membresía.

## Recuperación

La integración conserva temporalmente el registro privado local de Higo Driver como respaldo para solicitudes antiguas y consultas durante una incidencia.

Si la sincronización central falla antes de guardar una solicitud nueva, el formulario devuelve `admin_sync_failed` y no presenta la solicitud como completada. Esto evita solicitudes invisibles para el panel administrativo.

Para detener únicamente el ingreso de nuevas solicitudes sin deshacer la base de datos, retirar temporalmente `higo_app_ingest_secret` de Higo Driver. El portal responderá `admin_integration_not_configured` y no seguirá con el registro.

## Seguridad

- Nunca colocar service-role keys en Higo Driver ni en el navegador.
- Los documentos se cargan mediante tokens aleatorios, almacenados únicamente como hash y con vencimiento de siete días.
- Cada token se invalida después de una carga exitosa.
- Los archivos se almacenan en un bucket privado.
- El aspirante solo consulta un estado mínimo usando código y correo; no recibe datos internos ni documentos.
- Los administradores necesitan sesión válida, permiso `manage_drivers` y MFA cuando esté exigido.
