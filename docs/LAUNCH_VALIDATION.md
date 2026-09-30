# Validación del cambio — 30 de septiembre de 2026

Base revisada: `619a73ca7c72da1347498c9f92be781c015b40f8`. Resultados del árbol
de implementación en `agent/launch-readiness`. El commit validado es
`84dca8523b352bf9cbd094d91162df9338af2f44`:
[Quality Gate #535](https://github.com/manuelgonzalez18-ui/Higo/actions/runs/35932704253)
y [Ride Experience Regression #31](https://github.com/manuelgonzalez18-ui/Higo/actions/runs/35932704177)
aprobaron. Se revisaron también los pasos de reconstrucción y concurrencia.

| Comprobación | Resultado |
|---|---|
| Node (`npm run test:run`) | 90 aprobadas |
| Vitest, incluidas `src` y pruebas de componentes | 61 aprobadas |
| Playwright con Chrome y proveedores interceptados | 4 aprobadas |
| Compilación con perfil de prueba explícito | Correcta |
| ESLint completo | 0 errores, 73 advertencias |
| Auditoría npm de producción | 0 vulnerabilidades reportadas |
| PHP: sintaxis de ambos árboles, helpers y contratos HTTP | Aprobada |
| Limitador PHP concurrente | 64 intentos, exactamente 10 admitidos |
| Replay PostgreSQL | 42 migraciones aplicadas en una base vacía con fixture histórico |
| Reconstrucción real | Baseline revisado y tres migraciones nuevas en Supabase desechable; pruebas de roles aprobadas |
| SQL postdeploy, plataforma, conductor y lanzamiento | 4 suites aprobadas |
| Concurrencia SQL con sesiones bloqueadas simultáneamente | 3 escenarios aprobados tanto sobre el fixture histórico como sobre el esquema reconstruido |
| Manifiesto y verificación de artefactos | 4 pruebas aprobadas |
| Simulación local de publicación y rollback | Éxito, fallo con reversión y publicación posterior preservada |
| YAML, sintaxis de scripts y `git diff --check` | Correctos |

La concurrencia SQL verifica un ganador entre dos conductores, un solo viaje ante
dos reintentos del mismo identificador y un solo viaje activo ante identificadores
distintos del mismo pasajero. Las pruebas de componentes verifican recuperación
con Google no disponible, revisión de una tarifa renovada, recuperación al reconectar
tras arranque sin red y cobro al remitente antes de iniciar la ruta.

Entorno local: Windows, Node 24.11.1, PHP 8.3.33 y PostgreSQL 17.10 desechable.
El runner local de PostgreSQL emula únicamente las primitivas Auth/Storage necesarias;
las políticas se ejercitan con identidades no privilegiadas, pero no se ejecutan los
servicios HTTP completos de Supabase. CI prepara Supabase desechable con Docker.
La simulación de despliegue en Windows modela enlaces/locks; CI Linux usa las
primitivas reales. PHP, navegador y comprobaciones HTTP de release usan proveedores
simulados; no se realizaron cobros ni notificaciones reales.

El baseline revisado y las tres migraciones nuevas están aplicados en Supabase staging,
sin datos de usuarios ni archivos de producción. El corte de permisos sigue desactivado.
Firebase staging ya está creado y Hostinger sirve una página inicial y un estado PHP
por HTTPS. La aplicación y sus proveedores aún no están integrados en ese host.
Detalles en [STAGING_SERVICES.md](./STAGING_SERVICES.md).

No se ha probado una compilación Android en dispositivos físicos, aplicado las
migraciones en producción ni aprobado la reversión operativa en Hostinger: el ensayo
real sobre la página inicial detectó una respuesta desactualizada inmediata, aunque
el enlace y las consultas posteriores sí volvieron a la versión original. Se añadió
verificación de SHA/entorno ejecutados por PHP; sus cinco pruebas de release y lint
específico aprobaron localmente. El conjunto no equivale a completar el
piloto de 48 horas ni a aprobar un lanzamiento público. Consultar
[LAUNCH_READINESS.md](./LAUNCH_READINESS.md) para las condiciones pendientes.
