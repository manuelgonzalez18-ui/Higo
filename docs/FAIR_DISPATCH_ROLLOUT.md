# Higo — rollout del despacho equitativo progresivo

Este documento activa de forma segura el despacho por rondas que prioriza a
conductores cercanos que llevan más tiempo disponibles y han recibido menos
viajes u oportunidades recientes.

## Estado inicial seguro

La migración agrega dos banderas, ambas apagadas por defecto:

- `fair_dispatch_shadow`: calcula y guarda el ranking, pero no cambia las ofertas.
- `fair_progressive_dispatch`: crea las ofertas progresivas reales.

El despacho progresivo solo funciona cuando también está activa la bandera ya
existente `directed_ride_offers`. Aplicar la migración por sí sola no cambia la
producción.

## Reglas de elegibilidad

Un conductor entra al ranking solamente si:

- está online y su GPS tiene menos de tres minutos;
- tiene membresía activa o una excepción operativa vigente;
- no está suspendido ni archivado;
- tiene el vehículo compatible;
- no tiene otro viaje activo;
- está dentro del radio de la ronda;
- todavía no recibió una oferta para el mismo viaje;
- no acumuló cinco ofertas expiradas durante los últimos 30 minutos.

## Puntuación inicial

La puntuación combina:

- hasta 40 puntos por proximidad;
- hasta 30 puntos por tiempo disponible, saturando a las dos horas;
- hasta 15 puntos por déficit de viajes completados en siete días;
- hasta 10 puntos por déficit de ofertas recibidas en 24 horas;
- hasta 5 puntos por frescura del GPS;
- penalización de hasta 10 puntos por ofertas ignoradas recientemente.

El multiplicador de equidad disminuye en las rondas posteriores para que la
última expansión priorice principalmente la posibilidad real de recoger al
pasajero rápidamente.

## Rondas predeterminadas

| Ronda | Momento | Nuevos conductores | Radio | Multiplicador de equidad |
|---|---:|---:|---:|---:|
| 1 | 0 s | 3 | 3 km | 1.00 |
| 2 | 10 s | 5 | 5 km | 0.85 |
| 3 | 20 s | 10 | 8 km | 0.60 |
| 4 | 35 s | todos los elegibles | 10 km | 0.25 |

Los conductores de rondas anteriores conservan la oferta hasta que el viaje se
acepta, se cancela o vence el despacho. Si una ronda encuentra menos candidatos
que su límite, la siguiente se ejecuta inmediatamente.

Los valores viven en `fair_dispatch_wave_config` y pueden ajustarse sin volver a
compilar la app. El radio final permanece en 10 km porque es el límite que usa
actualmente la experiencia del conductor antes de aceptar.

## Cron requerido

La migración intenta registrar este trabajo de Supabase Cron:

```sql
select cron.schedule(
  'higo-expand-progressive-dispatch',
  '5 seconds',
  'select public.higo_expand_due_dispatches(50);'
);
```

Verificar después de migrar:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'higo-expand-progressive-dispatch';
```

Si el proyecto todavía no tiene habilitada la integración Cron, habilitarla en
Supabase y crear manualmente el trabajo anterior. La función es segura mientras
la bandera está apagada: retorna sin expandir viajes.

## Webhook FCM dirigido

Crear un Database Webhook nuevo:

- Tabla: `public.ride_offers`
- Evento: `INSERT`
- URL: `https://higoapp.com/api/send-ride-offer-push.php`
- Header: `x-webhook-secret` con el valor de `RIDE_PUSH_WEBHOOK_SECRET`

El endpoint valida la oferta, el viaje, el conductor y las dos banderas antes
de enviar un único push. También registra en `ride_offers` si la notificación
fue enviada, omitida o falló.

### Requisito crítico antes de activar el modo progresivo

El webhook anterior sobre `public.rides` que llama a
`send-ride-request-push.php` transmite el viaje a todos los conductores dentro
del radio. Debe deshabilitarse antes de encender
`fair_progressive_dispatch`; de lo contrario, los pushes antiguos anularían las
rondas aunque la visibilidad y la aceptación en base de datos siguieran
protegidas.

No borrar el webhook antiguo durante el piloto. Mantenerlo desactivado para que
el rollback pueda restaurar rápidamente el comportamiento anterior.

## Secuencia de rollout

### 1. Aplicar migración con banderas apagadas

Validar:

```sql
select directed_ride_offers, fair_dispatch_shadow, fair_progressive_dispatch
from public.platform_runtime_flags
where singleton;
```

Resultado esperado para las dos nuevas banderas: `false`.

### 2. Activar modo sombra

```sql
select public.admin_set_fair_dispatch_flags(false, true);
```

Mantener el flujo vigente y recopilar candidatos durante al menos varios días.
Consultar:

```sql
select
  s.ride_id,
  s.predicted_wave,
  s.rank_position,
  s.driver_id,
  s.distance_km,
  s.score,
  r.driver_id as actual_driver_id,
  r.accepted_at
from public.fair_dispatch_shadow_candidates s
join public.rides r on r.id = s.ride_id
where s.computed_at >= now() - interval '24 hours'
order by s.ride_id desc, s.rank_position;
```

Revisar que los conductores realmente elegidos aparezcan razonablemente altos
en el ranking y que la distancia no aumente de forma perjudicial.

### 3. Preparar entrega dirigida

1. Desplegar `send-ride-offer-push.php`.
2. Crear y probar el webhook de `ride_offers`.
3. Confirmar que un INSERT de prueba actualiza `notification_status`.
4. Desactivar el webhook general de `rides`.
5. Confirmar que la app de conductor recibe ofertas por Realtime con la app
   abierta y por FCM con la app en segundo plano.

### 4. Activar piloto

La activación completa requiere primero ofertas dirigidas:

```sql
select public.admin_set_platform_runtime_flags(true);
select public.admin_set_fair_dispatch_flags(true, true);
```

Mantener sombra encendida durante el piloto facilita comparar el ranking.

### 5. Medir

```sql
select public.admin_fair_dispatch_metrics(24);
```

Vigilar especialmente:

- mediana y p90 del tiempo de aceptación;
- porcentaje de viajes aceptados;
- ofertas promedio por viaje;
- aceptación por ronda;
- cantidad de conductores distintos que reciben ofertas;
- diferencia entre el máximo y mínimo de ofertas por conductor;
- errores y omisiones en `notification_status`;
- cancelaciones posteriores a la aceptación.

## Rollback

Rollback inmediato del algoritmo, conservando ofertas dirigidas:

```sql
select public.admin_set_fair_dispatch_flags(false, false);
```

Esto devuelve los nuevos viajes al despacho dirigido anterior de una sola
ronda. Para volver completamente al fan-out antiguo:

```sql
select public.admin_set_platform_runtime_flags(false);
```

Después:

1. reactivar el webhook general de `rides`;
2. desactivar el webhook de `ride_offers`;
3. comprobar un viaje de prueba con pasajero y conductor.

No es necesario revertir la migración para ejecutar el rollback operativo.

## Consultas de diagnóstico

Despachos pendientes:

```sql
select *
from public.ride_dispatches
where status = 'active'
order by next_wave_at;
```

Ofertas de un viaje:

```sql
select
  driver_id, wave_number, rank_position, distance_km, score,
  status, notification_status, offered_at, expires_at
from public.ride_offers
where ride_id = '<ride_id>'
order by wave_number, rank_position;
```

Fallos de push recientes:

```sql
select ride_id, driver_id, wave_number, notification_error, offered_at
from public.ride_offers
where notification_status = 'failed'
  and offered_at >= now() - interval '24 hours'
order by offered_at desc;
```
