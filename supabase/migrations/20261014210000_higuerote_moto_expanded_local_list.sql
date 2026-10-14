-- Expanded Higuerote Moto tariff catalog from current field list supplied 2026-10-14.
-- Passenger prices from the photographed taxi sheet are dated 2022-2023, so
-- they are NOT mass-applied here. Existing passenger fares already validated
-- in 2026 remain authoritative.
--
-- Important corrections:
--   * San Vicente: Moto $10 and passenger $10 (safe launch target).
--   * Planta PDVSA / La Planta: Moto $4. It must NOT inherit Los Totumos $10.
--     Passenger pricing falls back to the distance model until a current
--     passenger tariff is revalidated.
--   * Routes with local ranges use the LOWER/default amount so Higo does not
--     exceed the local fare; deeper/inner sub-zones need future geofences.

alter table public.higuerote_corridor_fares
    alter column local_fare drop not null,
    alter column target_fare drop not null,
    add column if not exists moto_note text;

-- Undo the temporary assumption that Planta PDVSA belonged to Los Totumos.
update public.higuerote_corridor_fares
set aliases = array_remove(
                array_remove(
                  array_remove(
                    array_remove(
                      array_remove(aliases, 'planta pdvsa'),
                      'planta pdvsa higuerote'
                    ),
                    'pdvsa los totumos'
                  ),
                  'planta de llenado pdvsa'
                ),
                'planta de llenado pdvsa higuerote'
              ),
    updated_at = now()
where name = 'Los Totumos';

insert into public.higuerote_corridor_fares
    (name, aliases, local_fare, target_fare, moto_local_fare, moto_target_fare, active, moto_note)
