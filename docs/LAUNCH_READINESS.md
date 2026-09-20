# Estado del lanzamiento de Viajes y Envíos

Esta implementación conserva React/Vite/Capacitor, PHP, Supabase y Firebase.
El código queda preparado para validación en staging. **No constituye una
autorización de lanzamiento público ni demuestra que producción tenga estas
garantías:** las migraciones nuevas todavía deben promoverse al entorno real.

## Implementado en el repositorio

- Entorno y backend explícitos; desarrollo y pruebas no eligen producción por defecto.
  Las pruebas borran la configuración heredada de Maps/Firebase y usan servicios locales.
- Perfil común de web y Android: precio y estados por servidor, membresías unificadas,
  MFA administrativo, Shop apagado y Google como único motor de mapa empaquetado.
  Despacho dirigido requiere comprobar las dependencias y activar su control del servidor.
- Cotización PHP autenticada con Google Routes, paradas ordenadas, vigencia de cinco
  minutos y almacenamiento por usuario. Creación mediante `quote_id` y UUID idempotente;
  promoción y disponibilidad se comprueban en la transacción.
  La fórmula V4 histórica todavía impone límites de distancia y duración: una ruta
  de Google que exceda esos límites se rechaza (`route_outside_pricing_bounds`), nunca
  se recorta silenciosamente. Validar desvíos/paradas del área piloto; ampliar esa
  política económica queda pendiente si se requiere aceptar esas rutas.
- RPC para cambios de estado, cobro, valoración, evidencia y acciones administrativas.
  El propietario de la base ejecuta `higo_finalize_launch()` únicamente al cerrar la
  transición de clientes; esa operación revoca escrituras directas y creadores antiguos.
- Registro de POD con actor/fecha, archivo existente y propietario válido. Evidencias
  inmutables y archivos de reclamos en rutas separadas. Seguimiento con vencimiento,
  revocación y entrega de imágenes mediante un endpoint que revalida el token.
- Limitador PHP atómico por proceso concurrente, proxies explícitos y cuota de cotización
  por usuario además de IP. En múltiples hosts se necesita un contador compartido.
- Recuperación de estado completo del conductor al volver al primer plano o recuperar
  conectividad; una respuesta anterior no sobrescribe una cancelación nueva.
  La recuperación también se reintenta si la app arrancó sin conexión. Una solicitud
  ya creada se recupera por su UUID antes de intentar renovar una cotización vencida.
- En envíos pagados por remitente, el conductor confirma cobro en origen antes de
  iniciar la ruta; la base comprueba esa condición además de la interfaz.
- Eventos y errores con versión, SHA y entorno. `/schedule` redirige al inicio.
- Suites Node/Vitest/PHP/navegador/SQL, lint obligatorio, dependencias actualizadas,
  entrega por artefacto con hashes, SSH verificado y reversión. Auditoría determinista
  obligatoria; la revisión por IA es un complemento opcional.
- Inventario de esquema de solo lectura y comparación de objetos/permisos; CI
  conserva su captura por SHA para apoyar la conciliación con el entorno real.

Contratos: [cotización y evidencias](./QUOTE_AND_EVIDENCE_API.md).
Configuración y publicación: [guía de entrega](./RELEASE_DEPLOYMENT.md).
Procedimientos y piloto: [operación](./LAUNCH_OPERATIONS.md).

## Verificación y sus límites

El informe de entrega adjunto registra los resultados finales y el commit probado.
Las pruebas PHP y de navegador interceptan los servicios externos. Las pruebas locales
SQL usan PostgreSQL real con un modelo mínimo de Auth/Storage; CI incluye Supabase
desechable. Ninguna sustituye las pruebas de permisos sobre el esquema reconciliado,
la integración real de pagos/notificaciones o los dispositivos Android físicos.

El lint mantiene visibles las advertencias de adopción del compilador React (que no
está activado) y de dependencias de hooks. Los errores de sintaxis, variables y orden
de hooks bloquean CI. No se afirma que todas las advertencias estén resueltas.

## Conciliación pendiente del entorno real

La consulta de solo lectura encontró Higo Project (`yfgomicdcwifgeumqsvv`) activo.
El historial remoto contenía 23 migraciones hasta `20260724110000`, mientras el esquema
ya presentaba objetos posteriores de precios, despacho y solicitudes de conductor.
Se inventariaron 139 funciones públicas no pertenecientes a extensiones, 48 triggers,
259 constraints y 710 columnas. **No volver a aplicar automáticamente todo el historial.**

Antes del staging definitivo:

1. Exportar un baseline solo de esquema desde una conexión administrativa segura;
   revisar funciones, permisos, tipos, vistas, índices y triggers de Auth. No exportar
   datos de usuarios a Git. Registrar además buckets/políticas, webhooks, Cron, secretos
   por nombre (sin valores), configuración Auth y endpoints de notificación.
2. Comparar cada migración local con sus objetos reales y hashes. `migration repair`
   solo se usa cuando el efecto completo ya está verificado. La existencia de una
   función no demuestra que su cuerpo y permisos coincidan.
3. Reconstruir una instancia aislada desde ese baseline, aplicar únicamente diferencias
   pendientes y las dos migraciones nuevas. Repetir pruebas con anon, pasajero,
   conductor suspendido/activo, administrador y service role.
4. Revisar los advisors sobre `wallet_balances`, la vista materializada expuesta,
   search paths mutables y funciones privilegiadas. Un permiso EXECUTE por sí solo
   no demuestra explotación; revisar el control de identidad dentro de cada función.
   La protección Auth contra contraseñas filtradas requiere configuración del proyecto.
5. Ensayar restauración y reversión, y solo entonces marcar `LAUNCH_DATABASE_READY`.

El fixture `platform_base_fixture.sql` sigue siendo un contrato de CI, **no el baseline
de producción**. El inventario no incluye datos personales. La comparación ampliada,
el proyecto creado y el bloqueo de exportación se detallan en
[SCHEMA_RECONCILIATION.md](./SCHEMA_RECONCILIATION.md).

## Condiciones externas todavía pendientes

- Higo Staging (`oiszcfmuxfihcullioou`) ya está creado y activo, con coste autorizado
  de US$10/mes. Quedan cargar el esquema reconciliado y aprovisionar PHP/Firebase
  aislados. La base de staging todavía no contiene relaciones de la aplicación.
- Configurar claves privadas de servidor, dominios/CORS, credenciales SSH y GitHub
  Environments. Verificar pagos simulados y entrega de notificaciones en staging.
- Validar y aplicar el corte de permisos después de migrar todos los consumidores,
  incluidos APK anteriores. Las versiones antiguas dejarán de escribir al cerrar el corte.
- Compilar y probar Android; incrementar versionCode/versionName antes de una nueva
  publicación en Play. El manifiesto distingue la versión web de la nativa.
- Ejecutar el piloto físico de 48 horas y registrar defectos, restauración y rollback.

Optimización posterior permitida por el plan: reducir la fuente de iconos (aprox.
3,83 MB) y continuar la separación de lógica de chat/ubicación. El fragmento Mapbox
de aprox. 1,81 MB ya queda fuera del artefacto del lanzamiento.
