-- Correct Planta PDVSA Moto pricing.
-- The user clarified that Planta PDVSA is by Los Totumos and is distinct from
-- "La Planta" near Curiepe. Moto should therefore use the Los Totumos local
-- reference, while Carro/Camioneta keeps the taxi-sheet $12 reference.

update public.higuerote_corridor_fares
set moto_local_fare = 10.00,
    moto_target_fare = 10.00,
    moto_note = 'Planta PDVSA está en la zona de Los Totumos; usar referencia Moto Los Totumos $10. No confundir con La Planta cerca de Curiepe ($4).',
    updated_at = now()
where name = 'Planta PDVSA';

notify pgrst, 'reload schema';
