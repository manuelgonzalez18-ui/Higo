# Higo Pricing V4 — operación y lanzamiento

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
- Si coinciden varias reglas, el motor devuelve el multiplicador más alto y
  Pricing V4 lo limita por vehículo y por configuración general.
- El tope inicial es `1.30x`.
- Cada viaje guarda el desglose completo en `rides.pricing_snapshot` y una fila
  analítica en `pricing_quote_audit`.
- La cotización y la creación del viaje se verifican en el servidor.

## Estado de prelaunch

Higo todavía no se ha lanzado al público. Por esa razón, Pricing V4 queda en
`active` para todos los viajes nuevos y no necesita pasar primero por sombra o
piloto. Web y Android usan cotización autoritativa del servidor por defecto.

La activación no inventa importes comerciales ni aumenta automáticamente los
precios existentes:

- `mode = active`
- `per_minute = 0` hasta que el administrador defina el valor comercial
- `minimum_fare = base`
- `included_km = 1`
- `free_wait_minutes = 3`
- `maximum_multiplier = 1.30`

Así, toda la arquitectura V4 queda funcionando desde las pruebas de prelaunch,
pero el precio continúa equivalente al modelo vigente hasta editar los valores
desde `/admin/pricing`.

## Modos disponibles

| Modo | Comportamiento |
|---|---|
| `legacy` | Cobra únicamente la fórmula anterior. |
| `shadow` | Calcula ambos modelos y cobra el anterior. |
| `pilot` | Aplica V4 a un porcentaje determinístico de pasajeros. |
| `active` | Aplica V4 a todos los viajes nuevos. Es el estado de prelaunch. |

## Operación antes del lanzamiento

1. Ejecutar viajes reales de prueba con moto, carro y camioneta.
2. Revisar el desglose de base, distancia, tiempo, paradas y extras.
3. Definir desde `/admin/pricing` la tarifa mínima y el precio por minuto de cada vehículo usando costos reales.
4. Confirmar que promociones, espera, Higo Envíos y multiplicadores respetan sus límites.
5. Mantener el multiplicador máximo en `1.30x` durante el lanzamiento inicial.
6. Para rollback inmediato, seleccionar `legacy` o `shadow` en el panel administrativo.
