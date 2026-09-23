# Publicación verificable de Higo

Estado: este cambio prepara y prueba el mecanismo de entrega. **No se han publicado archivos, configurado secretos remotos de hosting ni ejecutado un rollback en Hostinger.** Supabase staging ya tiene un baseline revisado y tres migraciones nuevas; producción permanece sin estas migraciones. CI comprueba tanto el contrato histórico como la reconstrucción del esquema real. PHP y Firebase de staging requieren completar el acceso y la configuración antes de habilitar la publicación.

## Flujo y garantías

`Quality Gate` ejecuta instalación desde lockfile, lint obligatorio, suites Node/Vitest/PHP, pruebas de navegador aisladas, auditoría de dependencias y replay SQL en una base desechable. Los tests de release verifican SHA, entorno, inventario, modificación de archivos y rechazo de configuración privada. La simulación de despliegue usa SSH/SCP falsos y comprueba éxito, rollback tras fallo y conservación de una publicación posterior concurrente. En Windows modela enlaces y locks; Linux CI utiliza las primitivas reales del sistema de archivos.

`Verified release` es manual y requiere que Quality Gate termine correctamente en el mismo commit. Su entorno predeterminado es `staging`; `deploy_web` y `build_android` están desactivados por defecto. Construye una sola vez, genera `release.json` y ejecuta Playwright contra ese artefacto con servicios externos interceptados. Después conserva el artefacto por SHA. Web y Android descargan ese mismo artefacto y verifican sus hashes, entorno y SHA; ninguno recompila el frontend. La versión web y la versión/code de Android se registran por separado en el manifiesto.

Los antiguos workflows de compilación por versión, hotfix que reescribían `main`, FTP y diagnóstico con credenciales se retiraron. La publicación de otro repositorio, incluido Higo-Driver, no forma parte de este flujo. Se conserva el código de `higodriver/` y su validación PHP.

## Configurar los GitHub Environments

Crear `staging` y `production`, con credenciales y proyectos independientes. Restringir `production` a `main` y aplicar la protección de entorno del equipo. El workflow también rechaza una publicación de producción desde otra rama.

Variables por entorno:

| Variable | Valor / requisito |
|---|---|
| `VITE_API_BASE_URL` | Origen HTTPS de PHP, sin ruta ni barra final. |
| `VITE_SUPABASE_URL` | Origen del proyecto Supabase correspondiente. |
| `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Configuración pública del proyecto Firebase de ese entorno. |
| `VITE_DIRECTED_RIDE_OFFERS` | `false` inicialmente. |
| `LAUNCH_DATABASE_READY` | `true` solo después de reconciliar/aplicar/validar las migraciones y revisar permisos del entorno real. Ausente o falso bloquea la compilación de release. |
| `DIRECTED_DISPATCH_READY` | `true` solo tras validar RPC, webhooks, tareas y notificaciones de despacho. Obligatoria si se activa despacho dirigido. El servidor conserva su control de disponibilidad. |
| `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_ROOT` | SSH y raíz absoluta de versiones; puerto predeterminado 22. La raíz acepta letras, números, guiones, guiones bajos y barras. |
| `PUBLIC_BASE_URL` | Origen HTTPS que sirve `current`, sin ruta. |

Secretos por entorno:

- `VITE_SUPABASE_ANON_KEY`: únicamente clave publicable/anon; nunca `service_role`.
- `VITE_GOOGLE_MAPS_API_KEY`, `VITE_FIREBASE_API_KEY`, `VITE_FCM_VAPID_KEY`: valores públicos del frontend almacenados como secretos para limitar su distribución. La clave Maps debe estar configurada para los orígenes autorizados de web y WebView de este artefacto; comprobarlo en dispositivos físicos.
- `DEPLOY_SSH_KEY`: clave de un usuario limitado a la instalación de Higo.
- `DEPLOY_KNOWN_HOSTS`: entrada obtenida y verificada por un canal administrativo independiente. Para un puerto distinto de 22, usar la entrada `[host]:puerto`. No generar confianza automática con `ssh-keyscan` durante el despliegue.
- Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_GOOGLE_SERVICES_JSON` (contenido JSON, no base64). El proyecto Firebase nativo debe coincidir con `VITE_FIREBASE_PROJECT_ID`; se comprueba antes de compilar. La clave de firma se elimina al finalizar el job.

El workflow proporciona `VITE_APP_ENV` y `VITE_GIT_SHA`. Las banderas de Shop/precios/estados/membresías/MFA se fijan en el perfil compartido del código. No copiar banderas antiguas a los workflows. Los tests usan localhost; nunca completar sus variables con credenciales de producción.

## Preparar PHP y el hosting

Requisitos del host: SSH verificado, Bash, `tar`, `sha256sum`, `flock`, `readlink`, GNU `mv -T`, soporte de enlaces simbólicos y PHP con cURL. Confirmar que el plan de Hostinger permite fijar el document root a un enlace y que Apache/PHP sigue ese enlace. Si el hosting no lo permite, este despliegue permanece bloqueado hasta disponer de un host compatible.

