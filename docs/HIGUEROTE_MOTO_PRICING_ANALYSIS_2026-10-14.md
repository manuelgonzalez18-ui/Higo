# Higo — análisis de tarifas Moto en Higuerote — 2026-10-14

## Muestra

Se usaron 16 rutas con tarifa local de moto disponibles en el primer levantamiento
de Higuerote.

Con la fórmula anterior de Higo Moto ($1 base + $0.25/km adicional):

- diferencia promedio frente al mercado local: **-16.0%**;
- diferencia mediana: **-28.1%**;
- error absoluto medio: **37.7%**;
- 11 de 16 rutas estaban por debajo de la tarifa local;
- 5 de 16 estaban por encima.

La dispersión confirma el mismo patrón visto en Carro/Camioneta: el mercado local
no se explica bien con una única tarifa por kilómetro.

## Política de lanzamiento Moto

Para corredores conocidos:

- Higo nunca debe superar la tarifa local diurna;
- en importes pequeños se mantiene el mismo valor local para facilitar pago;
- solo se descuenta cuando el redondeo sigue siendo práctico;
- el recargo nocturno existente de 1.30x continúa entre 20:00 y 05:00.

## Tarifas objetivo

| Destino | Local Moto | Higo Moto objetivo |
|---|---:|---:|
| Curiepe | $5.00 | $5.00 |
| Chirimena | $10.00 | $10.00 |
| Mamporal | $10.00 | $10.00 |
| Puerto Frances | $12.00 | $12.00 |
| Carenero | $5.00 | $5.00 |
| Ciudad Brion | $4.00 | $4.00 |
| Sotillo | $5.00 | $5.00 |
| Hospital Central | $1.00 | $1.00 |
| Hotel Aguamarina | $2.00 | $2.00 |
| Los Totumos | $10.00 | $10.00 |
| Moron | $5.00 | $5.00 |
| San Luis | $1.00 | $1.00 |
| Tacarigua | $5.00 | $5.00 |
| Puerto Encantado | $1.00 | $1.00 |
| CC Cabo Mall | $1.00 | $1.00 |
| Caucagua | $20.00 | $19.50 |

## Membresía

La membresía Higo Moto se mantiene en **$10/mes**. Es la mitad de Carro/Camioneta
($20/mes), conserva una entrada baja para esta categoría y no hay evidencia en
la muestra que justifique aumentarla antes del lanzamiento.

## Rutas no conocidas

La fórmula global de Moto queda sin cambios durante esta ronda. Antes de modificar
el fallback para destinos no catalogados se necesita una muestra mayor de rutas
Moto, porque subir el precio/km para corregir rutas largas puede sobrevalorar
viajes cortos.
