-- Higuerote Moto pricing calibration from the local tariff sheet.
-- Policy: known daytime Moto corridors must be equal to or slightly below the
-- local moto fare. Small fares stay equal to avoid impractical cents; Caucagua
-- uses a 2.5% discount. Night pricing keeps the existing 1.30x rule.

alter table public.higuerote_corridor_fares
    add column if not exists moto_local_fare numeric(12,2),
    add column if not exists moto_target_fare numeric(12,2);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'higuerote_corridor_moto_local_fare_check'
          and conrelid = 'public.higuerote_corridor_fares'::regclass
    ) then
        alter table public.higuerote_corridor_fares
            add constraint higuerote_corridor_moto_local_fare_check
            check (moto_local_fare is null or moto_local_fare > 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'higuerote_corridor_moto_target_fare_check'
          and conrelid = 'public.higuerote_corridor_fares'::regclass
    ) then
        alter table public.higuerote_corridor_fares
            add constraint higuerote_corridor_moto_target_fare_check
            check (moto_target_fare is null or moto_target_fare > 0);
    end if;
end
$$;

update public.higuerote_corridor_fares
set moto_local_fare = case name
        when 'Curiepe' then 5.00
        when 'Chirimena' then 10.00
        when 'Mamporal' then 10.00
        when 'Puerto Frances' then 12.00
        when 'Carenero' then 5.00
        when 'Ciudad Brion' then 4.00
        when 'Sotillo' then 5.00
        when 'Hospital Central' then 1.00
        when 'Hotel Aguamarina' then 2.00
        when 'Los Totumos' then 10.00
        when 'Moron' then 5.00
        when 'San Luis' then 1.00
        when 'Tacarigua' then 5.00
        when 'Puerto Encantado' then 1.00
        when 'CC Cabo Mall' then 1.00
        when 'Caucagua' then 20.00
        else moto_local_fare
    end,
    moto_target_fare = case name
        when 'Curiepe' then 5.00
        when 'Chirimena' then 10.00
        when 'Mamporal' then 10.00
        when 'Puerto Frances' then 12.00
        when 'Carenero' then 5.00
        when 'Ciudad Brion' then 4.00
        when 'Sotillo' then 5.00
        when 'Hospital Central' then 1.00
        when 'Hotel Aguamarina' then 2.00
        when 'Los Totumos' then 10.00
        when 'Moron' then 5.00
        when 'San Luis' then 1.00
        when 'Tacarigua' then 5.00
        when 'Puerto Encantado' then 1.00
        when 'CC Cabo Mall' then 1.00
        when 'Caucagua' then 19.50
        else moto_target_fare
    end,
    updated_at = now()
where name in (
    'Curiepe','Chirimena','Mamporal','Puerto Frances','Carenero',
    'Ciudad Brion','Sotillo','Hospital Central','Hotel Aguamarina',
    'Los Totumos','Moron','San Luis','Tacarigua','Puerto Encantado',
    'CC Cabo Mall','Caucagua'
);

create or replace function public.higo_higuerote_corridor_match(
    p_dropoff text,
    p_vehicle_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_type text := public.higo_canonical_vehicle_type(p_vehicle_type);
    v_norm text := public.higo_normalize_place_label(p_dropoff);
    v_row record;
begin
    if v_type not in ('moto','standard','van') then
        return null;
    end if;

    select
        f.id,
        f.name,
        case when v_type = 'moto' then f.moto_local_fare else f.local_fare end as local_fare,
        case when v_type = 'moto' then f.moto_target_fare else f.target_fare end as target_fare,
        a.alias
      into v_row
      from public.higuerote_corridor_fares f
      cross join lateral unnest(f.aliases) as a(alias)
     where f.active = true
       and (v_type <> 'moto' or f.moto_target_fare is not null)
       and v_norm like '%' || public.higo_normalize_place_label(a.alias) || '%'
     order by length(public.higo_normalize_place_label(a.alias)) desc, f.id
     limit 1;

    if not found or v_row.target_fare is null then
        return null;
    end if;

    return jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'vehicleType', v_type,
        'localFare', v_row.local_fare,
        'targetFare', v_row.target_fare,
        'matchedAlias', v_row.alias
    );
end;
$$;

grant execute on function public.higo_higuerote_corridor_match(text,text)
to anon, authenticated;

notify pgrst, 'reload schema';
