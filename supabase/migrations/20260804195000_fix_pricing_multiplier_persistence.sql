-- Correct Pricing V4 multiplier persistence.
--
-- Root cause: higo_quote_ride_v2 invokes get_active_pricing_multiplier through
-- dynamic SQL using double precision coordinates, while the historical RPC is
-- declared with numeric coordinates. PostgreSQL cannot resolve that overload,
-- the catch-all fallback silently returns 1.0, and the client subtotal floor can
-- still preserve the multiplied total. The price is therefore correct while the
-- stored multiplier and reason are false.

begin;

-- Patch the existing function in place so all V2/V3/V4 callers resolve the
-- historical numeric RPC without duplicating the full pricing implementation.
do $patch$
declare
    v_signature regprocedure := to_regprocedure(
        'public.higo_quote_ride_v2(double precision,double precision,double precision,double precision,text,text,numeric,integer,text,uuid)'
    );
    v_definition text;
    v_patched text;
begin
    if v_signature is null then
        raise exception 'higo_quote_ride_v2_not_found';
    end if;

    select pg_get_functiondef(v_signature) into v_definition;

    if position(
        'select public.get_active_pricing_multiplier($1,$2::numeric,$3::numeric)'
        in v_definition
    ) > 0 then
        return;
    end if;

    v_patched := replace(
        v_definition,
        'select public.get_active_pricing_multiplier($1,$2,$3)',
        'select public.get_active_pricing_multiplier($1,$2::numeric,$3::numeric)'
    );

    if v_patched = v_definition then
        raise exception 'higo_quote_ride_v2_multiplier_call_not_found';
    end if;

    execute v_patched;
end;
$patch$;

-- First repair rows whose immutable snapshot already contains a multiplier
-- greater than the denormalized columns.
update public.rides r
set pricing_multiplier = (r.pricing_snapshot->>'surgeMultiplier')::numeric,
    pricing_multiplier_reason = coalesce(
        nullif(r.pricing_snapshot->>'multiplierReason', ''),
        'regla_zona_horario'
    )
where r.pricing_snapshot is not null
  and jsonb_typeof(r.pricing_snapshot->'surgeMultiplier') = 'number'
  and (r.pricing_snapshot->>'surgeMultiplier')::numeric
        > coalesce(r.pricing_multiplier, 1);

-- Repair the historical case where the client subtotal floor preserved the
-- multiplied amount but both snapshot and columns recorded 1.0. The inference
-- is intentionally narrow: V4 snapshot, floor applied, minimum not driving the
-- total, and ratio no higher than the configured multiplier cap.
with amounts as (
    select
        r.id,
        coalesce(r.pricing_snapshot, '{}'::jsonb) as snapshot,
        (
            case when jsonb_typeof(r.pricing_snapshot->'base') = 'number'
                then (r.pricing_snapshot->>'base')::numeric else 0 end
            + case when jsonb_typeof(r.pricing_snapshot->'distanceAmount') = 'number'
                then (r.pricing_snapshot->>'distanceAmount')::numeric else 0 end
            + case when jsonb_typeof(r.pricing_snapshot->'timeAmount') = 'number'
                then (r.pricing_snapshot->>'timeAmount')::numeric else 0 end
            + case when jsonb_typeof(r.pricing_snapshot->'stopsAmount') = 'number'
                then (r.pricing_snapshot->>'stopsAmount')::numeric else 0 end
            + case when jsonb_typeof(r.pricing_snapshot->'extrasAmount') = 'number'
                then (r.pricing_snapshot->>'extrasAmount')::numeric else 0 end
        ) as pre_multiplier,
        case
            when jsonb_typeof(r.pricing_snapshot->'chargedSubtotal') = 'number'
                then (r.pricing_snapshot->>'chargedSubtotal')::numeric
            when jsonb_typeof(r.pricing_snapshot->'subtotal') = 'number'
                then (r.pricing_snapshot->>'subtotal')::numeric
            else 0
        end as charged_subtotal,
        case when jsonb_typeof(r.pricing_snapshot->'minimumFare') = 'number'
            then (r.pricing_snapshot->>'minimumFare')::numeric else 0 end as minimum_fare,
        case when jsonb_typeof(r.pricing_snapshot->'maximumMultiplier') = 'number'
            then greatest(1, (r.pricing_snapshot->>'maximumMultiplier')::numeric)
            else 1.30 end as maximum_multiplier
    from public.rides r
    where r.pricing_snapshot is not null
      and coalesce(r.pricing_version, 0) = 4
      and coalesce(r.pricing_multiplier, 1) <= 1
      and coalesce(r.pricing_snapshot->>'clientSubtotalFloorApplied', 'false') = 'true'
), inferred as (
    select
        a.id,
        round(a.charged_subtotal / nullif(a.pre_multiplier, 0), 3) as multiplier
    from amounts a
    where a.pre_multiplier > 0
      and a.minimum_fare <= a.pre_multiplier
      and a.charged_subtotal > a.pre_multiplier
      and a.charged_subtotal / a.pre_multiplier > 1.005
      and a.charged_subtotal / a.pre_multiplier <= a.maximum_multiplier + 0.005
      and a.charged_subtotal / a.pre_multiplier <= 3
)
update public.rides r
set pricing_multiplier = i.multiplier,
    pricing_multiplier_reason = 'regla_zona_horario',
    pricing_snapshot = jsonb_set(
        jsonb_set(
            coalesce(r.pricing_snapshot, '{}'::jsonb),
            '{surgeMultiplier}',
            to_jsonb(i.multiplier),
            true
        ),
        '{multiplierReason}',
        to_jsonb('regla_zona_horario'::text),
        true
    )
from inferred i
where r.id = i.id;

-- Defense in depth: whenever a snapshot is written, keep the denormalized
-- multiplier columns aligned. A smaller snapshot value never overwrites a
-- larger already persisted value, protecting repaired historical rows.
create or replace function public.tg_rides_sync_pricing_multiplier()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_snapshot_multiplier numeric;
    v_snapshot_reason text;
begin
    if new.pricing_snapshot is not null
       and jsonb_typeof(new.pricing_snapshot->'surgeMultiplier') = 'number' then
        v_snapshot_multiplier := (new.pricing_snapshot->>'surgeMultiplier')::numeric;
        v_snapshot_reason := nullif(new.pricing_snapshot->>'multiplierReason', '');

        if v_snapshot_multiplier >= coalesce(new.pricing_multiplier, 0) then
            new.pricing_multiplier := v_snapshot_multiplier;
            new.pricing_multiplier_reason := coalesce(
                v_snapshot_reason,
                new.pricing_multiplier_reason,
                case when v_snapshot_multiplier > 1
                    then 'regla_zona_horario' else 'tarifa_normal' end
            );
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists rides_sync_pricing_multiplier on public.rides;
create trigger rides_sync_pricing_multiplier
before insert or update of pricing_snapshot, pricing_multiplier, pricing_multiplier_reason
on public.rides
for each row execute function public.tg_rides_sync_pricing_multiplier();

notify pgrst, 'reload schema';

commit;
