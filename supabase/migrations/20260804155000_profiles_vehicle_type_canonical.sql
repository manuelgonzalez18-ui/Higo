-- Normalize profiles.vehicle_type to the canonical values used by the current
-- driver dispatch, pricing, membership and onboarding code.
--
-- Historical production schemas constrained the column to title-cased Spanish
-- values ('Moto', 'Carro', 'Camioneta'), while the current application uses
-- 'moto', 'standard' and 'van'. This mismatch blocks approved applications from
-- being converted into driver profiles.

begin;

-- Drop the historical check first so existing rows can be normalized safely.
alter table public.profiles
    drop constraint if exists profiles_vehicle_type_check;

-- Normalize every known legacy alias to one canonical value.
update public.profiles
set vehicle_type = case lower(btrim(vehicle_type))
    when 'moto' then 'moto'
    when 'motorcycle' then 'moto'
    when 'motorbike' then 'moto'
    when 'carro' then 'standard'
    when 'car' then 'standard'
    when 'standard' then 'standard'
    when 'camioneta' then 'van'
    when 'truck' then 'van'
    when 'suv' then 'van'
    when 'van' then 'van'
    else vehicle_type
end
where vehicle_type is not null;

-- Abort rather than silently accepting an unknown production value.
do $$
declare
    v_unknown text;
begin
    select string_agg(distinct vehicle_type, ', ' order by vehicle_type)
      into v_unknown
      from public.profiles
     where vehicle_type is not null
       and vehicle_type not in ('moto', 'standard', 'van');

    if v_unknown is not null then
        raise exception 'unknown_profiles_vehicle_type_values:%', v_unknown
            using errcode = '22023';
    end if;
end;
$$;

alter table public.profiles
    alter column vehicle_type set default 'standard';

alter table public.profiles
    add constraint profiles_vehicle_type_check
    check (vehicle_type is null or vehicle_type in ('moto', 'standard', 'van'));

comment on column public.profiles.vehicle_type is
    'Canonical driver vehicle type: moto, standard or van.';

commit;

notify pgrst, 'reload schema';