Estructura que debe provisionar el operador, fuera del document root actual:

```text
/home/usuario/higo/
  releases/
    initial-verified/        # copia completa y validada de la versión anterior
  shared/
    private/higo-banesco.php
    api/                    # opcional: archivos privados API requeridos
  current -> /home/usuario/higo/releases/initial-verified
```

`current` debe existir como enlace absoluto hacia una versión con `index.html`. Se exige una versión previa conocida para poder revertir incluso el primer despliegue automatizado. Apuntar el document root del sitio a `current`. No introducir datos de usuarios dentro de las carpetas de versiones.

Configurar **en el proceso PHP/FPM** `HIGO_BANESCO_CONFIG=/home/usuario/higo/shared/private/higo-banesco.php`. No confiar en el descubrimiento relativo del archivo: al introducir carpetas de versiones cambia la ruta física de `__DIR__`. El archivo debe retornar un array PHP e incluir la configuración bancaria existente y, para estas funciones, `SUPABASE_PROJECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_ROUTES_SERVER_KEY` y `HIGO_PUBLIC_API_BASE_URL`. Usar origen HTTPS explícito para el último; nunca derivarlo del encabezado Host. La clave Google Routes es privada del servidor y requiere Routes API habilitada; no reutilizar la clave pública del frontend.

Mantener credenciales bancarias, service-role, FCM y SMTP fuera del árbol público. Configurar rutas absolutas de registros y credenciales que sobrevivan a un cambio de versión. `shared/api` permite conservar archivos privados como `_smtp_config.php` o `.user.ini` cuando la instalación existente los requiere; el script los enlaza únicamente si no colisionan con código del artefacto. No colocar endpoints ni copias de `_cors.php` o `_ratelimit.php` allí. Proteger su acceso HTTP y sus permisos de lectura.

Configurar `HIGO_TRUSTED_PROXY_IPS` en PHP solo con IPs concretas de proxies administrados; vacío utiliza la IP de la conexión. El directorio temporal de PHP debe permitir escritura y bloqueo de archivos para el limitador. Staging debe usar proyecto Supabase/Storage y Firebase separados, usuarios sintéticos y un proveedor bancario simulado, sin capacidad de enviar pagos/notificaciones a personas reales. Ensayar CORS desde la web y la WebView del entorno.

## Activación y reversión

1. Reconciliar el esquema real y respaldar datos/configuración. Validar migraciones, permisos por rol, Storage, tareas/webhooks, cotización y notificaciones en staging. Solo entonces establecer `LAUNCH_DATABASE_READY=true` en ese entorno.
2. Ejecutar `Verified release` en `staging` con ambas acciones desactivadas para revisar el artefacto y los reportes. Revisar `release.json`, versiones y SHA.
3. Tras provisionar el host, ejecutar con `deploy_web=true`. El script verifica todo el inventario local, autentica SSH, crea una carpeta nueva, verifica el archivo transferido, extrae todos los archivos y cambia `current` mediante un único rename bajo lock.
4. La comprobación pública verifica bytes de `release.json`, `index.html` y los JS/CSS de entrada contra los hashes del artefacto. Si falla, restaura la versión anterior solo si `current` todavía apunta a esta publicación. Si otro despliegue la sustituyó, falla sin sobrescribirlo. El fallo permanece visible en Actions.
5. Para generar Android, activar `build_android=true` y validar el APK en al menos tres dispositivos, con segundo plano, permisos, señal débil y proyecto Firebase correcto. El workflow genera artefactos; no los sube a Play Store.
6. Repetir las validaciones y el procedimiento en `production` desde `main` tras el piloto. No marcar `LAUNCH_DATABASE_READY` por el mero éxito del fixture de CI.

Una reversión manual debe seleccionar un directorio completo existente bajo `DEPLOY_ROOT/releases`, adquirir `DEPLOY_ROOT/.deploy.lock`, crear un enlace temporal al destino y renombrarlo atómicamente sobre `current` con `mv -Tf`. Verificar después su manifiesto público y la función afectada. El rollback de archivos **no revierte migraciones ni operaciones de negocio**; las migraciones deben conservar compatibilidad con la versión anterior. Las versiones viejas no se borran automáticamente. Conservar al menos la versión actual y la anterior hasta cerrar el piloto.

## Auditoría programada

`Security audit` ejecuta Quality Gate y auditoría npm incluyendo dependencias de compilación. Los fallos quedan rojos y conservan su reporte como artefacto; no se hacen sondeos de producción ni se publican issues.

La revisión por IA queda desactivada mientras `ENABLE_AI_AUDIT` no sea `true`. Para habilitarla hacen falta `AI_AUDIT_MODEL` con un modelo disponible en la cuenta y `ANTHROPIC_API_KEY`. Envía una selección acotada de archivos versionados al proveedor, sin herramientas de ejecución, y guarda un reporte privado del workflow. No reemplaza los controles deterministas. Una respuesta vacía, truncada, rechazada o un fallo del proveedor hace fallar el job y declara la revisión incompleta. Revisar las notificaciones de fallos de Actions del repositorio; no hay mensajes automáticos a terceros.
