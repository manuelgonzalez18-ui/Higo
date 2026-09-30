# Servicios de staging — 30 de septiembre de 2026

| Componente | Identificador | Estado comprobado |
|---|---|---|
| Supabase | `oiszcfmuxfihcullioou` | Esquema restaurado y tres migraciones; corte de permisos desactivado |
| Firebase | `higo-staging-202609` | Creado sin vincular facturación; acceso CLI renovado |
| Firebase Web | `1:102756517802:web:3428e1e775c36f6ae80dd3` | Aplicación activa y configuración descargada |
| Firebase Android | `1:102756517802:android:be2e1a7c025d526fe80dd3` | Activa para `com.higoapp.ve`; configuración descargada |
| Hostinger | `https://staging.higoapp.com` | Subdominio en alojamiento existente; HTTPS válido |
| PHP | `https://staging.higoapp.com/api/health.php` | HTTP 200, JSON, PHP 8.3/cURL; `application_ready=false` |

`.firebaserc` contiene el alias `staging`. Incluir `--project higo-staging-202609`
en cada comando; el proyecto predeterminado existente es producción. Los archivos
SDK están fuera del repositorio, en `work/firebase-staging` del workspace. No se
sustituyó el `google-services.json` de producción ni se creó una clave de administrador.
Android usa el paquete actual; todavía no hay variante con sufijo para instalación
simultánea. Usar dispositivos/perfiles de prueba separados hasta definirla.

## Hosting preparado

Se verificó SSH con una clave existente y `StrictHostKeyChecking=yes`, usando la
identidad del servidor ya guardada. No se cambió la contraseña ni se agregaron permisos.
El servidor dispone de Bash, tar, sha256sum, flock, readlink y PHP/cURL.

```text
/home/u841591024/higo-staging/
  releases/bootstrap-20260930/
    index.html
    .htaccess
    api/health.php
  shared/private/                 # permisos 0700; todavía sin secretos
  shared/api/
  current -> /home/u841591024/higo-staging/releases/bootstrap-20260930

/home/u841591024/domains/higoapp.com/public_html/higo-staging
  -> /home/u841591024/higo-staging/current
```

La plantilla original se conserva en `higo-staging.hostinger-bootstrap` junto al
document root nuevo. Se comprobó que existe y que el enlace sirve HTML y PHP por
HTTPS. Solo está publicada una pantalla de preparación; no es una release aprobada.

El script de preparación terminó con un error en una línea vacía CR añadida por la
tubería PowerShell, después de crear los enlaces. Las comprobaciones independientes
posteriores verificaron enlaces, HTTP 200, ejecución PHP y preservación de la plantilla.
No se repitió el aprovisionamiento sobre el directorio existente.

El ensayo real de cambio/reversión sirvió `rollback-check-20260930`, restauró el
enlace original, pero la comprobación HTTP inmediata todavía recibió la versión
de prueba. Consultas posteriores desde el host y desde el cliente sirvieron la
original. La causa exacta no está confirmada; no se considera aprobada la reversión
inmediata. Se conserva la versión de prueba para diagnóstico. No reiniciar PHP de
toda la cuenta: podría afectar los otros sitios alojados.

Este hallazgo motivó `api/release-health.php`, generado con SHA y entorno literales
del artefacto. La comprobación de release ahora exige que PHP ejecute esa versión;
rechaza versiones antiguas, entorno incorrecto, PHP sin ejecutar y HTTP no exitoso.
La configuración de caché/procesos del hosting debe resolverse y volver a ensayarse
antes de autorizar la publicación. Referencias:
[caché de rutas PHP](https://www.php.net/manual/en/ini.core.php) y
[configuración OPcache](https://www.php.net/manual/en/opcache.configuration.php).

## Integración pendiente

- El usuario eligió preparar primero servicios simulados. No vincular facturación
  ni habilitar consumo real de Google para estas pruebas.
- Google Routes/Maps real, cuando se autorice: claves separadas y restringidas;
  verificar facturación y presupuesto antes de generar costes.
- Firebase: FCM del servidor, VAPID, webhooks y dispositivos sintéticos.
- PHP: configuración privada de Supabase staging, CORS y pagos simulados. Todavía
  no se cargó `higo-banesco.php` ni ningún endpoint de cobro.
- GitHub Environment `staging`, artefacto verificado y recorrido completo de pruebas.
  No activar `LAUNCH_DATABASE_READY` por la sola existencia del host.
- Verificar acceso a privados, aislamiento, restauración y reversión de una release real.

El panel del sitio principal Hostinger muestra implementación automática desde GitHub
`main`. Ese mecanismo debe conciliarse con el workflow de release antes de promover
el PR, porque podría publicar sin pasar por el nuevo circuito. No se modificó la
configuración de despliegue del sitio principal durante este aprovisionamiento.

## Banco privado de proveedores simulados

`npm run test:php` ejecuta los endpoints reales de cotización, evidencias, validación
bancaria y notificación de hitos contra respuestas sintéticas. Solo sustituye el
transporte HTTP en una copia temporal: la aplicación publicada no tiene un interruptor
de simulación ni acepta cabeceras de pruebas. El router exige PHP CLI server y
conexiones de loopback. La clave RSA se genera para cada ejecución, no pertenece a
ninguna cuenta y se elimina junto con la copia temporal. Las rutas inesperadas fallan
en lugar de contactar al proveedor real.

La separación de `banesco-http.php` conserva las funciones cURL usadas en producción.
Ambos consumidores de la caché BCV usan `sys_get_temp_dir()`, permitiendo aislar su
directorio por entorno y evitando que las pruebas consuman la caché de otro sitio.

Los escenarios bancarios cubren monto insuficiente frente al precio del servidor,
falla/timeout/respuesta inválida del banco, referencia repetida, conflicto al registrar,
fallo de activación y reintento tras éxito. Los de FCM cubren identidad del conductor,
estado real del viaje, ausencia de destinatario, fallo temporal, token inválido,
reintento y deduplicación después de éxito. Estos stubs no sustituyen las pruebas
SQL de concurrencia ni demuestran envío real de mensajes.

El paquete privado se preparó en
`/home/u841591024/higo-staging/checks/simulated-20260930`, fuera del document root.
En Windows las pruebas completas aprobaron. En Hostinger, PHP CLI 8.3 inicia el
servidor temporal pero Node 22 recibe `ECONNREFUSED` contra su puerto en 127.0.0.1.
El proceso permanece activo hasta que el runner lo cierra. No se abrió el servidor
a interfaces públicas ni se modificaron restricciones del alojamiento. Esa ejecución
remota sigue fallida; CI y la ejecución local conservan las comprobaciones HTTP.
