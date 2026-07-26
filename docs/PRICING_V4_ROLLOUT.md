# Higo Pricing V4 — operación y rollout

## Fórmula

```text
subtotal_modelo = max(
  tarifa_mínima,
  (
    tarifa_base
    + max(0, km_ruta - km_incluidos) × precio_por_km
    + minutos_estimados × precio_por_minuto
    + paradas × cargo_por_parada
    + extras_del_servicio
  ) × multiplicador
)

precio_final = subtotal_cobrado - promoción_válida
```

La espera en el punto de recogida permanece separada. Se cobra después de
`free_wait_minutes` usando `wait_per_min`.

## Seguridad comercial

- La tarifa mínima es un piso, no un cargo adicional.
- El tiempo proviene del proveedor de rutas y está limitado contra inflación.
- Si coinciden varias reglas, el motor legado devuelve el multiplicador más
  alto; Pricing V4 lo limita por vehículo y por rollout.
- El tope inicial recomendado es `1.30x`.
- Pricing V4 nunca reduce el subtotal legado durante el rollout.
- Cada viaje guarda el desglose completo en `rides.pricing_snapshot` y una fila
  analítica en `pricing_quote_audit`.

## Modos

| Modo | Comportamiento |
|---|---|
| `legacy` | Cobra únicamente la fórmula anterior. |
| `shadow` | Calcula ambos modelos y cobra el anterior. Es el valor inicial. |
| `pilot` | Aplica V4 a un porcentaje determinístico de pasajeros. |
| `active` | Aplica V4 a todos los viajes nuevos. |

## Secuencia recomendada

1. Mantener `shadow` durante al menos 7 días o hasta reunir una muestra útil.
2. Configurar `per_minute`, `minimum_fare` y límites desde `/admin/pricing`.
3. Revisar diferencia media, porcentaje de cotizaciones que suben, aceptación,
   cancelación, tiempo hasta aceptación y reclamos.
4. Activar `pilot` en 10–20 %, con multiplicador máximo de 1.20–1.30.
5. Ampliar gradualmente. Usar `active` solo después de confirmar los indicadores.
6. Para rollback inmediato, seleccionar `legacy` o `shadow` en el panel.

## Valores de despliegue

La migración comienza sin alterar precios:

- `mode = shadow`
- `per_minute = 0`
- `minimum_fare = base`
- `included_km = 1`
- `free_wait_minutes = 3`
- `maximum_multiplier = 1.30`

Los valores comerciales definitivos deben definirse con datos reales de costos,
aceptación y duración por vehículo y zona.
