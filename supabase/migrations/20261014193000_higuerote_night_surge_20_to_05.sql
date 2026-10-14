-- Higuerote launch: recargo nocturno desde las 20:00 hasta las 05:00.
-- Mantiene el multiplicador 1.30x y el alcance existente a todos los vehículos.
-- La ventana cruza medianoche: [20,24) U [0,5).

do $$
begin
  update public.pricing_rules
     set name = 'Recargo nocturno 20:00 a 05:00',
         multiplier = 1.30,
         hour_start = 20,
         hour_end = 5,
         active = true,
         note = 'Recargo nocturno para todos los vehículos durante el lanzamiento en Higuerote'
   where name in ('Recargo nocturno 22:00 a 05:00', 'Recargo nocturno 20:00 a 05:00')
     and vehicle_type is null;

  if not found then
    insert into public.pricing_rules
      (name, vehicle_type, multiplier, day_of_week, hour_start, hour_end, zone_id, starts_at, ends_at, active, note)
    values
      ('Recargo nocturno 20:00 a 05:00', null, 1.30, null, 20, 5, null, null, null, true,
       'Recargo nocturno para todos los vehículos durante el lanzamiento en Higuerote');
  end if;
end
$$;
