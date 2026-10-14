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

1. Mantener `per_minute = 0` hasta terminar el estudio local.
2. Ajustar primero tarifa mínima/base y precio por km con la evidencia de Higuerote.
3. Activar precio por minuto solo si los viajes lentos quedan materialmente subpagados y la lista local no compensa ya ese tiempo.
4. Mantener surge máximo inicial en 1.30x. En Higuerote, aplicar el recargo nocturno de 1.30x todos los días entre las 20:00 y las 05:00, replicando la práctica local de tarifas nocturnas.
5. Usar promociones temporales para adquisición en vez de rebajar permanentemente la tarifa estructural.
6. Recalibrar a los 7, 30 y 60 días con datos reales.

## Regla de oro

**No optimizar para el viaje más barato. Optimizar para un marketplace líquido: pasajero satisfecho + conductor que quiere aceptar y volver a conectarse.**