values
    ('CC Flamingo', array['cc flamingo','c.c. flamingo','centro comercial flamingo','flamingo'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('3 de Junio', array['3 de junio','tres de junio','las velitas 3 de junio'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('El Cocal', array['el cocal'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('La Fuente', array['la fuente'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Las Azules', array['las azules'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Cabo Codera', array['cabo codera'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Barrio Ajuro', array['barrio ajuro'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Calle La Democracia', array['calle la democracia','la democracia'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Farmatodo', array['farmatodo higuerote','farmatodo'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Pergola', array['pergola','pérgola'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('SEBIN', array['sebin higuerote','sebin'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('La Ceiba', array['la ceiba','ceiba'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Centro Turistico', array['centro turistico','centro turístico'], null, null, 2.00, 2.00, true, 'Moto local actual'),
    ('Cuchivano', array['cuchivano'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Brisas', array['brisas','brisa'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Calle Mexico', array['calle mexico','calle méxico'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Muruy', array['muruy','19 de abril','19 de abrir'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('El Ancla', array['el ancla'], null, null, 2.00, 2.00, true, 'Moto local actual'),
    ('Valle Seco', array['valle seco'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Brisas del Cocal', array['brisas del cocal','brisa el cocal','brisa del cocal'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('La Costanera', array['la costanera'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Ciudad Banesco', array['ciudad banesco'], null, null, 5.00, 5.00, true, 'Moto local actual'),
    ('La Aldea', array['la aldea'], null, null, 5.00, 5.00, true, 'Moto local actual'),
    ('Rancho Grande', array['rancho grande'], null, null, 2.00, 2.00, true, 'Moto local actual'),
    ('Terraza Adentro', array['terraza adentro','terrasa adentro'], null, null, 4.00, 4.00, true, 'Moto local actual'),
    ('Marina Caribe', array['marina caribe','apartamentos marina caribe'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Club Aguasal', array['club aguasal','aguasal','aguasal club'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('El Kilombo', array['el kilombo','kilombo','quilombo'], null, null, 1.00, 1.00, true, 'Moto local actual'),
    ('Brion Avanza', array['brion avanza','brión avanza'], null, null, 1.50, 1.50, true, 'Moto local actual'),
    ('Valle Seco Residencia', array['valle seco residencia','residencia valle seco'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Guayacan', array['guayacan','guayacán'], null, null, 5.00, 5.00, true, 'Moto local actual'),
    ('Nuevo Carenero', array['nuevo carenero'], null, null, 6.00, 6.00, true, 'Moto local actual'),
    ('Rancho Aurimare', array['rancho aurimare','rancho urimare'], null, null, 4.00, 4.00, true, 'Moto local actual'),
    ('Planta PDVSA', array['planta pdvsa','planta pdvsa higuerote','planta de llenado pdvsa','planta de llenado pdvsa higuerote','la planta'], null, null, 4.00, 4.00, true, 'Moto local actual: La Planta $4; passenger queda por fórmula hasta revalidar tarifa actual'),
    ('Aguja Azul', array['aguja azul','aguja azules'], null, null, 2.00, 2.00, true, 'Moto local actual'),
    ('INCRET', array['incret','el incret'], null, null, 2.00, 2.00, true, 'Moto local actual'),
    ('Mediterrane', array['mediterrane','mediterraneo','mediterráneo'], null, null, 1.50, 1.50, true, 'Moto local actual'),
    ('Mesa Grande La Bodega', array['mesa grande la bodega','mesa grande bodega'], null, null, 2.00, 2.00, true, 'Moto $2 hasta la bodega; después $3. Falta geocerca interior'),
    ('El Zancudo', array['el zancudo','zancudo'], null, null, 2.00, 2.00, true, 'Moto $2 base; adentro $3. Falta geocerca interior'),
    ('Dividivis', array['dividivis','dividivi','el dividivi'], null, null, 2.00, 2.00, true, 'Moto $2 base; adentro $3. Falta geocerca interior'),
    ('Birongo', array['birongo'], null, null, 12.00, 12.00, true, 'Moto $12 base; zonas más arriba $15. Falta geocerca interior'),
    ('Salgado', array['salgado'], null, null, 10.00, 10.00, true, 'Moto local actual'),
    ('Guayanes', array['guayanes'], null, null, 6.00, 6.00, true, 'Moto local actual'),
    ('Transito', array['transito','tránsito','trasito'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Dos Caminos', array['dos caminos','dos camino'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Subida del Camello', array['subida del camello','camello'], null, null, 4.00, 4.00, true, 'Moto local actual'),
    ('Los Conucos', array['los conucos','conucos'], null, null, 5.00, 5.00, true, 'Moto local actual'),
    ('Asocanales', array['asocanales','asocanales a-8'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Ciudad Bargues', array['ciudad bargues'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Manglares', array['manglares','los manglares'], null, null, 2.00, 2.00, true, 'Moto local actual'),
    ('Sotillo Colonia', array['sotillo colonia','colonia sotillo'], null, null, 6.00, 6.00, true, 'Moto local actual'),
    ('Alamar', array['alamar'], null, null, 4.00, 4.00, true, 'Moto $4 base; adentro $5. Falta geocerca interior'),
    ('San Vicente', array['san vicente','san visente'], 10.00, 10.00, 10.00, 10.00, true, 'Moto local actual $10; passenger $10 usado como objetivo conservador del listado local'),
    ('La Franqueza', array['la franqueza','franqueza'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Via Oso Valle Seco', array['via oso valle seco','vía oso valle seco','oso valle seco','via oso valle ceco'], null, null, 5.00, 5.00, true, 'Moto local actual'),
    ('San Francisquito', array['san francisquito','san fracisquito'], null, null, 12.00, 12.00, true, 'Moto local actual'),
    ('Maturin', array['maturin','maturín'], null, null, 7.00, 7.00, true, 'Moto local actual'),
    ('Gamelotal', array['gamelotal'], null, null, 8.00, 8.00, true, 'Moto local reporta $8-$10; se usa piso $8 para no superar mercado'),
    ('Las Lapas', array['las lapas'], null, null, 15.00, 15.00, true, 'Moto local actual'),
    ('Rio Chico', array['rio chico','río chico'], null, null, 20.00, 19.50, true, 'Moto local $20; target -2.5%'),
    ('Teresa Entrada', array['teresa entrada','santa teresa entrada'], null, null, 3.00, 3.00, true, 'Moto local actual'),
    ('Teresa Privada', array['teresa privada','santa teresa privada'], null, null, 5.00, 5.00, true, 'Moto local actual'),
    ('Oso', array['oso'], null, null, 8.00, 8.00, true, 'Moto local actual'),
    ('Tacarigua La Laguna', array['tacarigua la laguna','tacarigua de la laguna'], null, null, 30.00, 29.50, true, 'Moto local $30; target -1.7%')
on conflict (name) do update
set aliases = (
        select array(
            select distinct x
            from unnest(
                coalesce(public.higuerote_corridor_fares.aliases, '{}'::text[])
                || excluded.aliases
            ) as t(x)
        )
    ),
    local_fare = coalesce(excluded.local_fare, public.higuerote_corridor_fares.local_fare),
    target_fare = coalesce(excluded.target_fare, public.higuerote_corridor_fares.target_fare),
    moto_local_fare = excluded.moto_local_fare,
    moto_target_fare = excluded.moto_target_fare,
    moto_note = excluded.moto_note,
    active = true,
    updated_at = now();

-- Existing rows from prior calibration that now have additional current Moto data.
update public.higuerote_corridor_fares
set moto_local_fare = 5.00, moto_target_fare = 5.00,
    moto_note = 'Moto local actual', updated_at = now()
where name = 'Bosque de Curiepe';

update public.higuerote_corridor_fares
set moto_local_fare = 7.00, moto_target_fare = 7.00,
    moto_note = 'Moto local reporta $7-$8; se usa piso $7 para no superar mercado', updated_at = now()
where name = 'Las Gonzalez';

-- Keep known exact/current rows aligned with the supplied Moto list.
update public.higuerote_corridor_fares
set moto_local_fare = 10.00, moto_target_fare = 10.00, updated_at = now()
where name in ('Mamporal','Chirimena','Los Totumos');

update public.higuerote_corridor_fares
set moto_local_fare = 12.00, moto_target_fare = 12.00, updated_at = now()
where name = 'Puerto Frances';

update public.higuerote_corridor_fares
set moto_local_fare = 5.00, moto_target_fare = 5.00, updated_at = now()
where name in ('Curiepe','Carenero','Sotillo','Moron','Tacarigua');

update public.higuerote_corridor_fares
set moto_local_fare = 20.00, moto_target_fare = 19.50, updated_at = now()
where name = 'Caucagua';

notify pgrst, 'reload schema';
