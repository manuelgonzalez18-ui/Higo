-- Higuerote: Planta PDVSA está en el mismo corredor local de Los Totumos.
-- Evita que esa selección caiga al fallback por distancia y mantenga una tarifa
-- coherente con la referencia local validada para Carro/Camioneta y Moto.

update public.higuerote_corridor_fares
set aliases = (
        select array(
            select distinct x
            from unnest(
                coalesce(aliases, '{}'::text[])
                || array[
                    'planta pdvsa',
                    'planta pdvsa higuerote',
                    'pdvsa los totumos',
                    'planta de llenado pdvsa',
                    'planta de llenado pdvsa higuerote'
                ]
            ) as t(x)
        )
    ),
    updated_at = now(),
    note = 'Los Totumos + Planta PDVSA; validado en prueba de campo 2026-10-14'
where name = 'Los Totumos';

notify pgrst, 'reload schema';
