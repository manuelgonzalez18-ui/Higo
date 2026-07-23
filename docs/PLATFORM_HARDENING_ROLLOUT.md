# Higo — Rollout del hardening integral

Este documento controla el despliegue de las mejoras de membresías, viajes,
despacho, observabilidad y analítica del PR #100.

## Principio de seguridad

El código nuevo se despliega con todas las rutas críticas desactivadas. Las
banderas se habilitan una por una solamente después de validar su dependencia
de base de datos y su smoke test. No se deben activar varias banderas en el
mismo despliegue.

Banderas:

| Variable | Default | Función |
|---|---:|---|
| `VITE_UNIFIED_MEMBERSHIP_CHECKOUT` | `false` | Planes semanales/mensuales desde `driver_membership_plans` y Banesco v2 |
| `VITE_SERVER_SIDE_RIDE_PRICING` | `false` | Cotización, promoción y creación idempotente del viaje en RPC |
| `VITE_SERVER_SIDE_RIDE_STATE` | `false` | Acciones del conductor mediante máquina de estados RPC |
| `VITE_DIRECTED_RIDE_OFFERS` | `false` | Ofertas dirigidas en lugar de fan-out global de solicitudes |
| `VITE_SHOP_ENABLED` | `false` | Higo Shop, fuera del rollout actual |

## Orden de migraciones

Aplicar en staging, en este orden:

1. `20260724100000_platform_finance_and_ride_hardening.sql`
2. `20260724101000_driver_onboarding_membership_reconciliation.sql`
3. `20260724102000_ride_creation_price_floor.sql`
4. `20260724102100_ride_quote_subtotal_floor.sql`
5. `20260724103000_membership_payment_suspension_guard.sql`
6. `20260724103100_membership_payment_guard_binding.sql`
7. `20260724104000_ride_transition_guard.sql`
8. `20260724105000_directed_ride_offers.sql`
9. `20260724105100_ride_offer_acceptance_guard.sql`
10. `20260724106000_platform_event_analytics.sql`
11. `20260724106100_platform_funnel_db_facts.sql`

No aplicar estas migraciones directamente en producción antes de que el mismo
SHA haya pasado Quality Gate, Vercel y staging.

## Preflight

Antes de migrar:

```sql
select
  to_regclass('public.rides') as rides,
  to_regclass('public.profiles') as profiles,
  to_regclass('public.driver_memberships') as driver_memberships,
  to_regclass('public.driver_membership_plans') as membership_plans,
  to_regclass('public.payment_reports') as payment_reports,
  to_regclass('public.promo_codes') as promo_codes,
  to_regprocedure('public.admin_get_context()') as admin_context,
  to_regprocedure('public.higo_is_admin()') as is_admin;
```

Todos los valores deben ser distintos de `null`.

Tomar un respaldo lógico y registrar:

```sql
select now() as backup_started_at,
       count(*) as rides from public.rides;
select count(*) as memberships from public.driver_memberships;
select count(*) as payment_reports from public.payment_reports;
```

## Smoke tests por fase

### A. Código desplegado, banderas apagadas

- Login pasajero, driver y administrador.
- Solicitar y completar un viaje con el flujo vigente.
- Abrir Higo Pay y comprobar que el método vigente sigue disponible.
- Confirmar que Shop no aparece.
- Revisar `client_errors` durante 30 minutos.

### B. Membresías unificadas

Activar solo:

```text
VITE_UNIFIED_MEMBERSHIP_CHECKOUT=true
```

Validar con un driver de cada tipo:

- Moto ve Moto semanal y Moto mensual.
- Carro ve Carro semanal y Carro mensual.
- Camioneta ve Camioneta semanal y Camioneta mensual.
- El monto Bs corresponde al plan elegido, no a `vehicle_model`.
- Una referencia Banesco solo puede utilizarse una vez.
- Renovar una membresía vigente extiende desde el vencimiento actual.
- Un pago no elimina una suspensión disciplinaria.
- El admin puede registrar una membresía manual y queda auditada.

### C. Precio y promociones server-side

Activar además:

```text
VITE_SERVER_SIDE_RIDE_PRICING=true
```

Validar:

- Viaje sin promo.
- Viaje con parada.
- Envío con tarifa adicional.
- Promo porcentual y fija.
- Promo vencida, agotada, por usuario y por presupuesto.
- Doble toque o timeout crea un solo viaje (`client_request_id`).
- El subtotal almacenado nunca es menor que el mostrado al pasajero.
- El descuento se recalcula sobre ese subtotal y actualiza presupuesto/uso en la misma transacción.

### D. Máquina de estados

Activar además:

```text
VITE_SERVER_SIDE_RIDE_STATE=true
```

Validar:

- Dos drivers intentan aceptar el mismo viaje; solo uno gana.
- Driver suspendido o sin membresía no acepta viajes.
- No se puede completar antes de iniciar.
- Llegada y espera sobreviven al reinicio de la app.
- Envíos requieren POD y confirmación COD cuando aplique.
- Pasajero solo cancela en `requested` o `accepted` con motivo.
- `ride_state_events` contiene una sola entrada por transición.

### E. Ofertas dirigidas

Activar al final:

```text
VITE_DIRECTED_RIDE_OFFERS=true
```

Validar con al menos tres dispositivos:

- Solo reciben la solicitud drivers online, cercanos y compatibles.
- Un driver sin membresía no recibe ofertas.
- Al aceptar, las demás ofertas pasan a `withdrawn`.
- Un viaje sin oferta queda visible para Operaciones y puede redistribuirse.
- Medir batería, uso de datos y tiempo de aceptación durante 48 horas.

## Observabilidad

Consultas de control:

```sql
select event_name, count(*)
from public.platform_events
where created_at >= now() - interval '24 hours'
group by event_name
order by count(*) desc;

select from_status, to_status, count(*)
from public.ride_state_events
where created_at >= now() - interval '24 hours'
group by from_status, to_status
order by count(*) desc;

select public.admin_platform_funnel(7);
```

Alertas manuales durante el rollout:

- `ACTIVATION_FAILED` en Banesco.
- `invalid_ride_transition`.
- `payment_reference_already_used` fuera de duplicados reales.
- aumento de `client_errors` por ruta.
- viajes `requested` por más de 10 minutos.

## Rollback

El rollback funcional es por bandera y no requiere revertir datos:

1. Desactivar la última bandera habilitada.
2. Desplegar nuevamente.
3. Confirmar el flujo legacy.
4. No borrar tablas ni columnas; las nuevas estructuras son aditivas.
5. Abrir un incidente con el SHA, hora, bandera y error observado.

Para revertir código:

```bash
git revert <sha>
git push origin main
```

Las migraciones no se revierten con `DROP` durante un incidente. Las columnas,
eventos y auditoría se conservan para diagnóstico.

## Criterio para revocar escrituras directas

Solo después de 7 días estables con las tres primeras banderas activas y ≥95%
de adopción del APK nuevo:

- revocar cambios directos críticos sobre `rides`;
- mantener exclusivamente las RPC de creación/transición/pago;
- retirar endpoints y tablas de planes legacy;
- migrar o archivar datos remanentes con un informe de conciliación.
