# Análisis de tarifas Higuerote — 2026-10-14

Fuente de trabajo: listado local entregado para la calibración previa al lanzamiento.

## Hallazgos principales

- Se analizaron **29 rutas** con tarifa local de carro/camioneta.
- El mercado local usa **la misma tarifa para carro y camioneta**.
- Con la configuración anterior, Higo Carro estaba en promedio **25.8% por debajo** de la tarifa local.
- Higo Camioneta estaba en promedio **3.0% por encima** de la tarifa local considerando las 29 rutas.
- En las **21 rutas de hasta 50 km**, Higo Camioneta estaba en promedio **5.3% por encima** de la tarifa local y su error absoluto medio fue menor que el de Higo Carro.
- Por eso, para el lanzamiento local se adopta una única estructura de tarifa para Carro y Camioneta: la que venía usando Camioneta.

## Configuración de lanzamiento

| Parámetro | Carro | Camioneta |
|---|---:|---:|
| Tarifa base | $1.70 | $1.70 |
| Tarifa mínima | $1.70 | $1.70 |
| Km incluido | 1 | 1 |
| Precio/km adicional | $0.60 | $0.60 |
| Precio/minuto | $0.00 | $0.00 |
| Espera/min luego de 3 min | $0.10 | $0.10 |
| Parada adicional | $1.00 | $1.00 |
| Máx. multiplicador | 1.30x | 1.30x |
| Membresía mensual | $20 | $20 |

## Por qué no se intenta ajustar todos los viajes con una sola tarifa por km

Las rutas interurbanas del listado muestran diferencias que no dependen solo de la distancia.
Guatire/Guarenas, Caracas/Petare, Charallave/La Guaira, Puerto La Cruz y Valencia
tienen economías distintas. Forzar una sola tarifa por km para igualar esos destinos
haría que los viajes locales de Higuerote queden artificialmente caros.

Por eso la primera tarifa se calibra para la operación local y de cercanía. Los corredores
interurbanos se tratarán después con reglas específicas por zona/corredor cuando haya
suficientes datos y coordenadas confiables.

## Moto

En las 16 rutas con referencia local de moto, la tarifa Higo actual muestra bastante más
dispersión y una mediana aproximadamente **28% por debajo** del mercado local.
No se modifica en este cambio para evitar mezclar dos decisiones comerciales. Debe ser la
siguiente calibración después de validar Carro/Camioneta en la app.

## Decisión de membresía

Si Carro y Camioneta tienen la misma tarifa por viaje, cobrar una membresía superior a
Camioneta introduce una penalización que el mercado local no justifica. Por eso ambas
quedan en **$20/mes** durante el lanzamiento.
