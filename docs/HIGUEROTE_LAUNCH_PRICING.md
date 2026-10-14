# Higo — calibración de tarifas para lanzamiento en Higuerote

## Objetivo

Definir tarifas de lanzamiento que cumplan simultáneamente tres condiciones:

1. El pasajero percibe un precio competitivo y transparente frente al transporte independiente de Higuerote.
2. El conductor obtiene una economía sostenible y suficiente para preferir aceptar viajes en Higo.
3. Higo no crea una guerra de precios innecesaria en un mercado donde todavía no operan plataformas de ride-hailing comparables.

## Principio de decisión

La referencia principal es el **mercado local de Higuerote**, no Yango, Ridery o Yummy en otras ciudades. Esas plataformas sirven como referencia de producto y marketplace, pero no como ancla automática de precio.

Higo debe intentar ganar por conveniencia, disponibilidad, seguridad, trazabilidad y mejor economía del conductor, no únicamente por ser más barato.

## Categorías

- Moto
- Carro
- Camioneta de pasajeros

La clave técnica `van` se mantiene por compatibilidad con la base de datos, pero comercialmente significa **Camioneta de pasajeros**. Pickup/carga queda fuera de esa categoría.

## Datos a levantar

Para cada ruta de la lista oficial/local registrar:

| Campo | Descripción |
|---|---|
| Origen | Punto o zona de salida |
| Destino | Punto o zona de llegada |
| Tarifa local | Precio publicado/acordado |
| Distancia real | Km de ruta |
| Duración normal | Minutos estimados |
| Duración pico | Minutos estimados en alta demanda |
| Higo Moto | Cotización simulada |
| Higo Carro | Cotización simulada |
| Higo Camioneta | Cotización simulada |
| Diferencia % | Higo vs tarifa local |
| Observación conductor | ¿Aceptaría este viaje? |
| Observación pasajero | ¿Le parece razonable? |

## Muestra mínima antes de fijar tarifas

- 10 rutas cortas.
- 10 rutas medias.
- 10 rutas largas o periféricas.
- Al menos 5 escenarios con tráfico/espera relevante.
- Consultar a conductores activos, no solo a pasajeros.

## Métricas de aceptación

No aprobar una tarifa solo porque "se ve barata". Revisar:

- ingreso bruto por hora del conductor;
- ingreso por km;
- km/minutos hasta recoger al pasajero;
- tasa de aceptación;
- tasa de cancelación;
- tiempo hasta asignación;
- recurrencia del pasajero;
- renovación de membresía.

## Política de lanzamiento

1. Mantener `per_minute = 0` durante la calibración inicial.
2. Carro y Camioneta comparten exactamente la misma tarifa de viaje y la misma membresía.
3. Para los corredores locales ya calibrados, la tarifa diurna de Higo no debe superar la referencia local equivalente. El objetivo es quedar igual o ligeramente por debajo, usando una referencia aproximada de 99% y redondeo práctico a múltiplos de USD 0.50, siempre con techo en la tarifa local.
4. Las rutas conocidas se resuelven mediante la capa de `pricing_corridors`; las rutas todavía no calibradas continúan con la fórmula general de base + distancia + extras hasta reunir evidencia local suficiente.
5. Mantener el multiplicador máximo inicial en 1.30x. En Higuerote, aplicar el recargo nocturno de 1.30x todos los días entre las 20:00 y las 05:00 sobre la tarifa diurna correspondiente, replicando la práctica local de tarifas nocturnas.
6. Las paradas, espera y otros servicios adicionales se cobran aparte porque ya no representan un viaje equivalente a la referencia local.
7. Usar promociones temporales para adquisición como gasto de Higo cuando sea posible, evitando convertir descuentos profundos en la tarifa estructural del conductor.
8. Recalibrar a los 7, 30 y 60 días con datos reales y ampliar aliases/tolerancias de corredor cuando las pruebas de producción detecten destinos que no hagan match correctamente.

## Corredores calibrados

El lanzamiento inicial incorpora las 29 rutas del segundo análisis de Higuerote. Cada corredor conserva la tarifa local observada y una tarifa objetivo Higo que nunca la supera durante el horario normal. La identificación combina origen cercano a Higuerote Centro, alias del destino y tolerancia sobre la distancia de ruta para evitar depender únicamente de un nombre exacto escrito por el usuario.

Moto permanece fuera de esta capa hasta completar una calibración específica de esa categoría.

## Regla de oro

**En horario normal, Higo no debe costar más que el transporte local equivalente en un corredor conocido. En horario nocturno, la tarifa normal se multiplica por 1.30x entre las 20:00 y las 05:00.**
