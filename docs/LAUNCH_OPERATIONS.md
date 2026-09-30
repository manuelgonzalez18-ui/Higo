# Operación y aceptación del piloto

Este procedimiento está preparado para el equipo. Los ensayos descritos deben
registrarse; su inclusión aquí no significa que ya se hayan ejecutado.

## Preparación y responsables

Asignar una persona responsable de soporte, una de incidentes y una de despliegue,
con sustitutos y un canal de contacto verificado. Registrar fecha, SHA, versión
Android, proyecto Supabase, dominio PHP y resultado de la última restauración.
Usar usuarios sintéticos y pagos simulados hasta habilitar expresamente el piloto.
No guardar claves, teléfonos, direcciones completas ni tokens en las actas compartidas.

## SOS

1. Abrir el evento y registrar su identificador y el viaje asociado. Revisar fuente
   de ubicación, precisión y antigüedad; una posición en caché no es una ubicación actual.
2. Atender según el protocolo local de emergencias del equipo y contactar al usuario
   por el canal autorizado. No esperar al GPS mejorado para reconocer la alerta.
3. La mejora posterior de GPS debe conservar el evento original y agregar su nueva
   marca temporal. Registrar quién atiende, acciones, escalamiento y cierre.
4. Si el panel o la red fallan, conservar el identificador para reconciliar la atención
   al restablecerse el servicio; no dar por resuelto un SOS por ausencia de nuevas señales.

## Reclamos y pagos

Preservar los POD originales y usar archivos de reclamo separados. Verificar actor,
etapa, fecha, pertenencia y estado del envío. Registrar toda resolución administrativa
con motivo; nunca reemplazar la evidencia para corregir una disputa. Revocar un enlace
de seguimiento si fue compartido indebidamente, sin borrar la evidencia del caso.

Antes de repetir una activación, consultar el estado real de la referencia bancaria
y del identificador idempotente. Una respuesta tardía no prueba que el pago falló.
Una corrección manual exige permiso administrativo y registro de auditoría; comprobar
que no elimine una suspensión disciplinaria ni duplique el período de membresía.

## Eliminación de cuentas

Verificar identidad mediante la sesión y el procedimiento de soporte. Comprobar viajes,
pagos y reclamos abiertos antes de ejecutar la eliminación existente. Registrar el
resultado, revocar sesiones/tokens y comprobar el tratamiento de archivos y proveedores
externos. El equipo debe definir la retención de registros que correspondan; este cambio
no introduce borrados masivos ni fija plazos legales. Ensayar con cuentas sintéticas.

## Respaldo y restauración

Antes de cualquier migración, identificar el respaldo, su fecha y la versión del esquema.
Restaurarlo en una instancia aislada sin webhooks, correos, push ni pagos reales. Validar
funciones, permisos por rol, relaciones y recuentos agregados; restaurar/verificar Storage
por separado. Registrar duración y pérdida de datos máxima observada. Conservar el
respaldo hasta cerrar el período de observación. Un respaldo creado sin ensayo de
restauración no satisface la condición de salida.

## Reversión de aplicación

Seguir [RELEASE_DEPLOYMENT.md](./RELEASE_DEPLOYMENT.md). Elegir un artefacto anterior
verificado y compatible con las migraciones activas, cambiar `current` bajo lock y
probar login, cotización y lectura de viaje. Una reversión del frontend no restaura
permisos SQL revocados ni deshace cobros; si el cliente anterior necesita escrituras
revocadas, mantener fuera de servicio el flujo afectado mientras se publica una corrección.

## Mediciones

Correlacionar `ride.requested`, `ride.accepted`, `ride.completed`, errores de pago y
notificaciones por ride ID, SHA y entorno. Usar las tablas de viajes/pagos como fuente
para el conteo financiero; los eventos del cliente pueden repetirse o faltar. Separar
intento de push, aceptación por proveedor y recepción en dispositivo. No declarar
entregado un push únicamente porque el proveedor respondió 200.

Revisar al inicio y al final de cada turno: solicitudes sin asignación, viajes abiertos
anormalmente, cotizaciones fallidas, referencias pendientes, POD rechazados y SOS abiertos.
Toda alerta debe tener dueño, umbral acordado y acción; revisar su eficacia durante el piloto.

## Matriz mínima: 48 horas, tres Android físicos

Registrar por caso: dispositivo/Android, red, SHA, actor sintético, ride ID, hora,
resultado esperado, resultado observado y evidencia del defecto. El registro comienza
vacío; no completar casos por inferencia a partir de tests unitarios.

| Grupo | Casos mínimos |
|---|---|
| 30 viajes completos | Moto/carro/camioneta; creación, aceptación, pago, reintento y recuperación. |
| 20 envíos completos | Paga remitente/destinatario; con/sin COD; POD de recogida y entrega; destinatario sin sesión. |
| Concurrencia adicional | Dos conductores aceptan; doble toque y timeout al crear; referencia bancaria duplicada. |
| Red y ciclo de vida | Cobertura débil, modo avión, segundo plano, cierre y reapertura en cada estado crítico. |
| Identidad | Registro, correo, recuperación de clave, permisos GPS/notificaciones denegados y luego concedidos. |
| Seguridad | Lectura/escritura ajena, membresía vencida/suspensión, POD inexistente/ajeno, token vencido/revocado. |
| Operación | SOS con caché y mejora GPS, reclamo, eliminación sintética, restauración y reversión ensayadas. |

Las cancelaciones y escenarios fallidos se registran además de los 50 servicios
completos. Salida pública: cero defectos abiertos de autorización, cobro, asignación
única o integridad de evidencia; checks críticos aprobados; dependencias graves
corregidas o justificadas; restauración y rollback demostrados. El responsable del
lanzamiento firma el registro con el SHA exacto.
