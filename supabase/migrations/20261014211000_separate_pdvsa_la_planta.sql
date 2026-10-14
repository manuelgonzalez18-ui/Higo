-- Higuerote: separate two different places that were previously conflated.
--
-- 1) Planta PDVSA: near Los Totumos. Passenger taxi sheet lists $12.
--    Moto fare is still unknown/currently unverified, so Moto must fall back.
-- 2) La Planta: sector near Curiepe named for an electrical substation.
--    Current Moto list says $4. Passenger fare remains unverified.

-- Re-purpose the current "Planta PDVSA" row as the real sector "La Planta".
update public.higuerote_corridor_fares
set name = 'La Planta',
    aliases = array[
        'la planta',
        'sector la planta',
        'la planta curiepe',
        'sector la planta curiepe',
        'subestacion electrica curiepe',
        'subestación eléctrica curiepe'
    ],
    local_fare = null,
    target_fare = null,
    moto_local_fare = 4.00,
    moto_target_fare = 4.00,
    moto_note = 'Sector cerca de Curiepe; referencia Moto actual $4. No confundir con Planta PDVSA.',
    note = 'La Planta es un sector distinto a Planta PDVSA',
    updated_at = now()
where name = 'Planta PDVSA';

-- Add the actual PDVSA plant as a separate destination.
insert into public.higuerote_corridor_fares
    (name, aliases, local_fare, target_fare, moto_local_fare, moto_target_fare, active, note, moto_note)
values
    (
        'Planta PDVSA',
        array[
            'planta pdvsa',
            'planta pdvsa higuerote',
            'planta de llenado pdvsa',
            'planta de llenado pdvsa higuerote',
            'pdvsa higuerote'
        ],
        12.00,
        12.00,
        null,
        null,
        true,
        'Destino cercano a Los Totumos; hoja local de carro/camioneta indica $12',
        'Tarifa Moto aún no confirmada; usar fallback hasta validación'
    )
on conflict (name) do update
set aliases = excluded.aliases,
    local_fare = excluded.local_fare,
    target_fare = excluded.target_fare,
    moto_local_fare = excluded.moto_local_fare,
    moto_target_fare = excluded.moto_target_fare,
    active = true,
    note = excluded.note,
    moto_note = excluded.moto_note,
    updated_at = now();

-- Ensure Los Totumos only matches its own destination labels.
update public.higuerote_corridor_fares
set aliases = array['los totumos'],
    updated_at = now()
where name = 'Los Totumos';

notify pgrst, 'reload schema';
